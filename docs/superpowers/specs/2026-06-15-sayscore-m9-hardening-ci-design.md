# SayScore — Milestone 9 Design: Ops/security hardening + CI

**Status:** approved 2026-06-15. Requirements locked in `docs/REQUIREMENTS.md` (§12 security, §14 Docker,
§15 CI). **Final milestone** — after this the app is feature-complete and production-hardened per spec.

## Goal

Close the remaining §12 security gaps (rate limiting, request body limits, sliding session refresh) and
complete the §15 CI pipeline (golangci-lint, frontend eslint + vitest, Docker image builds) — with the
CSRF and secrets decisions recorded as documented choices.

## Scope

In scope:

- **Rate limiting** — in-memory token-bucket middleware: per-IP on auth, per-user on authed writes.
- **Body size limit** — `http.MaxBytesReader` middleware on `/api`.
- **Sliding session refresh** — re-issue the session cookie on activity near expiry (keep 7-day window).
- **CSRF + secrets** — documented decisions in this spec + `docs/REQUIREMENTS.md` (no code beyond what
  already exists).
- **CI** — add `golangci-lint` (+ a `.golangci.yml`) to backend CI and fix what it surfaces; add
  `eslint` + `vitest run` to frontend CI; add a build-only Docker image job; align the backend
  Dockerfile Go base to 1.26.

Out of scope: a CSRF token (SameSite=Lax is accepted — see Decisions); a distributed rate limiter (the
app is a single in-process instance); pushing images to a registry / actual deployment (§17.5 deferred);
secret rotation (a deploy-time operational step, noted not automated).

## Security hardening

### Rate limiting (`internal/httpapi/ratelimit.go`)

An in-memory keyed token-bucket limiter built on `golang.org/x/time/rate` (already a dependency):

- `keyedLimiter{ limit rate.Limit; burst int; mu sync.Mutex; entries map[string]*entry }` where
  `entry{ lim *rate.Limiter; lastSeen time.Time }`. `Allow(key)` lazily creates a per-key
  `rate.Limiter`, records `lastSeen`, and returns `lim.Allow()`. A lightweight sweep drops entries idle
  beyond a TTL (e.g. on each `Allow`, opportunistically, or a periodic goroutine) so the map can't grow
  unbounded.
- Two middlewares (methods on `*Deps`, using limiters held on `Deps`, constructed in `NewRouter`):
  - **`RateLimitIP`** — keyed by client IP (`r.RemoteAddr`; `middleware.RealIP` already normalizes it).
    Applied to `POST /api/auth/google`. Limit ≈ **10/min, burst 5** (`authRate`/`authBurst` constants).
  - **`RateLimitWrites`** — applied to the authed (`priv`) group **after `RequireAuth`**; it limits only
    **mutating methods** (`POST`/`PUT`/`PATCH`/`DELETE`) keyed by the **session user id** from context;
    `GET`/`HEAD` pass through untouched. Limit ≈ **60/min, burst 20** (`writeRate`/`writeBurst`).
- On limit exceeded: set `Retry-After` (seconds) and respond **429** via `writeError(w, 429, "rate limited")`.
- Limits are named constants (not settings — YAGNI; can graduate to the settings table later if needed).

This covers the §12 letter (auth + prediction-write) **and** the admin-write/recompute concerns from the
M7/M8 security reviews (all authed writes are limited by the single per-user write middleware).

### Body size limit

A `maxBodyBytes(n int64)` middleware sets `r.Body = http.MaxBytesReader(w, r.Body, n)` (n = **1 MiB**),
applied to the `/api` group. An over-limit body makes `json.Decode` fail, which the existing handlers
already turn into a 400 (`"invalid JSON body"`) — so no per-handler change is needed; the cap is enforced
in one place for every endpoint.

### Sliding session refresh

`RequireAuth` already decodes the session and loads the user. After a successful load, if the session is
within its **last 6 days** (i.e. `ExpiresAt - now < sessionTTL - refreshThreshold`, `refreshThreshold = 24h`),
it re-issues the cookie via the existing `setSessionCookie(w, u.ID)` — sliding the 7-day window forward on
activity. A freshly-issued cookie (issued <1 day ago) is **not** re-issued, so bursts don't spam
`Set-Cookie`. Idle users still expire at 7 days. Uses the package `now()` clock var (testable). This
satisfies §12's "refreshed on activity" while keeping the 7-day window (per the chosen option).

### CSRF — documented decision (no code)

§12 mentions "SameSite plus a CSRF token". The session cookie is **`SameSite=Lax` + `HttpOnly` + `Secure`**,
which already blocks cross-site state-changing (POST/PUT/DELETE) requests from carrying the cookie. For an
internal, Google-Workspace-SSO-gated tool this is the accepted CSRF defense (every M7/M8 security review
concurred). **Decision: keep SameSite=Lax; do not add a CSRF token.** Recorded in `docs/REQUIREMENTS.md`
§12 as a documented deviation. (A double-submit token can be added later if the app is ever exposed beyond
the internal SSO boundary.)

### Secrets — documented note (no code)

`.env` is git-ignored; CI/production inject secrets via GitHub Actions / RDS secrets (§12). The local
`backend/.env` holds working dev secrets; **`SESSION_SECRET` and `FOOTBALL_DATA_API_KEY` must be rotated
before any production deploy** (they appeared in dev logs/history). This is an operational deploy-time
step, noted in the spec, not automated here.

## CI (`.github/workflows/ci.yml`) — complete to §15

- **Backend job:** keep vet + `go test` + `sqlc diff`; **add `golangci-lint`** (via
  `golangci/golangci-lint-action`). Add a repo `.golangci.yml` enabling a sensible default set
  (`govet`, `staticcheck`, `errcheck`, `ineffassign`, `unused`, `gofmt`/`gofumpt`); **fix every issue the
  gate surfaces** across the existing code so CI is green. The lefthook `backend-lint` hook already runs
  `golangci-lint` when installed — this makes it authoritative in CI too.
- **Frontend job:** keep `tsc --noEmit` + `build`; **add `pnpm exec eslint .`** and **`pnpm vitest run`**
  (tests are currently not run in CI).
- **Docker images:** add a job (after backend+frontend pass) that **builds** both `backend/Dockerfile`
  and `frontend/Dockerfile` (build-only, `push: false`) to validate they build on CI. No registry push
  (deploy deferred).
- **Dockerfile:** align the backend builder base to **`golang:1.26`** (matches `go.mod`); the spec's
  "1.22" was indicative.

## Testing (TDD; backend the high-value surface)

- **Rate limiter** (`ratelimit_test.go`): `Allow` returns true under the limit and false once the burst is
  exhausted; two different keys are isolated; idle-entry cleanup; the `RateLimitWrites` middleware lets
  `GET` through and only counts mutating methods; a throttled request returns **429 with `Retry-After`**;
  per-IP vs per-user keying picks the right key.
- **Body limit:** a request body over the cap → 400 (decode fails under `MaxBytesReader`); a normal body
  passes.
- **Sliding refresh** (`middleware_test.go`/`RequireAuth`): a near-expiry session re-issues the cookie
  (a `Set-Cookie` appears, with a later expiry); a fresh session does **not** re-issue; an expired/invalid
  session still 401s (unchanged).
- **Regression:** the full `go test ./...` + `pnpm vitest run` stay green, and `golangci-lint run` passes
  on the whole module.

## Definition of Done

- Rate limiting live: auth per-IP + all authed writes per-user; over-limit → 429 + `Retry-After`; tests
  cover allow/deny/isolation/method-gating.
- `MaxBytesReader` caps request bodies on `/api`; oversize → 400.
- Sessions slide on activity (re-issued near expiry), idle expire at 7 days; tested.
- CSRF (SameSite-Lax) + secrets decisions documented in `docs/REQUIREMENTS.md` §12.
- CI runs golangci-lint + go test + sqlc-diff (backend) and eslint + tsc + vitest (frontend), then builds
  both Docker images; `.golangci.yml` added and the codebase passes it; backend Dockerfile on Go 1.26.
- `go vet` + `go test ./...` + `golangci-lint run` green; `pnpm tsc --noEmit` + `pnpm vitest run` +
  `pnpm build` green.
- Live-verified: hammering `POST /api/auth/google` past the limit → 429 + `Retry-After`; a normal user
  flow is unaffected; an active session keeps working past day 1 (cookie re-issued).
