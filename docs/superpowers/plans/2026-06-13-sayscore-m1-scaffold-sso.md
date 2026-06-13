# SayScore — Milestone 1: Scaffold + Google SSO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo and deliver end-to-end Google Workspace SSO (restricted to `sayonetech.com`) that auto-provisions a user, issues a signed session cookie, and serves the signed-in profile at `GET /api/me`, with a minimal React/Vite frontend that signs in and shows the profile.

**Architecture:** A Go (chi) backend in `backend/` exposes a small JSON API. Sign-in flow: the frontend gets a Google ID token via Google Identity Services and POSTs it to `/api/auth/google`; the backend verifies the token (`google.golang.org/api/idtoken`), gates on the `hd`/`email_verified` claims, upserts the user (sqlc + MySQL), and sets an httpOnly HMAC-signed session cookie. Subsequent requests carry the cookie; auth middleware decodes it and loads the user. Pure logic (session signing, domain gate) is unit-tested with no I/O; HTTP handlers are tested against a fake store so tests need no live DB. The frontend is a Vite React+TS SPA with the dark-first design tokens from spec §7.

**Tech Stack:** Go 1.22+, `go-chi/chi/v5`, `go-sql-driver/mysql`, `sqlc`, `golang-migrate`, `google.golang.org/api/idtoken`, stdlib `crypto/hmac`+`slog`; React 18 + TypeScript + Vite, Tailwind, TanStack Query, Google Identity Services; MySQL 8 via Docker Compose for local dev.

**Spec references:** §2 (roles), §3.1 (auth), §8 (stack), §9 (layout — module path `github.com/sayonetech/worldcup-predictor/backend`), §10 (users table), §11 (`/api/auth/*`, `/api/me`, `/healthz`), §12 (security), §7 (design tokens). Mirrors README "Building with Superpowers" Milestone 1.

---

## File Structure (Milestone 1)

**Backend (`backend/`)**
- `go.mod` / `go.sum` — module `github.com/sayonetech/worldcup-predictor/backend`
- `cmd/server/main.go` — entrypoint: load config, open DB, build deps, start chi server
- `internal/config/config.go` — env-driven config struct + loader (12-factor)
- `internal/auth/session.go` — HMAC-signed session cookie encode/decode (pure)
- `internal/auth/google.go` — `TokenVerifier` interface + real idtoken impl + `GoogleClaims`
- `internal/auth/domain.go` — pure `CheckDomain` (the `hd`/`email_verified` gate)
- `internal/store/store.go` — `Store` interface consumed by handlers
- `internal/store/db.go` — `OpenMySQL` + sqlc `Queries` adapter to `Store`
- `internal/store/queries/users.sql` — sqlc query definitions
- `internal/store/sqlc/` — sqlc-generated code (do not edit by hand)
- `internal/httpapi/router.go` — chi router assembly + middleware wiring
- `internal/httpapi/auth_handlers.go` — `/api/auth/google`, `/api/auth/logout`
- `internal/httpapi/me_handler.go` — `/api/me`
- `internal/httpapi/middleware.go` — session auth middleware + context helpers
- `internal/httpapi/health.go` — `/healthz`
- `migrations/0001_create_users.up.sql` / `.down.sql`
- `sqlc.yaml`
- `Dockerfile` (stub for M1; full build hardened in Milestone 9)

**Repo root**
- `.gitignore`, `.env.example`, `Makefile`
- `deploy/docker-compose.yml` — MySQL 8 (+ adminer) for local dev

**Frontend (`frontend/`)**
- `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`
- `src/main.tsx`, `src/App.tsx`
- `src/lib/api.ts` — fetch wrapper (credentials: include)
- `src/lib/auth.tsx` — `useMe` query + Google sign-in button
- `src/styles/tokens.css` — dark-first tokens (subset of §7.2)
- `.env.example` (Vite vars)

> **Design-skill note:** M1's UI is intentionally tiny (a sign-in button + profile line), so it is hand-coded here. The richer screens in later milestones (Fixtures, Ranks, Bonus, Admin) are built with the **`impeccable`** design skill against spec §7 — do **not** invoke it for this milestone.

---

## Conventions used by every task

- Run backend commands from `backend/`. Run frontend commands from `frontend/`.
- Commit messages follow Conventional Commits (a `commitlint` hook lands in Milestone 9; follow the format now).
- After each task the working tree is clean and the slice still builds.

---

### Task 0: Repo scaffold (gitignore, env example, Makefile)

**Files:**
- Create: `.gitignore`
- Create: `.env.example`
- Create: `Makefile`

- [ ] **Step 1: Create `.gitignore`**

```gitignore
# env / secrets
.env
*.env
!*.env.example

# Go
backend/server
backend/tmp/
*.test
*.out

# Node
frontend/node_modules/
frontend/dist/
frontend/.vite/

# OS / editor
.DS_Store
```

- [ ] **Step 2: Create `.env.example`** (backend + frontend vars from spec §14)

```dotenv
# ---- Backend ----
APP_ENV=development
HTTP_PORT=8000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=wcp
DB_PASSWORD=wcp
DB_NAME=wcp
SESSION_SECRET=change-me-to-a-random-32-byte-string
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
ALLOWED_EMAIL_DOMAIN=sayonetech.com
SEED_ADMIN_EMAILS=you@sayonetech.com
TZ=Asia/Kolkata

# ---- Frontend (Vite) ----
VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
VITE_API_BASE_URL=/api
```

- [ ] **Step 3: Create `Makefile`** (M1 targets; more added later)

```makefile
.PHONY: up down logs migrate-up migrate-down sqlc test lint

up:
	docker compose -f deploy/docker-compose.yml up -d

down:
	docker compose -f deploy/docker-compose.yml down

logs:
	docker compose -f deploy/docker-compose.yml logs -f

# Requires golang-migrate CLI: https://github.com/golang-migrate/migrate
MIGRATE_DSN=mysql://$(DB_USER):$(DB_PASSWORD)@tcp($(DB_HOST):$(DB_PORT))/$(DB_NAME)
migrate-up:
	migrate -path backend/migrations -database "$(MIGRATE_DSN)" up

migrate-down:
	migrate -path backend/migrations -database "$(MIGRATE_DSN)" down 1

sqlc:
	cd backend && sqlc generate

test:
	cd backend && go test ./...

lint:
	cd backend && go vet ./...
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore .env.example Makefile
git commit -m "chore: scaffold repo root (gitignore, env example, Makefile)"
```

---

### Task 1: Backend module + config + `/healthz`

**Files:**
- Create: `backend/go.mod` (via `go mod init`)
- Create: `backend/internal/config/config.go`
- Test: `backend/internal/config/config_test.go`
- Create: `backend/internal/httpapi/health.go`
- Test: `backend/internal/httpapi/health_test.go`

- [ ] **Step 1: Initialise the module and add chi**

```bash
cd backend
go mod init github.com/sayonetech/worldcup-predictor/backend
go get github.com/go-chi/chi/v5@latest
```

Expected: `go.mod` shows `module github.com/sayonetech/worldcup-predictor/backend` and a `chi/v5` require.

- [ ] **Step 2: Write the failing config test**

`backend/internal/config/config_test.go`:

```go
package config

import "testing"

func TestLoadReadsEnvAndAppliesDefaults(t *testing.T) {
	t.Setenv("HTTP_PORT", "")
	t.Setenv("APP_ENV", "")
	t.Setenv("SESSION_SECRET", "secret")
	t.Setenv("GOOGLE_CLIENT_ID", "client-id")
	t.Setenv("ALLOWED_EMAIL_DOMAIN", "sayonetech.com")
	t.Setenv("SEED_ADMIN_EMAILS", "a@sayonetech.com, b@sayonetech.com")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.HTTPPort != "8000" {
		t.Errorf("HTTPPort default = %q, want 8000", cfg.HTTPPort)
	}
	if cfg.AppEnv != "development" {
		t.Errorf("AppEnv default = %q, want development", cfg.AppEnv)
	}
	if cfg.IsProduction() {
		t.Errorf("IsProduction() = true, want false for development")
	}
	if len(cfg.SeedAdminEmails) != 2 || cfg.SeedAdminEmails[0] != "a@sayonetech.com" {
		t.Errorf("SeedAdminEmails = %v, want trimmed 2-element slice", cfg.SeedAdminEmails)
	}
}

func TestLoadRequiresSessionSecret(t *testing.T) {
	t.Setenv("SESSION_SECRET", "")
	t.Setenv("GOOGLE_CLIENT_ID", "client-id")
	if _, err := Load(); err == nil {
		t.Fatal("Load() error = nil, want error for missing SESSION_SECRET")
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && go test ./internal/config/ -run TestLoad -v`
Expected: build failure / FAIL — `Load` undefined.

- [ ] **Step 4: Implement config**

`backend/internal/config/config.go`:

```go
// Package config loads 12-factor environment configuration.
package config

import (
	"fmt"
	"os"
	"strings"
)

type Config struct {
	AppEnv             string
	HTTPPort           string
	DBHost             string
	DBPort             string
	DBUser             string
	DBPassword         string
	DBName             string
	SessionSecret      string
	GoogleClientID     string
	AllowedEmailDomain string
	SeedAdminEmails    []string
}

func (c Config) IsProduction() bool { return c.AppEnv == "production" }

// DSN returns a go-sql-driver/mysql DSN (parseTime so DATETIME scans into time.Time).
func (c Config) DSN() string {
	return fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?parseTime=true&loc=UTC",
		c.DBUser, c.DBPassword, c.DBHost, c.DBPort, c.DBName)
}

func Load() (Config, error) {
	c := Config{
		AppEnv:             getenv("APP_ENV", "development"),
		HTTPPort:           getenv("HTTP_PORT", "8000"),
		DBHost:             getenv("DB_HOST", "127.0.0.1"),
		DBPort:             getenv("DB_PORT", "3306"),
		DBUser:             getenv("DB_USER", "wcp"),
		DBPassword:         getenv("DB_PASSWORD", "wcp"),
		DBName:             getenv("DB_NAME", "wcp"),
		SessionSecret:      os.Getenv("SESSION_SECRET"),
		GoogleClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		AllowedEmailDomain: getenv("ALLOWED_EMAIL_DOMAIN", "sayonetech.com"),
		SeedAdminEmails:    splitTrim(os.Getenv("SEED_ADMIN_EMAILS")),
	}
	if c.SessionSecret == "" {
		return Config{}, fmt.Errorf("config: SESSION_SECRET is required")
	}
	if c.GoogleClientID == "" {
		return Config{}, fmt.Errorf("config: GOOGLE_CLIENT_ID is required")
	}
	return c, nil
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func splitTrim(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}
```

- [ ] **Step 5: Run config test to verify it passes**

Run: `cd backend && go test ./internal/config/ -v`
Expected: PASS.

- [ ] **Step 6: Write the failing `/healthz` test**

`backend/internal/httpapi/health_test.go`:

```go
package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthz(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()

	Healthz(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := rec.Body.String(); got != `{"status":"ok"}` {
		t.Errorf("body = %q, want healthz json", got)
	}
}
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd backend && go test ./internal/httpapi/ -run TestHealthz -v`
Expected: FAIL — `Healthz` undefined.

- [ ] **Step 8: Implement `/healthz`**

`backend/internal/httpapi/health.go`:

```go
package httpapi

import "net/http"

// Healthz is an unauthenticated liveness probe.
func Healthz(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd backend && go test ./internal/httpapi/ -v`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add backend/go.mod backend/go.sum backend/internal/config backend/internal/httpapi
git commit -m "feat(backend): module init, env config, and /healthz"
```

---

### Task 2: Signed session cookie (pure, no I/O)

**Files:**
- Create: `backend/internal/auth/session.go`
- Test: `backend/internal/auth/session_test.go`

- [ ] **Step 1: Write the failing test**

`backend/internal/auth/session_test.go`:

```go
package auth

import (
	"testing"
	"time"
)

func TestSessionRoundTrip(t *testing.T) {
	m := NewSessionManager("super-secret-key")
	token := m.Encode(Session{UserID: 42}, time.Hour)

	got, err := m.Decode(token)
	if err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if got.UserID != 42 {
		t.Errorf("UserID = %d, want 42", got.UserID)
	}
}

func TestDecodeRejectsTamperedToken(t *testing.T) {
	m := NewSessionManager("super-secret-key")
	token := m.Encode(Session{UserID: 42}, time.Hour)

	if _, err := m.Decode(token + "x"); err == nil {
		t.Fatal("Decode() error = nil, want signature error on tampered token")
	}
}

func TestDecodeRejectsWrongKey(t *testing.T) {
	token := NewSessionManager("key-a").Encode(Session{UserID: 1}, time.Hour)
	if _, err := NewSessionManager("key-b").Decode(token); err == nil {
		t.Fatal("Decode() error = nil, want signature error under different key")
	}
}

func TestDecodeRejectsExpired(t *testing.T) {
	m := NewSessionManager("super-secret-key")
	token := m.Encode(Session{UserID: 7}, -1*time.Minute) // already expired
	if _, err := m.Decode(token); err == nil {
		t.Fatal("Decode() error = nil, want expiry error")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/auth/ -run TestSession -v`
Expected: FAIL — `NewSessionManager`/`Session` undefined.

- [ ] **Step 3: Implement the session manager**

`backend/internal/auth/session.go`:

```go
// Package auth holds authentication primitives: session cookies, Google
// ID-token verification, and the domain gate. Pure logic here is I/O-free.
package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// Session is the payload carried (signed, not encrypted) in the cookie.
type Session struct {
	UserID    int64 `json:"uid"`
	ExpiresAt int64 `json:"exp"` // unix seconds
}

type SessionManager struct {
	key []byte
}

func NewSessionManager(secret string) *SessionManager {
	return &SessionManager{key: []byte(secret)}
}

// Encode returns "<base64url(payload)>.<base64url(hmac)>".
func (m *SessionManager) Encode(s Session, ttl time.Duration) string {
	s.ExpiresAt = nowUTC().Add(ttl).Unix()
	body, _ := json.Marshal(s)
	b64 := base64.RawURLEncoding.EncodeToString(body)
	return b64 + "." + m.sign(b64)
}

func (m *SessionManager) Decode(token string) (Session, error) {
	b64, sig, ok := strings.Cut(token, ".")
	if !ok {
		return Session{}, errors.New("session: malformed token")
	}
	if !hmac.Equal([]byte(sig), []byte(m.sign(b64))) {
		return Session{}, errors.New("session: bad signature")
	}
	body, err := base64.RawURLEncoding.DecodeString(b64)
	if err != nil {
		return Session{}, errors.New("session: bad encoding")
	}
	var s Session
	if err := json.Unmarshal(body, &s); err != nil {
		return Session{}, errors.New("session: bad payload")
	}
	if nowUTC().Unix() >= s.ExpiresAt {
		return Session{}, errors.New("session: expired")
	}
	return s, nil
}

func (m *SessionManager) sign(b64 string) string {
	h := hmac.New(sha256.New, m.key)
	h.Write([]byte(b64))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

// nowUTC is a package var so tests could override it if ever needed.
var nowUTC = func() time.Time { return time.Now().UTC() }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && go test ./internal/auth/ -run TestSession -v`
Expected: PASS (all four cases).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/auth/session.go backend/internal/auth/session_test.go
git commit -m "feat(auth): HMAC-signed session cookie encode/decode"
```

---

### Task 3: Google ID-token verification + domain gate

**Files:**
- Create: `backend/internal/auth/domain.go`
- Test: `backend/internal/auth/domain_test.go`
- Create: `backend/internal/auth/google.go`

- [ ] **Step 1: Write the failing domain-gate test**

`backend/internal/auth/domain_test.go`:

```go
package auth

import "testing"

func TestCheckDomainAcceptsMatchingVerifiedHostedDomain(t *testing.T) {
	c := GoogleClaims{Email: "dev@sayonetech.com", EmailVerified: true, HostedDomain: "sayonetech.com"}
	if err := CheckDomain(c, "sayonetech.com"); err != nil {
		t.Fatalf("CheckDomain() = %v, want nil", err)
	}
}

func TestCheckDomainRejectsWrongHostedDomain(t *testing.T) {
	c := GoogleClaims{Email: "x@gmail.com", EmailVerified: true, HostedDomain: "gmail.com"}
	if err := CheckDomain(c, "sayonetech.com"); err == nil {
		t.Fatal("CheckDomain() = nil, want error for wrong hd")
	}
}

func TestCheckDomainRejectsUnverifiedEmail(t *testing.T) {
	c := GoogleClaims{Email: "dev@sayonetech.com", EmailVerified: false, HostedDomain: "sayonetech.com"}
	if err := CheckDomain(c, "sayonetech.com"); err == nil {
		t.Fatal("CheckDomain() = nil, want error for email_verified=false")
	}
}

func TestCheckDomainRejectsMismatchedEmailSuffix(t *testing.T) {
	// hd present and correct, but email is on another domain — secondary guard.
	c := GoogleClaims{Email: "attacker@evil.com", EmailVerified: true, HostedDomain: "sayonetech.com"}
	if err := CheckDomain(c, "sayonetech.com"); err == nil {
		t.Fatal("CheckDomain() = nil, want error when email suffix != domain")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/auth/ -run TestCheckDomain -v`
Expected: FAIL — `CheckDomain`/`GoogleClaims` undefined.

- [ ] **Step 3: Implement claims type + domain gate**

`backend/internal/auth/domain.go`:

```go
package auth

import (
	"fmt"
	"strings"
)

// GoogleClaims is the subset of verified ID-token claims we use.
type GoogleClaims struct {
	Subject       string
	Email         string
	EmailVerified bool
	Name          string
	Picture       string
	HostedDomain  string // the "hd" claim
}

// CheckDomain enforces the §3.1 gate: the hd claim is the primary gate;
// email_verified and the email suffix are secondary guards.
func CheckDomain(c GoogleClaims, allowedDomain string) error {
	if !c.EmailVerified {
		return fmt.Errorf("auth: email not verified")
	}
	if !strings.EqualFold(c.HostedDomain, allowedDomain) {
		return fmt.Errorf("auth: hosted domain %q not allowed", c.HostedDomain)
	}
	if !strings.HasSuffix(strings.ToLower(c.Email), "@"+strings.ToLower(allowedDomain)) {
		return fmt.Errorf("auth: email %q outside allowed domain", c.Email)
	}
	return nil
}
```

- [ ] **Step 4: Run domain test to verify it passes**

Run: `cd backend && go test ./internal/auth/ -run TestCheckDomain -v`
Expected: PASS.

- [ ] **Step 5: Add the verifier interface + real Google implementation**

(No unit test for the real network verifier — it calls Google. It is exercised via the handler tests using a fake. We only need it to compile and satisfy the interface.)

```bash
cd backend && go get google.golang.org/api/idtoken@latest
```

`backend/internal/auth/google.go`:

```go
package auth

import (
	"context"
	"fmt"

	"google.golang.org/api/idtoken"
)

// TokenVerifier verifies a raw Google ID token and returns its claims.
// Handlers depend on this interface so tests can supply a fake.
type TokenVerifier interface {
	Verify(ctx context.Context, rawIDToken string) (GoogleClaims, error)
}

// GoogleTokenVerifier validates tokens against Google's keys for our audience.
type GoogleTokenVerifier struct {
	ClientID string
}

func (v GoogleTokenVerifier) Verify(ctx context.Context, rawIDToken string) (GoogleClaims, error) {
	payload, err := idtoken.Validate(ctx, rawIDToken, v.ClientID)
	if err != nil {
		return GoogleClaims{}, fmt.Errorf("auth: invalid id token: %w", err)
	}
	return GoogleClaims{
		Subject:       payload.Subject,
		Email:         claimString(payload.Claims, "email"),
		EmailVerified: claimBool(payload.Claims, "email_verified"),
		Name:          claimString(payload.Claims, "name"),
		Picture:       claimString(payload.Claims, "picture"),
		HostedDomain:  claimString(payload.Claims, "hd"),
	}, nil
}

func claimString(m map[string]any, k string) string {
	if v, ok := m[k].(string); ok {
		return v
	}
	return ""
}

func claimBool(m map[string]any, k string) bool {
	if v, ok := m[k].(bool); ok {
		return v
	}
	return false
}
```

- [ ] **Step 6: Verify everything compiles + passes**

Run: `cd backend && go build ./... && go test ./internal/auth/ -v`
Expected: build OK, all auth tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/auth/domain.go backend/internal/auth/domain_test.go backend/internal/auth/google.go backend/go.mod backend/go.sum
git commit -m "feat(auth): Google ID-token verifier and domain gate"
```

---

### Task 4: MySQL — users migration, sqlc, and store

**Files:**
- Create: `backend/migrations/0001_create_users.up.sql`
- Create: `backend/migrations/0001_create_users.down.sql`
- Create: `backend/sqlc.yaml`
- Create: `backend/internal/store/queries/users.sql`
- Create: `backend/internal/store/sqlc/` (generated)
- Create: `backend/internal/store/store.go`
- Create: `backend/internal/store/db.go`

- [ ] **Step 1: Write the users migration (up)**

`backend/migrations/0001_create_users.up.sql` (matches spec §10):

```sql
CREATE TABLE users (
    id         BIGINT       NOT NULL AUTO_INCREMENT,
    email      VARCHAR(320) NOT NULL,
    name       VARCHAR(255) NOT NULL DEFAULT '',
    avatar_url VARCHAR(1024) NOT NULL DEFAULT '',
    role       ENUM('user','admin') NOT NULL DEFAULT 'user',
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 2: Write the migration (down)**

`backend/migrations/0001_create_users.down.sql`:

```sql
DROP TABLE IF EXISTS users;
```

- [ ] **Step 3: Write the sqlc config**

`backend/sqlc.yaml`:

```yaml
version: "2"
sql:
  - engine: "mysql"
    schema: "migrations"
    queries: "internal/store/queries"
    gen:
      go:
        package: "sqlc"
        out: "internal/store/sqlc"
        emit_json_tags: true
        emit_interface: false
```

- [ ] **Step 4: Write the user queries**

`backend/internal/store/queries/users.sql`:

```sql
-- name: GetUserByID :one
SELECT id, email, name, avatar_url, role, created_at
FROM users WHERE id = ?;

-- name: GetUserByEmail :one
SELECT id, email, name, avatar_url, role, created_at
FROM users WHERE email = ?;

-- name: UpsertUser :execresult
INSERT INTO users (email, name, avatar_url, role)
VALUES (?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    avatar_url = VALUES(avatar_url);

-- name: SetUserRole :exec
UPDATE users SET role = ? WHERE id = ?;
```

- [ ] **Step 5: Generate sqlc code**

```bash
cd backend
# Install sqlc if missing: go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
sqlc generate
```

Expected: files appear under `internal/store/sqlc/` (`db.go`, `models.go`, `users.sql.go`). No errors.

- [ ] **Step 6: Define the store interface handlers will use**

`backend/internal/store/store.go`:

```go
// Package store provides DB access. Handlers depend on the Store interface
// so they can be tested against a fake without a live MySQL.
package store

import "context"

type Role string

const (
	RoleUser  Role = "user"
	RoleAdmin Role = "admin"
)

type User struct {
	ID        int64
	Email     string
	Name      string
	AvatarURL string
	Role      Role
}

// UpsertUserParams carries the verified Google profile for provisioning.
type UpsertUserParams struct {
	Email     string
	Name      string
	AvatarURL string
	Role      Role // role applied only on first insert (seed admins)
}

type Store interface {
	// UpsertUser provisions or refreshes a user by email and returns the row.
	UpsertUser(ctx context.Context, p UpsertUserParams) (User, error)
	GetUserByID(ctx context.Context, id int64) (User, error)
	SetUserRole(ctx context.Context, id int64, role Role) error
}
```

- [ ] **Step 7: Implement the sqlc-backed store + DB opener**

`backend/internal/store/db.go`:

```go
package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store/sqlc"

	_ "github.com/go-sql-driver/mysql"
)

// OpenMySQL opens and pings a MySQL connection pool.
func OpenMySQL(dsn string) (*sql.DB, error) {
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, fmt.Errorf("store: open: %w", err)
	}
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetMaxOpenConns(10)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("store: ping: %w", err)
	}
	return db, nil
}

// SQLStore adapts the sqlc Queries to the Store interface.
type SQLStore struct {
	db *sql.DB
	q  *sqlc.Queries
}

func New(db *sql.DB) *SQLStore { return &SQLStore{db: db, q: sqlc.New(db)} }

func (s *SQLStore) UpsertUser(ctx context.Context, p UpsertUserParams) (User, error) {
	role := p.Role
	if role == "" {
		role = RoleUser
	}
	_, err := s.q.UpsertUser(ctx, sqlc.UpsertUserParams{
		Email:     p.Email,
		Name:      p.Name,
		AvatarUrl: p.AvatarURL,
		Role:      sqlc.UsersRole(role),
	})
	if err != nil {
		return User{}, fmt.Errorf("store: upsert: %w", err)
	}
	row, err := s.q.GetUserByEmail(ctx, p.Email)
	if err != nil {
		return User{}, fmt.Errorf("store: get after upsert: %w", err)
	}
	return toUser(row), nil
}

func (s *SQLStore) GetUserByID(ctx context.Context, id int64) (User, error) {
	row, err := s.q.GetUserByID(ctx, id)
	if err != nil {
		return User{}, err
	}
	return toUser(row), nil
}

func (s *SQLStore) SetUserRole(ctx context.Context, id int64, role Role) error {
	return s.q.SetUserRole(ctx, sqlc.SetUserRoleParams{Role: sqlc.UsersRole(role), ID: id})
}

func toUser(r sqlc.User) User {
	return User{
		ID:        r.ID,
		Email:     r.Email,
		Name:      r.Name,
		AvatarURL: r.AvatarUrl,
		Role:      Role(r.Role),
	}
}
```

> **Note on generated field names:** sqlc derives Go field names from columns (`avatar_url` → `AvatarUrl`) and the enum type as `UsersRole`. If `sqlc generate` produced different identifiers, adjust `db.go` to match the generated `models.go` — the generated code is the source of truth.

- [ ] **Step 8: Tidy and verify compilation**

```bash
cd backend
go get github.com/go-sql-driver/mysql@latest
go mod tidy
go build ./...
```

Expected: builds with no errors.

- [ ] **Step 9: Commit**

```bash
git add backend/migrations backend/sqlc.yaml backend/internal/store backend/go.mod backend/go.sum
git commit -m "feat(store): users migration, sqlc queries, and MySQL store"
```

---

### Task 5: Auth middleware + handlers (`/api/auth/google`, `/api/auth/logout`, `/api/me`)

**Files:**
- Create: `backend/internal/httpapi/middleware.go`
- Create: `backend/internal/httpapi/auth_handlers.go`
- Create: `backend/internal/httpapi/me_handler.go`
- Create: `backend/internal/httpapi/router.go`
- Test: `backend/internal/httpapi/auth_test.go`

- [ ] **Step 1: Implement the deps struct, context helpers, and middleware**

`backend/internal/httpapi/middleware.go`:

```go
package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/auth"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

const sessionCookieName = "sayscore_session"
const sessionTTL = 7 * 24 * time.Hour

type ctxKey int

const userCtxKey ctxKey = iota

// Deps holds everything the HTTP layer needs. Built in cmd/server.
type Deps struct {
	Store              store.Store
	Sessions           *auth.SessionManager
	Verifier           auth.TokenVerifier
	AllowedEmailDomain string
	Secure             bool // Secure flag on the cookie (false for local http)
}

func userFromContext(ctx context.Context) (store.User, bool) {
	u, ok := ctx.Value(userCtxKey).(store.User)
	return u, ok
}

// RequireAuth loads the user from the session cookie or returns 401.
func (d *Deps) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(sessionCookieName)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "not authenticated")
			return
		}
		sess, err := d.Sessions.Decode(c.Value)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "invalid session")
			return
		}
		u, err := d.Store.GetUserByID(r.Context(), sess.UserID)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "user not found")
			return
		}
		ctx := context.WithValue(r.Context(), userCtxKey, u)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (d *Deps) setSessionCookie(w http.ResponseWriter, userID int64) {
	token := d.Sessions.Encode(auth.Session{UserID: userID}, sessionTTL)
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   d.Secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(sessionTTL.Seconds()),
	})
}

func (d *Deps) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookieName, Value: "", Path: "/",
		HttpOnly: true, Secure: d.Secure, SameSite: http.SameSiteLaxMode, MaxAge: -1,
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
```

- [ ] **Step 2: Implement the auth handlers**

`backend/internal/httpapi/auth_handlers.go`:

```go
package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/sayonetech/worldcup-predictor/backend/internal/auth"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

type googleLoginRequest struct {
	IDToken string `json:"id_token"`
}

// PostAuthGoogle verifies a Google ID token, gates on the domain, upserts the
// user, sets the session cookie, and returns the user.
func (d *Deps) PostAuthGoogle(w http.ResponseWriter, r *http.Request) {
	var body googleLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.IDToken == "" {
		writeError(w, http.StatusBadRequest, "id_token required")
		return
	}

	claims, err := d.Verifier.Verify(r.Context(), body.IDToken)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid Google token")
		return
	}
	if err := auth.CheckDomain(claims, d.AllowedEmailDomain); err != nil {
		writeError(w, http.StatusForbidden, "sign-in restricted to "+d.AllowedEmailDomain)
		return
	}

	u, err := d.Store.UpsertUser(r.Context(), store.UpsertUserParams{
		Email:     claims.Email,
		Name:      claims.Name,
		AvatarURL: claims.Picture,
		Role:      store.RoleUser, // seed-admin promotion handled at startup (Task 6)
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not provision user")
		return
	}

	d.setSessionCookie(w, u.ID)
	writeJSON(w, http.StatusOK, userResponse(u))
}

// PostAuthLogout clears the session cookie.
func (d *Deps) PostAuthLogout(w http.ResponseWriter, _ *http.Request) {
	d.clearSessionCookie(w)
	writeJSON(w, http.StatusOK, map[string]string{"status": "logged out"})
}
```

- [ ] **Step 3: Implement `/api/me`**

`backend/internal/httpapi/me_handler.go`:

```go
package httpapi

import (
	"net/http"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

type meResponse struct {
	ID        int64  `json:"id"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	Role      string `json:"role"`
}

func userResponse(u store.User) meResponse {
	return meResponse{ID: u.ID, Email: u.Email, Name: u.Name, AvatarURL: u.AvatarURL, Role: string(u.Role)}
}

// GetMe returns the authenticated user (RequireAuth populated the context).
func (d *Deps) GetMe(w http.ResponseWriter, r *http.Request) {
	u, ok := userFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	writeJSON(w, http.StatusOK, userResponse(u))
}
```

- [ ] **Step 4: Implement the router**

`backend/internal/httpapi/router.go`:

```go
package httpapi

import (
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// NewRouter wires all M1 routes. debug=true enables non-production-only routes
// (none yet in M1; the debug job trigger arrives in a later milestone).
func NewRouter(d *Deps, debug bool) chi.Router {
	r := chi.NewRouter()
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)

	r.Get("/healthz", Healthz)

	r.Route("/api", func(api chi.Router) {
		api.Post("/auth/google", d.PostAuthGoogle)
		api.Post("/auth/logout", d.PostAuthLogout)

		api.Group(func(priv chi.Router) {
			priv.Use(d.RequireAuth)
			priv.Get("/me", d.GetMe)
		})
	})

	return r
}
```

- [ ] **Step 5: Write the failing handler tests (fake store + fake verifier)**

`backend/internal/httpapi/auth_test.go`:

```go
package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/sayonetech/worldcup-predictor/backend/internal/auth"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

// --- fakes ---

type fakeStore struct {
	users  map[int64]store.User
	nextID int64
}

func newFakeStore() *fakeStore { return &fakeStore{users: map[int64]store.User{}, nextID: 1} }

func (f *fakeStore) UpsertUser(_ context.Context, p store.UpsertUserParams) (store.User, error) {
	for _, u := range f.users {
		if u.Email == p.Email {
			u.Name, u.AvatarURL = p.Name, p.AvatarURL
			f.users[u.ID] = u
			return u, nil
		}
	}
	u := store.User{ID: f.nextID, Email: p.Email, Name: p.Name, AvatarURL: p.AvatarURL, Role: store.RoleUser}
	if p.Role != "" {
		u.Role = p.Role
	}
	f.users[u.ID] = u
	f.nextID++
	return u, nil
}
func (f *fakeStore) GetUserByID(_ context.Context, id int64) (store.User, error) {
	if u, ok := f.users[id]; ok {
		return u, nil
	}
	return store.User{}, errors.New("not found")
}
func (f *fakeStore) SetUserRole(_ context.Context, id int64, role store.Role) error {
	u, ok := f.users[id]
	if !ok {
		return errors.New("not found")
	}
	u.Role = role
	f.users[id] = u
	return nil
}

type fakeVerifier struct {
	claims auth.GoogleClaims
	err    error
}

func (v fakeVerifier) Verify(context.Context, string) (auth.GoogleClaims, error) {
	return v.claims, v.err
}

func newTestDeps(v auth.TokenVerifier) (*Deps, *fakeStore) {
	fs := newFakeStore()
	return &Deps{
		Store:              fs,
		Sessions:           auth.NewSessionManager("test-secret"),
		Verifier:           v,
		AllowedEmailDomain: "sayonetech.com",
		Secure:             false,
	}, fs
}

// --- tests ---

func TestLoginValidDomainSetsCookieAndProvisions(t *testing.T) {
	v := fakeVerifier{claims: auth.GoogleClaims{
		Email: "dev@sayonetech.com", EmailVerified: true, Name: "Dev", HostedDomain: "sayonetech.com",
	}}
	d, fs := newTestDeps(v)
	srv := NewRouter(d, false)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/google", strings.NewReader(`{"id_token":"x"}`))
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("login status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if len(fs.users) != 1 {
		t.Fatalf("provisioned users = %d, want 1", len(fs.users))
	}
	if !strings.Contains(rec.Header().Get("Set-Cookie"), sessionCookieName) {
		t.Fatalf("Set-Cookie missing session cookie: %q", rec.Header().Get("Set-Cookie"))
	}
}

func TestLoginRejectsWrongDomain(t *testing.T) {
	v := fakeVerifier{claims: auth.GoogleClaims{
		Email: "x@gmail.com", EmailVerified: true, HostedDomain: "gmail.com",
	}}
	d, _ := newTestDeps(v)
	srv := NewRouter(d, false)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/google", strings.NewReader(`{"id_token":"x"}`))
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestLoginRejectsInvalidToken(t *testing.T) {
	d, _ := newTestDeps(fakeVerifier{err: errors.New("bad token")})
	srv := NewRouter(d, false)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/google", strings.NewReader(`{"id_token":"x"}`))
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestMeRequiresSession(t *testing.T) {
	d, _ := newTestDeps(fakeVerifier{})
	srv := NewRouter(d, false)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestMeReturnsUserAfterLogin(t *testing.T) {
	v := fakeVerifier{claims: auth.GoogleClaims{
		Email: "dev@sayonetech.com", EmailVerified: true, Name: "Dev", HostedDomain: "sayonetech.com",
	}}
	d, _ := newTestDeps(v)
	srv := NewRouter(d, false)

	// Log in, capture the cookie.
	loginRec := httptest.NewRecorder()
	loginReq := httptest.NewRequest(http.MethodPost, "/api/auth/google", strings.NewReader(`{"id_token":"x"}`))
	srv.ServeHTTP(loginRec, loginReq)
	cookie := loginRec.Result().Cookies()[0]

	// Call /api/me with the cookie.
	meRec := httptest.NewRecorder()
	meReq := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	meReq.AddCookie(cookie)
	srv.ServeHTTP(meRec, meReq)

	if meRec.Code != http.StatusOK {
		t.Fatalf("/api/me status = %d, want 200 (body=%s)", meRec.Code, meRec.Body.String())
	}
	if !strings.Contains(meRec.Body.String(), "dev@sayonetech.com") {
		t.Fatalf("/api/me body = %s, want email", meRec.Body.String())
	}
}
```

- [ ] **Step 6: Run tests to verify they fail then pass**

Run: `cd backend && go test ./internal/httpapi/ -v`
Expected: after Steps 1–4 are in place, all tests PASS. (If you write the test first per strict TDD, it fails to compile until the handlers exist — that is the RED state.)

- [ ] **Step 7: Commit**

```bash
git add backend/internal/httpapi
git commit -m "feat(api): Google login, logout, session middleware, and /api/me"
```

---

### Task 6: `cmd/server/main.go` — wire it together + seed admins

**Files:**
- Create: `backend/cmd/server/main.go`

- [ ] **Step 1: Implement main**

`backend/cmd/server/main.go`:

```go
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/auth"
	"github.com/sayonetech/worldcup-predictor/backend/internal/config"
	"github.com/sayonetech/worldcup-predictor/backend/internal/httpapi"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		logger.Error("config", "err", err)
		os.Exit(1)
	}

	db, err := store.OpenMySQL(cfg.DSN())
	if err != nil {
		logger.Error("db", "err", err)
		os.Exit(1)
	}
	defer db.Close()

	st := store.New(db)
	seedAdmins(context.Background(), st, cfg.SeedAdminEmails, logger)

	deps := &httpapi.Deps{
		Store:              st,
		Sessions:           auth.NewSessionManager(cfg.SessionSecret),
		Verifier:           auth.GoogleTokenVerifier{ClientID: cfg.GoogleClientID},
		AllowedEmailDomain: cfg.AllowedEmailDomain,
		Secure:             cfg.IsProduction(),
	}

	router := httpapi.NewRouter(deps, !cfg.IsProduction())

	srv := &http.Server{
		Addr:              ":" + cfg.HTTPPort,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
	}
	logger.Info("listening", "port", cfg.HTTPPort, "env", cfg.AppEnv)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("server", "err", err)
		os.Exit(1)
	}
}

// seedAdmins promotes any already-existing user in the seed list to admin and
// pre-creates the rows so the first login of a seed admin is already elevated.
func seedAdmins(ctx context.Context, st store.Store, emails []string, logger *slog.Logger) {
	for _, email := range emails {
		u, err := st.UpsertUser(ctx, store.UpsertUserParams{Email: email, Role: store.RoleAdmin})
		if err != nil {
			logger.Warn("seed admin failed", "email", email, "err", err)
			continue
		}
		if u.Role != store.RoleAdmin {
			if err := st.SetUserRole(ctx, u.ID, store.RoleAdmin); err != nil {
				logger.Warn("promote seed admin failed", "email", email, "err", err)
			}
		}
	}
}
```

> **Seed-admin behaviour:** `UpsertUser` only sets role on first insert; for users who already exist as `user`, `SetUserRole` promotes them. This means a seed admin is admin whether or not they have logged in yet — satisfying §2/§3.1.

- [ ] **Step 2: Verify the whole backend builds and unit tests pass**

Run: `cd backend && go build ./... && go vet ./... && go test ./...`
Expected: builds, vet clean, all tests PASS (no DB needed — DB only used at runtime in `main`).

- [ ] **Step 3: Commit**

```bash
git add backend/cmd/server/main.go
git commit -m "feat(backend): server entrypoint wiring and seed-admin promotion"
```

---

### Task 7: Local MySQL via Docker Compose + run the migration

**Files:**
- Create: `deploy/docker-compose.yml`

- [ ] **Step 1: Write the compose file (MySQL + Adminer)**

`deploy/docker-compose.yml`:

```yaml
services:
  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: rootpw
      MYSQL_DATABASE: wcp
      MYSQL_USER: wcp
      MYSQL_PASSWORD: wcp
    ports:
      - "3306:3306"
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uwcp", "-pwcp"]
      interval: 5s
      timeout: 3s
      retries: 20
    volumes:
      - mysql_data:/var/lib/mysql

  adminer:
    image: adminer:4
    ports:
      - "8081:8080"
    depends_on:
      mysql:
        condition: service_healthy

volumes:
  mysql_data:
```

- [ ] **Step 2: Bring up MySQL and apply the migration**

```bash
make up          # starts mysql + adminer
# wait until healthy (make logs), then:
export DB_USER=wcp DB_PASSWORD=wcp DB_HOST=127.0.0.1 DB_PORT=3306 DB_NAME=wcp
make migrate-up  # requires golang-migrate CLI installed
```

Expected: `migrate` reports `1/u create_users` applied; the `users` table exists (verify in Adminer at http://localhost:8081 or `SHOW TABLES`).

- [ ] **Step 3: Smoke-test the server end-to-end**

```bash
cd backend
APP_ENV=development HTTP_PORT=8000 \
  DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=wcp DB_PASSWORD=wcp DB_NAME=wcp \
  SESSION_SECRET=dev-secret-please-change GOOGLE_CLIENT_ID=dummy.apps.googleusercontent.com \
  ALLOWED_EMAIL_DOMAIN=sayonetech.com \
  go run ./cmd/server &
sleep 2
curl -s localhost:8000/healthz        # -> {"status":"ok"}
curl -s -i localhost:8000/api/me       # -> 401 {"error":"not authenticated"}
kill %1
```

Expected: `/healthz` returns `{"status":"ok"}`; `/api/me` returns 401 (no live Google token to test the full login by curl — that path is covered by the handler tests in Task 5 and exercised via the frontend in Task 8).

- [ ] **Step 4: Commit**

```bash
git add deploy/docker-compose.yml
git commit -m "chore(deploy): local MySQL + Adminer compose for development"
```

---

### Task 8: Frontend — Vite app, Google sign-in, profile via `/api/me`

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/index.html`
- Create: `frontend/.env.example`
- Create: `frontend/src/main.tsx`, `frontend/src/App.tsx`
- Create: `frontend/src/lib/api.ts`, `frontend/src/lib/auth.tsx`
- Create: `frontend/src/styles/tokens.css`

- [ ] **Step 1: Scaffold the Vite React+TS app**

```bash
cd frontend 2>/dev/null || (mkdir -p ../frontend && cd ../frontend)
pnpm create vite . --template react-ts
pnpm install
pnpm add @tanstack/react-query
```

Expected: a standard Vite React-TS project; dev server command is `pnpm dev`.

- [ ] **Step 2: Configure the dev proxy so `/api` hits the backend**

`frontend/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
    },
  },
});
```

- [ ] **Step 3: Add the dark-first design tokens (subset of spec §7.2)**

`frontend/src/styles/tokens.css`:

```css
:root {
  --bg: oklch(0.17 0.020 280);
  --surface-1: oklch(0.21 0.022 280);
  --surface-2: oklch(0.25 0.020 280);
  --border: oklch(0.32 0.020 280);
  --ink: oklch(0.96 0.010 280);
  --muted: oklch(0.72 0.015 280);
  --brand: oklch(0.64 0.190 28);
  --brand-hover: oklch(0.68 0.180 28);
  --on-brand: oklch(0.22 0.070 28);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: Inter, system-ui, sans-serif;
}

.card {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 24px;
  max-width: 420px;
  margin: 15vh auto 0;
}

.btn-brand {
  background: var(--brand);
  color: var(--on-brand);
  border: 0;
  border-radius: 8px;
  padding: 10px 16px;
  font-weight: 500;
  cursor: pointer;
}
.btn-brand:hover { background: var(--brand-hover); }
.muted { color: var(--muted); }
```

- [ ] **Step 4: Add the API client**

`frontend/src/lib/api.ts`:

```ts
const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

export type Me = {
  id: number;
  email: string;
  name: string;
  avatar_url: string;
  role: "user" | "admin";
};

export async function getMe(): Promise<Me | null> {
  const res = await fetch(`${BASE}/me`, { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`/me failed: ${res.status}`);
  return res.json();
}

export async function loginWithGoogle(idToken: string): Promise<Me> {
  const res = await fetch(`${BASE}/auth/google`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_token: idToken }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `login failed: ${res.status}`);
  }
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch(`${BASE}/auth/logout`, { method: "POST", credentials: "include" });
}
```

- [ ] **Step 5: Add the auth hook + Google Identity Services button**

`frontend/src/lib/auth.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMe, loginWithGoogle, logout } from "./api";

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: getMe, retry: false });
}

// GoogleSignInButton renders the GIS button and calls the backend with the ID token.
export function GoogleSignInButton() {
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const login = useMutation({
    mutationFn: loginWithGoogle,
    onSuccess: (me) => qc.setQueryData(["me"], me),
  });

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;
    // @ts-expect-error google is injected by the GIS script in index.html
    const google = window.google;
    if (!google || !ref.current) return;
    google.accounts.id.initialize({
      client_id: clientId,
      callback: (resp: { credential: string }) => login.mutate(resp.credential),
    });
    google.accounts.id.renderButton(ref.current, { theme: "filled_black", size: "large" });
  }, [login]);

  return (
    <div>
      <div ref={ref} />
      {login.isError && <p className="muted">{(login.error as Error).message}</p>}
    </div>
  );
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => qc.setQueryData(["me"], null),
  });
}
```

- [ ] **Step 6: Load the GIS script in `index.html`**

In `frontend/index.html`, add inside `<head>`:

```html
<script src="https://accounts.google.com/gsi/client" async></script>
```

> **Note (no SRI):** the GIS client is an unversioned, auto-updating loader; Google publishes no stable hash, so `integrity="..."` is intentionally omitted (it would break sign-in on Google's next update). This is the documented exception to the repo's "SRI on external scripts" rule — it is the only third-party script the SPA loads.

- [ ] **Step 7: Wire `main.tsx` (QueryClient + tokens) and `App.tsx`**

`frontend/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./styles/tokens.css";

const qc = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
```

`frontend/src/App.tsx`:

```tsx
import { useMe, GoogleSignInButton, useLogout } from "./lib/auth";

export default function App() {
  const { data: me, isLoading } = useMe();
  const logout = useLogout();

  if (isLoading) return <div className="card">Loading…</div>;

  if (!me) {
    return (
      <div className="card">
        <h1>SayScore</h1>
        <p className="muted">Sign in with your sayonetech.com Google account.</p>
        <GoogleSignInButton />
      </div>
    );
  }

  return (
    <div className="card">
      <h1>SayScore</h1>
      <p>Signed in as <strong>{me.name || me.email}</strong> ({me.role})</p>
      <p className="muted">{me.email}</p>
      <button className="btn-brand" onClick={() => logout.mutate()}>Log out</button>
    </div>
  );
}
```

- [ ] **Step 8: Add `frontend/.env.example`**

```dotenv
VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
VITE_API_BASE_URL=/api
```

- [ ] **Step 9: Type-check and build**

Run: `cd frontend && pnpm tsc --noEmit && pnpm build`
Expected: type-check clean, production build succeeds.

- [ ] **Step 10: Manual verification (real Google client required)**

With a real `GOOGLE_CLIENT_ID`/`VITE_GOOGLE_CLIENT_ID` (Workspace web client; `http://localhost:5173` an authorised JS origin), run the backend (Task 7 Step 3) and `pnpm dev`, open http://localhost:5173, sign in with a `@sayonetech.com` account → profile renders; sign in with a non-Workspace account → 403 message shown.

- [ ] **Step 11: Commit**

```bash
git add frontend
git commit -m "feat(frontend): Vite app with Google sign-in and /api/me profile"
```

---

## Milestone 1 Definition of Done

- `go test ./...` (backend) passes; `pnpm tsc --noEmit && pnpm build` (frontend) passes.
- `make up && make migrate-up` creates the `users` table.
- A `@sayonetech.com` Google account signs in, is provisioned, gets a session cookie, and `/api/me` returns the profile; non-domain accounts are rejected with 403.
- Seed-admin emails are provisioned/promoted to `admin` at startup.
- All work committed; working tree clean.

---

## Self-Review

**1. Spec coverage (M1 scope):**
- §3.1 auth (Google verify, `hd` gate, email_verified, httpOnly+Secure+SameSite cookie, auto-provision, seed admins) → Tasks 3, 5, 6. ✓
- §2 roles (`user`/`admin`, seed admins) → Task 4 (enum), Task 6 (seed). ✓
- §8 stack (chi, sqlc, mysql driver, idtoken, slog) → Tasks 1–6. ✓
- §9 layout + module path → all backend tasks use `github.com/sayonetech/worldcup-predictor/backend`. ✓
- §10 users table columns → Task 4 migration. ✓
- §11 `/api/auth/google`, `/api/auth/logout`, `/api/me`, `/healthz` → Tasks 1, 5. ✓
- §12 security (httpOnly/Secure/SameSite=Lax, Secure only in prod) → Task 5 middleware, Task 6 wiring. ✓
- §7 dark tokens → Task 8 `tokens.css`. ✓
- Out of M1 scope (deferred to later milestones, intentionally): CSRF token, rate limiting, full Dockerfiles, CI, Lefthook, fixtures/predictions/scoring. Noted, not gaps.

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Every code step shows complete code; the one judgement call (sqlc generated identifiers) is flagged with explicit guidance. ✓

**3. Type consistency:** `store.Store` methods (`UpsertUser`, `GetUserByID`, `SetUserRole`) are identical across `store.go`, `db.go`, the fake in `auth_test.go`, and `main.go`. `auth.GoogleClaims` fields match between `domain.go`, `google.go`, and tests. `Deps` fields match between `middleware.go`, handlers, and `main.go`. `meResponse`/`userResponse` consistent. Session API (`NewSessionManager`, `Encode(Session, ttl)`, `Decode`) consistent across `session.go`, middleware, and tests. ✓

> **One flagged risk to watch at execution:** sqlc's generated Go identifiers (`AvatarUrl`, `UsersRole`, param struct names) depend on sqlc version. Task 4 Step 7 instructs adapting `db.go` to the generated `models.go` if they differ — the generated code is authoritative.
