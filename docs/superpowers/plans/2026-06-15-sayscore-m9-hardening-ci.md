# Ops/security hardening + CI (M9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close §12 security gaps (rate limiting, body limits, sliding session refresh) and complete §15 CI (golangci-lint, frontend eslint+vitest, Docker image builds). Final milestone.

**Architecture:** Standalone HTTP middlewares in `internal/httpapi` (no `Deps` coupling): an in-memory `keyedLimiter` (`golang.org/x/time/rate`, v0.15.0 already present) drives a per-IP limiter on auth and a per-user limiter on authed writes; a `MaxBytesReader` middleware caps `/api` bodies; `RequireAuth` gains a sliding-refresh re-issue. All wired in `NewRouter`. CSRF (SameSite-Lax) + secrets are documented decisions. CI gets golangci-lint (+ config + fixes), eslint, vitest, and a build-only Docker job.

**Tech Stack:** Go 1.26 · chi/v5 · golang.org/x/time/rate · GitHub Actions · golangci-lint · React/Vite · eslint · vitest.

**Branch:** `feat/m9-hardening-ci` (already created off `main`).

**Spec:** `docs/superpowers/specs/2026-06-15-sayscore-m9-hardening-ci-design.md`.

**Conventions:** middlewares are standalone funcs returning `func(http.Handler) http.Handler`, wired in `NewRouter`; reuse `writeError`; use the package `now()` clock var; Conventional Commits per task; `gofmt -w` + `go vet`. NOTE: backend Dockerfile is already `golang:1.26` — no change needed.

---

## File structure

- `backend/internal/httpapi/ratelimit.go` (+ `_test.go`) — keyedLimiter + the two rate-limit middlewares (create).
- `backend/internal/httpapi/middleware.go` — sliding refresh in `RequireAuth`; `maxBodyBytes` middleware (modify).
- `backend/internal/httpapi/router.go` — wire body-limit + rate-limit middlewares (modify).
- `backend/internal/httpapi/router_test.go` or a new `ratelimit_integration_test.go` — through-router 429 test (create/modify).
- `backend/.golangci.yml` (create) + whatever fixes the gate surfaces (modify).
- `.github/workflows/ci.yml` — golangci-lint, eslint, vitest, docker build (modify).
- `docs/REQUIREMENTS.md` — §12 CSRF/secrets/rate-limit documented decisions (modify).

---

## Task 1: Rate limiter + middlewares (TDD)

**Files:** Create `backend/internal/httpapi/ratelimit.go` + `ratelimit_test.go`.

- [ ] **Step 1: failing tests**

```go
package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"golang.org/x/time/rate"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

func TestKeyedLimiter_AllowsThenBlocks(t *testing.T) {
	kl := newKeyedLimiter(rate.Limit(0.0001), 2) // ~never refills; burst 2
	if !kl.Allow("a") || !kl.Allow("a") {
		t.Fatal("first 2 within burst should pass")
	}
	if kl.Allow("a") {
		t.Fatal("3rd should be blocked")
	}
	if !kl.Allow("b") {
		t.Fatal("different key must be isolated")
	}
}

func TestRateLimitIP_429WithRetryAfter(t *testing.T) {
	kl := newKeyedLimiter(rate.Limit(0.0001), 1)
	h := rateLimitIP(kl)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	call := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/auth/google", nil)
		req.RemoteAddr = "1.2.3.4:5555"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	if call().Code != 200 {
		t.Fatal("first should pass")
	}
	rec := call()
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("2nd should be 429, got %d", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Error("429 must set Retry-After")
	}
}

func TestRateLimitWrites_OnlyMutating_PerUser(t *testing.T) {
	kl := newKeyedLimiter(rate.Limit(0.0001), 1)
	h := rateLimitWrites(kl)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	withUser := func(method string, id int64) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/api/x", nil)
		req = ctxUser(req, id) // helper from existing tests: injects store.User{ID:id}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	// GET never limited
	for i := 0; i < 5; i++ {
		if withUser(http.MethodGet, 1).Code != 200 {
			t.Fatal("GET must never be limited")
		}
	}
	// writes limited per user
	if withUser(http.MethodPut, 1).Code != 200 {
		t.Fatal("1st write within burst")
	}
	if withUser(http.MethodPut, 1).Code != http.StatusTooManyRequests {
		t.Fatal("2nd write same user → 429")
	}
	if withUser(http.MethodPut, 2).Code != 200 {
		t.Fatal("different user isolated")
	}
}
```

(`ctxUser` exists in the httpapi test files; reuse it. If it lives in a `_test.go`, it's visible to this test in the same package.)

- [ ] **Step 2: run RED.**

- [ ] **Step 3: implement** `ratelimit.go`:

```go
package httpapi

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// rate-limit tuning (per the M9 design).
const (
	authRate   = rate.Limit(10.0 / 60.0) // ~10/min per IP
	authBurst  = 5
	writeRate  = rate.Limit(60.0 / 60.0) // ~60/min per user
	writeBurst = 20
	limiterIdleTTL = 15 * time.Minute
)

type limiterEntry struct {
	lim      *rate.Limiter
	lastSeen time.Time
}

// keyedLimiter is an in-memory per-key token-bucket limiter (single-instance app).
type keyedLimiter struct {
	limit rate.Limit
	burst int
	mu    sync.Mutex
	keys  map[string]*limiterEntry
}

func newKeyedLimiter(limit rate.Limit, burst int) *keyedLimiter {
	return &keyedLimiter{limit: limit, burst: burst, keys: map[string]*limiterEntry{}}
}

func (k *keyedLimiter) Allow(key string) bool {
	k.mu.Lock()
	defer k.mu.Unlock()
	now := time.Now()
	e, ok := k.keys[key]
	if !ok {
		e = &limiterEntry{lim: rate.NewLimiter(k.limit, k.burst)}
		k.keys[key] = e
	}
	e.lastSeen = now
	// opportunistic sweep of idle keys (bounded work)
	if len(k.keys) > 0 {
		for kk, ee := range k.keys {
			if now.Sub(ee.lastSeen) > limiterIdleTTL {
				delete(k.keys, kk)
			}
		}
	}
	return e.lim.Allow()
}

func clientIP(r *http.Request) string {
	// middleware.RealIP has normalized r.RemoteAddr to the client IP[:port]
	host := r.RemoteAddr
	if i := indexColon(host); i >= 0 {
		host = host[:i]
	}
	return host
}

func indexColon(s string) int {
	for i := len(s) - 1; i >= 0; i-- { // rightmost colon (handles IPv6-less host:port)
		if s[i] == ':' {
			return i
		}
	}
	return -1
}

func tooMany(w http.ResponseWriter) {
	w.Header().Set("Retry-After", strconv.Itoa(1))
	writeError(w, http.StatusTooManyRequests, "rate limited")
}

// rateLimitIP throttles by client IP (for the unauthenticated auth endpoint).
func rateLimitIP(kl *keyedLimiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !kl.Allow(clientIP(r)) {
				tooMany(w)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// rateLimitWrites throttles mutating methods by session user id; reads pass through.
// Must run AFTER RequireAuth (needs the user in context).
func rateLimitWrites(kl *keyedLimiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				next.ServeHTTP(w, r)
				return
			}
			key := "anon"
			if u, ok := userFromContext(r.Context()); ok {
				key = strconv.FormatInt(u.ID, 10)
			}
			if !kl.Allow(key) {
				tooMany(w)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
```

(Adapt `Retry-After` to a computed value if desired; a static `1`s is acceptable for a per-second-ish bucket. Consider `net.SplitHostPort` instead of the hand-rolled `indexColon` if the linter prefers — fine either way.)

- [ ] **Step 4: run GREEN.**

- [ ] **Step 5: commit** `feat(api): in-memory rate limiter + per-IP/per-user middlewares (429 + Retry-After)`.

---

## Task 2: Body-size limit middleware (TDD)

**Files:** Modify `middleware.go` (+ a test in `middleware_test.go`).

- [ ] **Step 1: failing test** — a request body over the cap → the handler's decode fails → 400.

```go
func TestMaxBodyBytes_OversizeRejected(t *testing.T) {
	const cap = 16 // tiny cap for the test
	var decoded bool
	h := maxBodyBytes(cap)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var v map[string]any
		if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		decoded = true
		w.WriteHeader(200)
	}))
	big := strings.NewReader(`{"x":"` + strings.Repeat("a", 100) + `"}`)
	req := httptest.NewRequest(http.MethodPut, "/api/x", big)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("oversize body should 400, got %d", rec.Code)
	}
	if decoded {
		t.Error("decode must not succeed on an oversize body")
	}
}
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: implement** in `middleware.go`:

```go
// maxBodyBytes caps request body size; an over-limit body makes the handler's
// json.Decode fail (→ 400). Applied once on the /api group.
func maxBodyBytes(n int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, n)
			next.ServeHTTP(w, r)
		})
	}
}

const maxBodyBytesLimit int64 = 1 << 20 // 1 MiB
```

- [ ] **Step 4: GREEN** + commit `feat(api): MaxBytesReader body-size limit middleware (1 MiB)`.

---

## Task 3: Sliding session refresh (TDD)

**Files:** Modify `middleware.go` (`RequireAuth`); test in `middleware_test.go`.

- [ ] **Step 1: failing tests**

```go
func TestRequireAuth_SlidingRefresh_ReissuesNearExpiry(t *testing.T) {
	sm := auth.NewSessionManager("test-secret")
	fs := newFakeStore() // existing helper; create a user id 1
	u, _ := fs.UpsertUser(context.Background(), store.UpsertUserParams{Email: "a@sayonetech.com"})
	d := &Deps{Store: fs, Sessions: sm}
	// a cookie within its last 6 days → should be re-issued
	old := now
	now = func() time.Time { return time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC) }
	t.Cleanup(func() { now = old })
	// issue a token that expires in 2 days (i.e. issued ~5 days ago for a 7d ttl)
	stale := sm.Encode(auth.Session{UserID: u.ID}, 2*24*time.Hour)
	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: stale})
	rec := httptest.NewRecorder()
	d.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })).ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status=%d", rec.Code)
	}
	if rec.Result().Cookies() == nil || !hasSessionCookie(rec) {
		t.Error("near-expiry session must be re-issued (Set-Cookie present)")
	}
}

func TestRequireAuth_FreshSession_NotReissued(t *testing.T) {
	// a full-TTL cookie → no Set-Cookie
	// (same setup; encode with sessionTTL; assert no session Set-Cookie)
}
```

Add a small `hasSessionCookie(rec)` test helper checking the recorder's `Set-Cookie` for `sessionCookieName`.

- [ ] **Step 2: RED.**

- [ ] **Step 3: implement** — in `RequireAuth`, after the `GetUserByID` success and before `next`:

```go
		// Sliding refresh: re-issue the cookie on activity when it's within its
		// last (sessionTTL - refreshThreshold) so active users slide; idle expire.
		if time.Until(time.Unix(sess.ExpiresAt, 0)) < sessionTTL-sessionRefreshThreshold {
			d.setSessionCookie(w, u.ID)
		}
		ctx := context.WithValue(r.Context(), userCtxKey, u)
		next.ServeHTTP(w, r.WithContext(ctx))
```

with `const sessionRefreshThreshold = 24 * time.Hour`. Note: use `now()` for testability — replace `time.Until(...)` with `time.Unix(sess.ExpiresAt,0).Sub(now())`. (`sess` is already decoded above; it carries `ExpiresAt`.)

- [ ] **Step 4: GREEN** + commit `feat(auth): sliding session refresh on activity near expiry`.

---

## Task 4: Wire middlewares in NewRouter + through-router test

**Files:** Modify `router.go`; integration test.

- [ ] **Step 1:** wire in `NewRouter`:

```go
	authLimiter := newKeyedLimiter(authRate, authBurst)
	writeLimiter := newKeyedLimiter(writeRate, writeBurst)

	r.Route("/api", func(api chi.Router) {
		api.Use(maxBodyBytes(maxBodyBytesLimit))
		api.With(rateLimitIP(authLimiter)).Post("/auth/google", d.PostAuthGoogle)
		api.Post("/auth/logout", d.PostAuthLogout)

		api.Group(func(priv chi.Router) {
			priv.Use(d.RequireAuth)
			priv.Use(rateLimitWrites(writeLimiter)) // after RequireAuth (needs user)
			// ... existing routes unchanged ...
		})
	})
```

(Keep all existing route registrations; only add the three `Use`/`With` lines + the two limiter constructions. `auth/logout` stays unlimited or also under the auth limiter — keep it simple: only `/auth/google` is IP-limited.)

- [ ] **Step 2: through-router test** (`ratelimit_integration_test.go`): build `NewRouter(d, false)` with a tiny-limit override is hard (limits are constants) — instead assert the wiring exists by hammering `POST /api/auth/google` many times and expecting a 429 eventually, OR keep the unit middleware tests (Task 1) as the authority and add one smoke test that a normal single request still passes (200/4xx as appropriate, not 429). Prefer: a test that a single well-formed auth/me request is NOT rate-limited (no false positives). Deep limit-exhaustion is covered by Task 1 unit tests.

- [ ] **Step 3:** `cd backend && go build ./... && go vet ./... && go test ./...` green.

- [ ] **Step 4:** commit `feat(api): wire body-limit + auth/write rate limiters in the router`.

---

## Task 5: CI completeness + golangci-lint

**Files:** Create `backend/.golangci.yml`; modify `.github/workflows/ci.yml`; fix surfaced lint.

- [ ] **Step 1: golangci-lint config** `backend/.golangci.yml` (a sensible, not-overbearing set):

```yaml
version: "2"
linters:
  enable:
    - govet
    - staticcheck
    - errcheck
    - ineffassign
    - unused
    - misspell
  # gofmt/formatting handled by the fmt step / lefthook
```

(Adapt to the installed golangci-lint major version's schema — v1 uses a different layout than v2. The executor: run `golangci-lint run` locally first, pick the config schema matching the available binary, and tune.)

- [ ] **Step 2: run + fix** — `cd backend && golangci-lint run` (install via `make hooks-tools` if absent). Fix every reported issue in the codebase (errcheck unchecked errors, staticcheck nits, etc.) until clean. Commit the config + fixes: `chore(lint): add golangci-lint config and fix surfaced issues`.

- [ ] **Step 3: CI — backend job** add a golangci-lint step (in `.github/workflows/ci.yml`, backend job, before/after test):

```yaml
      - name: golangci-lint
        uses: golangci/golangci-lint-action@v6
        with:
          version: latest
          working-directory: backend
```

- [ ] **Step 4: CI — frontend job** add eslint + vitest (currently missing):

```yaml
      - name: Lint
        run: pnpm exec eslint .
      - name: Test
        run: pnpm vitest run
```

(Run `pnpm exec eslint .` locally first; fix any lint the gate surfaces so CI is green.)

- [ ] **Step 5: CI — Docker build job** (build-only, validates both Dockerfiles):

```yaml
  docker:
    needs: [backend, frontend]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Build backend image
        uses: docker/build-push-action@v6
        with: { context: ., file: backend/Dockerfile, push: false }
      - name: Build frontend image
        uses: docker/build-push-action@v6
        with: { context: ., file: frontend/Dockerfile, push: false, build-args: "VITE_GOOGLE_CLIENT_ID=ci-placeholder" }
```

(Adapt `context`/`file`/`build-args` to how the existing Dockerfiles expect them — check `deploy/docker-compose.yml` for the build context + args each image uses, and mirror that.)

- [ ] **Step 6:** commit `ci: golangci-lint + frontend eslint/vitest + build-only Docker images`.

---

## Task 6: Docs — REQUIREMENTS §12 documented decisions

**Files:** Modify `docs/REQUIREMENTS.md`.

- [ ] **Step 1:** §12 — record the M9 implementations + decisions:
  - rate limiting: per-IP on auth + per-user on all authed writes (429 + Retry-After);
  - request body cap (1 MiB) via MaxBytesReader;
  - session: sliding refresh on activity, 7-day window;
  - **CSRF decision:** SameSite=Lax is the accepted CSRF defense for this internal SSO app; no token (documented deviation from the "+ CSRF token" wording);
  - **secrets:** rotate `SESSION_SECRET` / `FOOTBALL_DATA_API_KEY` before production (operational, deploy-time).
  - Mark §15 CI as fully implemented.
- [ ] **Step 2:** commit `docs: M9 security + CI decisions in REQUIREMENTS §12/§15`.

---

## Task 7: Verification + DoD

- [ ] **Step 1:** `cd backend && go vet ./... && go test ./... && golangci-lint run` all green.
- [ ] **Step 2:** `cd frontend && pnpm exec eslint . && pnpm tsc --noEmit && pnpm vitest run && pnpm build` all green.
- [ ] **Step 3:** live smoke (rebuild stack): `for i in $(seq 1 20); do curl -s -o /dev/null -w "%{http_code} " -X POST localhost:8000/api/auth/google; done` → see `200/400`s turn into `429` after the burst; confirm a single normal authed GET is never 429; confirm an active session past day 1 keeps working (cookie re-issued); an oversize body → 400.
- [ ] **Step 4:** run `sayscore-verifier` (it runs build/vet/lint/test + frontend; confirms DoD).

---

## Self-review notes

- **Spec coverage:** rate limiter (T1), body limit (T2), sliding refresh (T3), wiring (T4), CI+golangci-lint+eslint+vitest+docker (T5), docs/CSRF/secrets (T6), DoD (T7). All M9 spec sections mapped. (Dockerfile Go base already 1.26 — no task needed.)
- **Middleware independence:** the limiters/body-limit are standalone funcs wired in `NewRouter`; no `Deps` coupling, so handler unit tests are unaffected and the middlewares are unit-tested directly with tiny-limit limiters.
- **rateLimitWrites runs after RequireAuth** (needs the user in context) and only counts mutating methods — covers prediction/bonus/admin/recompute writes via one middleware on the priv group.
- **Sliding refresh uses `now()`** (the package clock var) for testability; re-issues only within the last (7d − 24h).
- **Open-ended bit:** Task 5's golangci-lint "fix surfaced issues" is unbounded by nature — keep fixes mechanical (errcheck/staticcheck), don't refactor behavior; if a lint is noisy/low-value, disable that specific linter in `.golangci.yml` rather than churn the code.
- **CI Docker build context/args:** mirror `deploy/docker-compose.yml`'s build config (T5 step 5) — the executor verifies the exact context/file/build-args.
