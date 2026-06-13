# SayScore — Milestone 3: Predictions + Server-Authoritative Kickoff Lock

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in user can open a fixture, set/edit a predicted score (plus a penalty-shootout winner on knockout draws), and Save it so it persists across reloads — while the server rejects any prediction write where `now >= kickoff_utc`, and never exposes another user's predictions.

**Architecture:** A new `predictions` table (migration `0003`) with a `UNIQUE(user_id, match_id)` key makes each write an idempotent upsert. A new `PredictionStore` interface (alongside the existing `Store`/`MatchStore`) owns the write + the caller's-predictions read; `MatchStore` gains `GetMatchByID` for the lock + validation lookup. A new `PUT /api/matches/{id}/prediction` handler enforces the server-authoritative lock (409), validation (422), and the penalty-winner rules, all tested against fakes with an overridable clock. `GET /api/matches` is extended to attach the caller's own prediction to each match via one `user_id`-keyed query. The Fixtures UI gains a tap-to-expand editor (score steppers + penalty-winner control + Save) with locked/TBD read-only states.

**Tech Stack:** Go 1.26 (chi, sqlc, golang-migrate, MySQL 8, stdlib `time`/`encoding/json`); React 18 + TS + Vite, TanStack Query, Vitest + Testing Library, dark §7 tokens. Scoring (`points`, `penalty_bonus`) is **Milestone 4** — those columns stay NULL here.

**Spec references:** design spec `docs/superpowers/specs/2026-06-13-sayscore-m3-predictions-design.md`; REQUIREMENTS.md §3.2 (server lock), §3.3 (penalty bonus shape), §4 (privacy), §10 (`predictions`), §11 (`PUT /api/matches/:id/prediction`, `GET /api/matches`), §7 (design).

**Key rule (from the spec):** predictions are accepted only for matches with **known** home and away teams (the 72 group matches now); TBD-team knockout matches reject writes (422) and render non-editable. Scoring is out of scope.

---

## File Structure

**Backend — new**
- `backend/migrations/0003_create_predictions.up.sql` / `.down.sql` — the `predictions` table.
- `backend/internal/store/queries/predictions.sql` — `UpsertPrediction`, `ListPredictionsByUser`.
- `backend/internal/store/predictions.go` — `Prediction`/`UpsertPredictionParams`/`MatchByID` domain types, `PredictionStore` interface, `SQLStore` adapters, `GetMatchByID` adapter, `ErrNotFound`.
- `backend/internal/httpapi/prediction_handler.go` — `PutPrediction` + request/response DTOs + validation.
- `backend/internal/httpapi/prediction_test.go` — table-driven handler tests (fakes + clock).

**Backend — changed**
- `backend/internal/store/queries/matches.sql` — add `GetMatchByID`.
- `backend/internal/store/sqlc/` — regenerated (authoritative; adapt adapters to it).
- `backend/internal/store/matches.go` — add `GetMatchByID` to `MatchStore` + adapter + `MatchByID` type.
- `backend/internal/httpapi/middleware.go` — add `Predictions store.PredictionStore` to `Deps`.
- `backend/internal/httpapi/matches_handler.go` — attach caller's prediction to `matchDTO`.
- `backend/internal/httpapi/matches_test.go` — extend fake store + assert prediction attach + no-leak.
- `backend/internal/httpapi/router.go` — register `PUT /api/matches/{id}/prediction`.
- `backend/cmd/server/main.go` — wire `Predictions: st`.
- `backend/internal/httpapi/openapi.yaml` — document the new endpoint + `prediction` field.

**Frontend — new**
- `frontend/vitest.config.ts`, `frontend/src/test/setup.ts` — Vitest + Testing Library.
- `frontend/src/components/MatchRow.test.tsx` — editor behavior tests.

**Frontend — changed**
- `frontend/package.json` — vitest deps + `test` scripts.
- `frontend/src/lib/matches.ts` — `PredictionDTO`/`PredictionInput` types, `prediction` on `MatchDTO`, `putPrediction`, `usePutPrediction`.
- `frontend/src/components/MatchRow.tsx` — tap-to-expand editor (impeccable skill).
- `frontend/src/styles/tokens.css` — editor styles (impeccable skill).

> **Design-skill note:** Task 9 (the MatchRow editor + tokens) uses the **`impeccable`** skill against §7. The plan gives a complete working baseline; impeccable refines visuals/states. Backend tasks are hand-coded Go.

---

## Conventions

Backend commands from `backend/`; frontend from `frontend/`. Lefthook hooks are active — Conventional Commits required; `gofmt`/`go vet` (vet at pre-push) run automatically. TDD: failing test → RED → minimal implementation → GREEN → commit, one bite-sized step at a time. **sqlc generated identifiers are authoritative** — after `make sqlc`, open `internal/store/sqlc/*` and adapt the adapters to the real names/types (don't hand-edit generated code). Never stage `.claude/`, `node_modules/`, `dist/`, `.playwright-mcp/`. Times stored UTC, shown IST. Server is authoritative for lock — never trust the client clock.

---

### Task 1: Schema + sqlc (predictions table, queries)

**Files:**
- Create: `backend/migrations/0003_create_predictions.up.sql`, `backend/migrations/0003_create_predictions.down.sql`
- Create: `backend/internal/store/queries/predictions.sql`
- Modify: `backend/internal/store/queries/matches.sql`
- Regenerate: `backend/internal/store/sqlc/`

- [ ] **Step 1: Write `0003_create_predictions.up.sql`**

```sql
CREATE TABLE predictions (
    id                     BIGINT    NOT NULL AUTO_INCREMENT,
    user_id                BIGINT    NOT NULL,
    match_id               BIGINT    NOT NULL,
    home_score             INT       NOT NULL,
    away_score             INT       NOT NULL,
    penalty_winner_team_id BIGINT    NULL,
    points                 INT       NULL,
    penalty_bonus          INT       NULL,
    created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pred_user_match (user_id, match_id),
    KEY idx_pred_match (match_id),
    CONSTRAINT fk_pred_user   FOREIGN KEY (user_id)  REFERENCES users (id)   ON DELETE CASCADE,
    CONSTRAINT fk_pred_match  FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE CASCADE,
    CONSTRAINT fk_pred_penwin FOREIGN KEY (penalty_winner_team_id) REFERENCES teams (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 2: Write `0003_create_predictions.down.sql`**

```sql
DROP TABLE IF EXISTS predictions;
```

- [ ] **Step 3: Write `backend/internal/store/queries/predictions.sql`**

```sql
-- name: UpsertPrediction :exec
INSERT INTO predictions (user_id, match_id, home_score, away_score, penalty_winner_team_id)
VALUES (?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
    home_score             = VALUES(home_score),
    away_score             = VALUES(away_score),
    penalty_winner_team_id = VALUES(penalty_winner_team_id);

-- name: ListPredictionsByUser :many
SELECT match_id, home_score, away_score, penalty_winner_team_id
FROM predictions
WHERE user_id = ?;
```

- [ ] **Step 4: Add `GetMatchByID` to `backend/internal/store/queries/matches.sql`** (append)

```sql
-- name: GetMatchByID :one
SELECT id, stage, home_team_id, away_team_id, kickoff_utc, status
FROM matches
WHERE id = ?;
```

- [ ] **Step 5: Regenerate sqlc**

Run: `make sqlc`
Expected: regenerates `backend/internal/store/sqlc/` with `UpsertPrediction`, `UpsertPredictionParams`, `ListPredictionsByUser`, `ListPredictionsByUserRow`, `GetMatchByID`, `GetMatchByIDRow`. No errors.

- [ ] **Step 6: Inspect the generated names** (do not edit generated code)

Run: `grep -n 'func (q \*Queries) UpsertPrediction\|func (q \*Queries) ListPredictionsByUser\|func (q \*Queries) GetMatchByID\|type UpsertPredictionParams\|type ListPredictionsByUserRow\|type GetMatchByIDRow' backend/internal/store/sqlc/*.go`
Expected: each appears once. Note the exact field names/types (e.g. `PenaltyWinnerTeamID sql.NullInt64`, `HomeScore int32`) — Task 2 adapters must match them.

- [ ] **Step 7: Confirm it compiles**

Run: `cd backend && go build ./...`
Expected: builds clean (no callers yet).

- [ ] **Step 8: Commit**

```bash
git add backend/migrations/0003_create_predictions.up.sql backend/migrations/0003_create_predictions.down.sql backend/internal/store/queries/predictions.sql backend/internal/store/queries/matches.sql backend/internal/store/sqlc/
git commit -m "feat(db): predictions table + upsert/list/get-match queries (sqlc)"
```

---

### Task 2: Store layer — PredictionStore + GetMatchByID adapter

**Files:**
- Create: `backend/internal/store/predictions.go`
- Modify: `backend/internal/store/matches.go` (add `GetMatchByID` to `MatchStore` + adapter + `MatchByID`)

> The SQLStore adapters are thin sqlc pass-throughs (require live MySQL to unit-test), so — following the M2 pattern — they are verified by `go build` + the downstream handler tests in Tasks 3–4, which run against fakes. No adapter unit test here.

- [ ] **Step 1: Create `backend/internal/store/predictions.go`**

> Adjust `sqlc.*` field names to whatever Task 1 Step 6 reported if they differ.

```go
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store/sqlc"
)

// ErrNotFound is returned by single-row reads when the row does not exist.
var ErrNotFound = errors.New("store: not found")

// Prediction is the caller's stored pick for a match (read model for the list).
type Prediction struct {
	MatchID             int64
	HomeScore           int32
	AwayScore           int32
	PenaltyWinnerTeamID *int64
}

// UpsertPredictionParams is the write surface for a single prediction.
type UpsertPredictionParams struct {
	UserID              int64
	MatchID             int64
	HomeScore           int32
	AwayScore           int32
	PenaltyWinnerTeamID *int64
}

// MatchByID is the minimal match row the prediction handler needs for the
// server-authoritative lock + validation. HomeTeamID/AwayTeamID are nil for
// TBD knockout placeholders.
type MatchByID struct {
	ID         int64
	Stage      Stage
	HomeTeamID *int64
	AwayTeamID *int64
	KickoffUTC time.Time
	Status     MatchStatus
}

// PredictionStore is the predictions write + caller-read surface.
type PredictionStore interface {
	UpsertPrediction(ctx context.Context, p UpsertPredictionParams) error
	ListPredictionsByUser(ctx context.Context, userID int64) ([]Prediction, error)
}

var _ PredictionStore = (*SQLStore)(nil)

func (s *SQLStore) UpsertPrediction(ctx context.Context, p UpsertPredictionParams) error {
	if err := s.q.UpsertPrediction(ctx, sqlc.UpsertPredictionParams{
		UserID:              p.UserID,
		MatchID:             p.MatchID,
		HomeScore:           p.HomeScore,
		AwayScore:           p.AwayScore,
		PenaltyWinnerTeamID: nullI64(p.PenaltyWinnerTeamID),
	}); err != nil {
		return fmt.Errorf("store: upsert prediction: %w", err)
	}
	return nil
}

func (s *SQLStore) ListPredictionsByUser(ctx context.Context, userID int64) ([]Prediction, error) {
	rows, err := s.q.ListPredictionsByUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("store: list predictions: %w", err)
	}
	out := make([]Prediction, 0, len(rows))
	for _, r := range rows {
		out = append(out, Prediction{
			MatchID:             r.MatchID,
			HomeScore:           r.HomeScore,
			AwayScore:           r.AwayScore,
			PenaltyWinnerTeamID: ptrI64(r.PenaltyWinnerTeamID),
		})
	}
	return out, nil
}

func (s *SQLStore) GetMatchByID(ctx context.Context, id int64) (MatchByID, error) {
	r, err := s.q.GetMatchByID(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return MatchByID{}, ErrNotFound
	}
	if err != nil {
		return MatchByID{}, fmt.Errorf("store: get match: %w", err)
	}
	return MatchByID{
		ID:         r.ID,
		Stage:      Stage(r.Stage),
		HomeTeamID: ptrI64(r.HomeTeamID),
		AwayTeamID: ptrI64(r.AwayTeamID),
		KickoffUTC: r.KickoffUtc,
		Status:     MatchStatus(r.Status),
	}, nil
}

// ptrI64 converts a nullable sqlc column to *int64.
func ptrI64(n sql.NullInt64) *int64 {
	if !n.Valid {
		return nil
	}
	v := n.Int64
	return &v
}
```

- [ ] **Step 2: Add `"time"` import to `predictions.go`**

The file uses `time.Time` in `MatchByID`. Ensure the import block includes `"time"` (add it to the grouped imports above).

- [ ] **Step 3: Add `GetMatchByID` to the `MatchStore` interface in `matches.go`**

In `backend/internal/store/matches.go`, change the `MatchStore` interface:

```go
type MatchStore interface {
	ListMatchesWithTeams(ctx context.Context) ([]MatchWithTeams, error)
	GetMatchByID(ctx context.Context, id int64) (MatchByID, error)
}
```

(The adapter for `GetMatchByID` already lives in `predictions.go` from Step 1; the `_ MatchStore = (*SQLStore)(nil)` guard in `matches.go` now also enforces it.)

- [ ] **Step 4: Confirm it compiles**

Run: `cd backend && go build ./...`
Expected: builds clean. If sqlc field names differ from Step 1, fix the adapter mappings now.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/store/predictions.go backend/internal/store/matches.go
git commit -m "feat(store): PredictionStore (upsert + list by user) and GetMatchByID"
```

---

### Task 3: `PUT /api/matches/{id}/prediction` handler (TDD)

**Files:**
- Modify: `backend/internal/httpapi/middleware.go` (add `Predictions` to `Deps`)
- Create: `backend/internal/httpapi/prediction_handler.go`
- Create: `backend/internal/httpapi/prediction_test.go`
- Modify: `backend/internal/httpapi/router.go` (register the route)

- [ ] **Step 1: Add `Predictions` to `Deps`**

In `backend/internal/httpapi/middleware.go`, add the field to the `Deps` struct (after `Matches`):

```go
	Matches            store.MatchStore
	Predictions        store.PredictionStore
```

- [ ] **Step 2: Write the failing test file `backend/internal/httpapi/prediction_test.go`**

```go
package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/auth"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

// fakePredMatchStore serves a single match for GetMatchByID and records nothing else.
type fakePredMatchStore struct {
	match store.MatchByID
	found bool
}

func (f fakePredMatchStore) ListMatchesWithTeams(context.Context) ([]store.MatchWithTeams, error) {
	return nil, nil
}
func (f fakePredMatchStore) GetMatchByID(_ context.Context, id int64) (store.MatchByID, error) {
	if !f.found || id != f.match.ID {
		return store.MatchByID{}, store.ErrNotFound
	}
	return f.match, nil
}

// fakePredStore records the last upsert and returns canned list rows.
type fakePredStore struct {
	upserts []store.UpsertPredictionParams
	list    []store.Prediction
}

func (f *fakePredStore) UpsertPrediction(_ context.Context, p store.UpsertPredictionParams) error {
	f.upserts = append(f.upserts, p)
	return nil
}
func (f *fakePredStore) ListPredictionsByUser(context.Context, int64) ([]store.Prediction, error) {
	return f.list, nil
}

func i64(v int64) *int64 { return &v }

// predDeps wires an authed user + the given match + a fresh prediction store.
func predDeps(t *testing.T, m store.MatchByID, found bool) (*Deps, *http.Cookie, *fakePredStore) {
	t.Helper()
	fs := newFakeStore() // auth_test.go
	u, _ := fs.UpsertUser(context.Background(), store.UpsertUserParams{Email: "dev@sayonetech.com"})
	sm := auth.NewSessionManager("test-secret")
	ps := &fakePredStore{}
	d := &Deps{
		Store:       fs,
		Matches:     fakePredMatchStore{match: m, found: found},
		Predictions: ps,
		Sessions:    sm,
	}
	return d, &http.Cookie{Name: sessionCookieName, Value: sm.Encode(auth.Session{UserID: u.ID}, time.Hour)}, ps
}

func doPut(t *testing.T, d *Deps, cookie *http.Cookie, id, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, "/api/matches/"+id+"/prediction", strings.NewReader(body))
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	NewRouter(d, false).ServeHTTP(rec, req)
	return rec
}

// A group match (known teams) kicking off well in the future, with a fixed clock.
func futureGroupMatch() store.MatchByID {
	return store.MatchByID{
		ID: 1, Stage: store.StageGroup, HomeTeamID: i64(1), AwayTeamID: i64(2),
		KickoffUTC: time.Date(2026, 6, 20, 0, 0, 0, 0, time.UTC), Status: store.StatusScheduled,
	}
}

func withClock(t *testing.T, at time.Time) {
	t.Helper()
	old := now
	now = func() time.Time { return at }
	t.Cleanup(func() { now = old })
}

func TestPutPredictionRequiresAuth(t *testing.T) {
	d, _, _ := predDeps(t, futureGroupMatch(), true)
	rec := doPut(t, d, nil, "1", `{"home_score":1,"away_score":0}`)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestPutPredictionCreatesBeforeKickoff(t *testing.T) {
	withClock(t, time.Date(2026, 6, 12, 0, 0, 0, 0, time.UTC))
	d, cookie, ps := predDeps(t, futureGroupMatch(), true)
	rec := doPut(t, d, cookie, "1", `{"home_score":2,"away_score":1}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if len(ps.upserts) != 1 || ps.upserts[0].HomeScore != 2 || ps.upserts[0].AwayScore != 1 || ps.upserts[0].MatchID != 1 {
		t.Fatalf("upsert = %+v", ps.upserts)
	}
	var resp predictionDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.HomeScore != 2 || resp.AwayScore != 1 || resp.PenaltyWinnerTeamID != nil {
		t.Fatalf("resp = %+v", resp)
	}
}

func TestPutPredictionRejectedAtKickoff(t *testing.T) {
	// now == kickoff exactly → locked.
	withClock(t, time.Date(2026, 6, 20, 0, 0, 0, 0, time.UTC))
	d, cookie, ps := predDeps(t, futureGroupMatch(), true)
	rec := doPut(t, d, cookie, "1", `{"home_score":1,"away_score":1}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
	if len(ps.upserts) != 0 {
		t.Fatalf("locked write must not upsert, got %+v", ps.upserts)
	}
}

func TestPutPredictionUnknownMatch404(t *testing.T) {
	withClock(t, time.Date(2026, 6, 12, 0, 0, 0, 0, time.UTC))
	d, cookie, _ := predDeps(t, futureGroupMatch(), false)
	rec := doPut(t, d, cookie, "999", `{"home_score":1,"away_score":0}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestPutPredictionTBDTeams422(t *testing.T) {
	withClock(t, time.Date(2026, 6, 12, 0, 0, 0, 0, time.UTC))
	m := store.MatchByID{ID: 1, Stage: store.StageKnockout, HomeTeamID: nil, AwayTeamID: nil,
		KickoffUTC: time.Date(2026, 7, 4, 0, 0, 0, 0, time.UTC), Status: store.StatusScheduled}
	d, cookie, ps := predDeps(t, m, true)
	rec := doPut(t, d, cookie, "1", `{"home_score":1,"away_score":1}`)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
	if len(ps.upserts) != 0 {
		t.Fatalf("TBD write must not upsert")
	}
}

func TestPutPredictionScoreBounds422(t *testing.T) {
	withClock(t, time.Date(2026, 6, 12, 0, 0, 0, 0, time.UTC))
	for _, body := range []string{
		`{"home_score":-1,"away_score":0}`,
		`{"home_score":100,"away_score":0}`,
		`{"away_score":0}`, // missing home_score
	} {
		d, cookie, ps := predDeps(t, futureGroupMatch(), true)
		rec := doPut(t, d, cookie, "1", body)
		if rec.Code != http.StatusUnprocessableEntity {
			t.Fatalf("body %s: status = %d, want 422", body, rec.Code)
		}
		if len(ps.upserts) != 0 {
			t.Fatalf("body %s: must not upsert", body)
		}
	}
}

func TestPutPredictionPenaltyWinnerOnKnockoutDraw(t *testing.T) {
	withClock(t, time.Date(2026, 6, 12, 0, 0, 0, 0, time.UTC))
	m := store.MatchByID{ID: 1, Stage: store.StageKnockout, HomeTeamID: i64(1), AwayTeamID: i64(2),
		KickoffUTC: time.Date(2026, 7, 4, 0, 0, 0, 0, time.UTC), Status: store.StatusScheduled}
	d, cookie, ps := predDeps(t, m, true)
	rec := doPut(t, d, cookie, "1", `{"home_score":1,"away_score":1,"penalty_winner_team_id":2}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if ps.upserts[0].PenaltyWinnerTeamID == nil || *ps.upserts[0].PenaltyWinnerTeamID != 2 {
		t.Fatalf("penalty winner not stored: %+v", ps.upserts[0])
	}
}

func TestPutPredictionPenaltyWinnerRejected(t *testing.T) {
	withClock(t, time.Date(2026, 6, 12, 0, 0, 0, 0, time.UTC))
	cases := map[string]struct {
		match store.MatchByID
		body  string
	}{
		"group match cannot pick winner": {futureGroupMatch(), `{"home_score":1,"away_score":1,"penalty_winner_team_id":1}`},
		"knockout non-draw cannot pick":  {store.MatchByID{ID: 1, Stage: store.StageKnockout, HomeTeamID: i64(1), AwayTeamID: i64(2), KickoffUTC: time.Date(2026, 7, 4, 0, 0, 0, 0, time.UTC)}, `{"home_score":2,"away_score":1,"penalty_winner_team_id":1}`},
		"winner must be home or away":     {store.MatchByID{ID: 1, Stage: store.StageKnockout, HomeTeamID: i64(1), AwayTeamID: i64(2), KickoffUTC: time.Date(2026, 7, 4, 0, 0, 0, 0, time.UTC)}, `{"home_score":1,"away_score":1,"penalty_winner_team_id":9}`},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			d, cookie, ps := predDeps(t, tc.match, true)
			rec := doPut(t, d, cookie, "1", tc.body)
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("status = %d, want 422", rec.Code)
			}
			if len(ps.upserts) != 0 {
				t.Fatalf("must not upsert")
			}
		})
	}
}
```

- [ ] **Step 3: Run the tests to confirm they fail to compile/RED**

Run: `cd backend && go test ./internal/httpapi/ -run TestPutPrediction -v`
Expected: FAIL — `predictionDTO` and `PutPrediction` undefined.

- [ ] **Step 4: Create `backend/internal/httpapi/prediction_handler.go`**

```go
package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

const maxScore = 99

type predictionRequest struct {
	HomeScore           *int32 `json:"home_score"`
	AwayScore           *int32 `json:"away_score"`
	PenaltyWinnerTeamID *int64 `json:"penalty_winner_team_id"`
}

type predictionDTO struct {
	HomeScore           int32  `json:"home_score"`
	AwayScore           int32  `json:"away_score"`
	PenaltyWinnerTeamID *int64 `json:"penalty_winner_team_id"`
}

// PutPrediction creates or updates the caller's prediction for a match.
// The server is authoritative for the kickoff lock and all validation.
func (d *Deps) PutPrediction(w http.ResponseWriter, r *http.Request) {
	u, ok := userFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid match id")
		return
	}

	var req predictionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	m, err := d.Matches.GetMatchByID(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "match not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load match")
		return
	}

	// Server-authoritative kickoff lock: reject at or after kickoff.
	if !now().Before(m.KickoffUTC) {
		writeError(w, http.StatusConflict, "match is locked")
		return
	}

	// Predictions require known teams (TBD knockout placeholders are not predictable).
	if m.HomeTeamID == nil || m.AwayTeamID == nil {
		writeError(w, http.StatusUnprocessableEntity, "teams not yet decided")
		return
	}

	// Score presence + bounds.
	if req.HomeScore == nil || req.AwayScore == nil {
		writeError(w, http.StatusUnprocessableEntity, "home_score and away_score are required")
		return
	}
	if *req.HomeScore < 0 || *req.HomeScore > maxScore || *req.AwayScore < 0 || *req.AwayScore > maxScore {
		writeError(w, http.StatusUnprocessableEntity, "scores must be between 0 and 99")
		return
	}

	// Penalty winner: only on a knockout draw, and only home or away.
	if req.PenaltyWinnerTeamID != nil {
		isDraw := *req.HomeScore == *req.AwayScore
		validTeam := *req.PenaltyWinnerTeamID == *m.HomeTeamID || *req.PenaltyWinnerTeamID == *m.AwayTeamID
		if m.Stage != store.StageKnockout || !isDraw || !validTeam {
			writeError(w, http.StatusUnprocessableEntity, "penalty winner only valid on a knockout draw, and must be a participating team")
			return
		}
	}

	if err := d.Predictions.UpsertPrediction(r.Context(), store.UpsertPredictionParams{
		UserID:              u.ID,
		MatchID:             id,
		HomeScore:           *req.HomeScore,
		AwayScore:           *req.AwayScore,
		PenaltyWinnerTeamID: req.PenaltyWinnerTeamID,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "could not save prediction")
		return
	}

	writeJSON(w, http.StatusOK, predictionDTO{
		HomeScore:           *req.HomeScore,
		AwayScore:           *req.AwayScore,
		PenaltyWinnerTeamID: req.PenaltyWinnerTeamID,
	})
}
```

- [ ] **Step 5: Register the route in `backend/internal/httpapi/router.go`**

Inside the `priv` group (after `priv.Get("/matches", d.GetMatches)`):

```go
			priv.Put("/matches/{id}/prediction", d.PutPrediction)
```

- [ ] **Step 6: Run the tests to GREEN**

Run: `cd backend && go test ./internal/httpapi/ -run TestPutPrediction -v`
Expected: all `TestPutPrediction*` PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/httpapi/prediction_handler.go backend/internal/httpapi/prediction_test.go backend/internal/httpapi/middleware.go backend/internal/httpapi/router.go
git commit -m "feat(api): PUT /api/matches/{id}/prediction with server lock + validation"
```

---

### Task 4: Attach the caller's prediction to `GET /api/matches` (TDD)

**Files:**
- Modify: `backend/internal/httpapi/matches_test.go` (extend fake + assertions)
- Modify: `backend/internal/httpapi/matches_handler.go` (load + attach prediction)

- [ ] **Step 1: Extend the fake match store + add a prediction store in `matches_test.go`**

Replace `fakeMatchStore` so it also satisfies `GetMatchByID`, and update `authedMatchesDeps` to inject a prediction store. Add at the top (alongside the existing fake):

```go
func (f fakeMatchStore) GetMatchByID(context.Context, int64) (store.MatchByID, error) {
	return store.MatchByID{}, store.ErrNotFound
}

// fakeListPredStore returns canned predictions and counts how many times it is called.
type fakeListPredStore struct {
	preds []store.Prediction
	calls int
}

func (f *fakeListPredStore) UpsertPrediction(context.Context, store.UpsertPredictionParams) error {
	return nil
}
func (f *fakeListPredStore) ListPredictionsByUser(context.Context, int64) ([]store.Prediction, error) {
	f.calls++
	return f.preds, nil
}
```

Change `authedMatchesDeps` to accept predictions and wire them:

```go
func authedMatchesDeps(t *testing.T, matches []store.MatchWithTeams, preds []store.Prediction) (*Deps, *http.Cookie, *fakeListPredStore) {
	t.Helper()
	fs := newFakeStore()
	u, _ := fs.UpsertUser(context.Background(), store.UpsertUserParams{Email: "dev@sayonetech.com"})
	sm := auth.NewSessionManager("test-secret")
	ps := &fakeListPredStore{preds: preds}
	d := &Deps{Store: fs, Matches: fakeMatchStore{matches: matches}, Predictions: ps, Sessions: sm, AllowedEmailDomain: "sayonetech.com"}
	return d, &http.Cookie{Name: sessionCookieName, Value: sm.Encode(auth.Session{UserID: u.ID}, time.Hour)}, ps
}
```

Update the existing call in `TestGetMatchesGroupVenueLockAndPlaceholder`:

```go
	d, cookie, _ := authedMatchesDeps(t, []store.MatchWithTeams{group, placeholder}, nil)
```

- [ ] **Step 2: Add the failing prediction-attach test to `matches_test.go`**

```go
func TestGetMatchesAttachesCallerPrediction(t *testing.T) {
	fixedNow := time.Date(2026, 6, 12, 0, 0, 0, 0, time.UTC)
	old := now
	now = func() time.Time { return fixedNow }
	defer func() { now = old }()

	m1 := store.MatchWithTeams{
		ID: 1, MatchNumber: 1, Stage: store.StageGroup, GroupLetter: "A", MatchLabel: "Group A",
		KickoffUTC: time.Date(2026, 6, 20, 0, 0, 0, 0, time.UTC), Status: store.StatusScheduled,
		Home: &store.TeamRef{ID: 1, Name: "Mexico", Code: "MEX"}, Away: &store.TeamRef{ID: 2, Name: "South Africa", Code: "RSA"},
	}
	m2 := store.MatchWithTeams{
		ID: 2, MatchNumber: 2, Stage: store.StageGroup, GroupLetter: "A", MatchLabel: "Group A",
		KickoffUTC: time.Date(2026, 6, 21, 0, 0, 0, 0, time.UTC), Status: store.StatusScheduled,
		Home: &store.TeamRef{ID: 3, Name: "France", Code: "FRA"}, Away: &store.TeamRef{ID: 4, Name: "Spain", Code: "ESP"},
	}
	preds := []store.Prediction{{MatchID: 1, HomeScore: 2, AwayScore: 1}}

	d, cookie, ps := authedMatchesDeps(t, []store.MatchWithTeams{m1, m2}, preds)
	req := httptest.NewRequest(http.MethodGet, "/api/matches", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	NewRouter(d, false).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	var resp matchesResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// Predictions loaded exactly once (no N+1).
	if ps.calls != 1 {
		t.Fatalf("ListPredictionsByUser called %d times, want 1", ps.calls)
	}
	var withPred, withoutPred *matchDTO
	for i := range resp.Days {
		for j := range resp.Days[i].Matches {
			mm := &resp.Days[i].Matches[j]
			switch mm.ID {
			case 1:
				withPred = mm
			case 2:
				withoutPred = mm
			}
		}
	}
	if withPred == nil || withPred.Prediction == nil || withPred.Prediction.HomeScore != 2 || withPred.Prediction.AwayScore != 1 {
		t.Fatalf("match 1 prediction = %+v", withPred)
	}
	if withoutPred == nil || withoutPred.Prediction != nil {
		t.Fatalf("match 2 should have no prediction, got %+v", withoutPred)
	}
}
```

- [ ] **Step 3: Run to confirm RED**

Run: `cd backend && go test ./internal/httpapi/ -run TestGetMatches -v`
Expected: FAIL — `matchDTO` has no field `Prediction`.

- [ ] **Step 4: Add the `Prediction` field to `matchDTO` and attach it in `matches_handler.go`**

Add to the `matchDTO` struct (after `AwayScore`):

```go
	Prediction *predictionDTO `json:"prediction"`
```

Change `GetMatches` to load the caller's predictions once and pass them to the grouper:

```go
func (d *Deps) GetMatches(w http.ResponseWriter, r *http.Request) {
	rows, err := d.Matches.ListMatchesWithTeams(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load matches")
		return
	}
	u, _ := userFromContext(r.Context())
	preds, err := d.Predictions.ListPredictionsByUser(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load predictions")
		return
	}
	byMatch := make(map[int64]predictionDTO, len(preds))
	for _, p := range preds {
		byMatch[p.MatchID] = predictionDTO{HomeScore: p.HomeScore, AwayScore: p.AwayScore, PenaltyWinnerTeamID: p.PenaltyWinnerTeamID}
	}
	writeJSON(w, http.StatusOK, matchesResponse{Days: groupByISTDate(rows, now(), byMatch)})
}
```

Change `groupByISTDate`'s signature and attach the prediction when present:

```go
func groupByISTDate(rows []store.MatchWithTeams, nowUTC time.Time, preds map[int64]predictionDTO) []dayDTO {
```

Inside the loop, after building `dto` (before the day-bucketing), add:

```go
		if p, ok := preds[m.ID]; ok {
			pc := p
			dto.Prediction = &pc
		}
```

- [ ] **Step 5: Run to GREEN (whole package)**

Run: `cd backend && go test ./internal/httpapi/ -v`
Expected: all tests PASS (the existing matches tests still pass with the new `nil` preds argument).

- [ ] **Step 6: Commit**

```bash
git add backend/internal/httpapi/matches_handler.go backend/internal/httpapi/matches_test.go
git commit -m "feat(api): attach caller's prediction to GET /api/matches (single query)"
```

---

### Task 5: Wire the prediction store + document the API

**Files:**
- Modify: `backend/cmd/server/main.go` (wire `Predictions: st`)
- Modify: `backend/internal/httpapi/openapi.yaml`

- [ ] **Step 1: Wire the store in `cmd/server/main.go`**

In the `httpapi.Deps{...}` literal, add after `Matches: st,`:

```go
		Predictions:        st,
```

- [ ] **Step 2: Build + run the full backend suite**

Run: `cd backend && go build ./... && go test ./...`
Expected: builds, all packages PASS.

- [ ] **Step 3: Document `PUT /api/matches/{id}/prediction` in `openapi.yaml`**

Add a `prediction` property to the match schema (the object used by `/api/matches`):

```yaml
                prediction:
                  nullable: true
                  type: object
                  properties:
                    home_score: { type: integer }
                    away_score: { type: integer }
                    penalty_winner_team_id: { type: integer, nullable: true }
```

Add the path entry under `paths:` (match the file's existing indentation/style):

```yaml
  /api/matches/{id}/prediction:
    put:
      summary: Create or update the caller's prediction for a match
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: integer }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [home_score, away_score]
              properties:
                home_score: { type: integer, minimum: 0, maximum: 99 }
                away_score: { type: integer, minimum: 0, maximum: 99 }
                penalty_winner_team_id: { type: integer, nullable: true }
      responses:
        "200": { description: Stored prediction }
        "401": { description: Not authenticated }
        "404": { description: Match not found }
        "409": { description: Match is locked (now >= kickoff) }
        "422": { description: Validation error (TBD teams, bad scores, bad penalty winner) }
```

- [ ] **Step 4: Verify the OpenAPI doc still serves**

Run: `cd backend && go test ./internal/httpapi/ -run TestGetDocs -v` (if the docs test parses the YAML) or `cd backend && go build ./...`
Expected: PASS / builds. If a YAML parse test exists it must stay green.

- [ ] **Step 5: Commit**

```bash
git add backend/cmd/server/main.go backend/internal/httpapi/openapi.yaml
git commit -m "feat(api): wire prediction store; document prediction endpoint (openapi)"
```

---

### Task 6: Set up Vitest + Testing Library (frontend)

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/test/setup.ts`

> CLAUDE.md requires component tests for the prediction form's lock states; the runner isn't configured yet (`vitest not configured yet — skipping`). This task makes frontend TDD possible.

- [ ] **Step 1: Install dev dependencies**

Run: `cd frontend && pnpm add -D vitest@^2 @testing-library/react@^16 @testing-library/jest-dom@^6 @testing-library/user-event@^14 jsdom@^25`
Expected: added to `devDependencies`.

- [ ] **Step 2: Create `frontend/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
```

- [ ] **Step 3: Create `frontend/src/test/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 4: Add test scripts to `frontend/package.json`**

In `"scripts"`:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 5: Add a smoke test to verify the runner, then delete it**

Create `frontend/src/test/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("vitest runner", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `cd frontend && pnpm test`
Expected: 1 passed. Then delete the smoke test: `rm src/test/smoke.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/vitest.config.ts frontend/src/test/setup.ts
git commit -m "chore(frontend): configure Vitest + Testing Library"
```

---

### Task 7: Prediction types + API client + mutation hook (frontend, TDD)

**Files:**
- Modify: `frontend/src/lib/matches.ts`
- Create: `frontend/src/lib/matches.test.ts`

- [ ] **Step 1: Write the failing test `frontend/src/lib/matches.test.ts`**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { putPrediction, PredictionLockedError } from "./matches";

afterEach(() => vi.restoreAllMocks());

describe("putPrediction", () => {
  it("PUTs to the prediction endpoint and returns the stored pick", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ home_score: 2, away_score: 1, penalty_winner_team_id: null }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await putPrediction(7, { home_score: 2, away_score: 1 });

    expect(result).toEqual({ home_score: 2, away_score: 1, penalty_winner_team_id: null });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/matches/7/prediction");
    expect(opts.method).toBe("PUT");
    expect(opts.credentials).toBe("include");
    expect(JSON.parse(opts.body)).toEqual({ home_score: 2, away_score: 1 });
  });

  it("throws PredictionLockedError on a 409", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "match is locked" }) }));
    await expect(putPrediction(7, { home_score: 1, away_score: 1 })).rejects.toBeInstanceOf(PredictionLockedError);
  });
});
```

- [ ] **Step 2: Run to confirm RED**

Run: `cd frontend && pnpm test src/lib/matches.test.ts`
Expected: FAIL — `putPrediction` / `PredictionLockedError` not exported.

- [ ] **Step 3: Extend `frontend/src/lib/matches.ts`**

Add the prediction type to `MatchDTO` (after `away_score`):

```ts
  prediction: PredictionDTO | null;
```

Add these types (near `TeamDTO`):

```ts
export type PredictionDTO = {
  home_score: number;
  away_score: number;
  penalty_winner_team_id: number | null;
};

export type PredictionInput = {
  home_score: number;
  away_score: number;
  penalty_winner_team_id?: number | null;
};

// PredictionLockedError signals a server 409 — the match locked at kickoff.
export class PredictionLockedError extends Error {
  constructor() {
    super("match is locked");
    this.name = "PredictionLockedError";
  }
}
```

Add the API function + mutation hook at the end of the file:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";

export async function putPrediction(matchId: number, input: PredictionInput): Promise<PredictionDTO> {
  const res = await fetch(`${BASE}/matches/${matchId}/prediction`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 409) throw new PredictionLockedError();
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `save failed: ${res.status}`);
  }
  return res.json() as Promise<PredictionDTO>;
}

// usePutPrediction saves a prediction and refreshes the matches cache on success.
export function usePutPrediction(matchId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PredictionInput) => putPrediction(matchId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["matches"] });
    },
  });
}
```

> Move the `import { useMutation, useQueryClient }` line to the top of the file with the other imports (the inline placement above is for readability; ESLint requires imports at top).

- [ ] **Step 4: Run to GREEN**

Run: `cd frontend && pnpm test src/lib/matches.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Type-check**

Run: `cd frontend && pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/matches.ts frontend/src/lib/matches.test.ts
git commit -m "feat(frontend): prediction types, putPrediction client, usePutPrediction hook"
```

---

### Task 8: MatchRow tap-to-expand editor (frontend, impeccable + TDD)

**Files:**
- Modify: `frontend/src/components/MatchRow.tsx`
- Create: `frontend/src/components/MatchRow.test.tsx`
- Modify: `frontend/src/styles/tokens.css` (editor styles, via impeccable)

> **Use the `impeccable` skill** for the visual implementation against §7 (steppers, segmented control, Save states, locked/TBD treatments, skeleton/empty/error, ≥44px targets, focus rings, reduced-motion). The code below is a complete, test-passing baseline; impeccable refines the styling in `tokens.css` and markup details without changing the test contract (roles/labels below must remain).

- [ ] **Step 1: Write the failing test `frontend/src/components/MatchRow.test.tsx`**

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MatchRow } from "./MatchRow";
import type { MatchDTO } from "../lib/matches";
import * as matches from "../lib/matches";

function renderRow(match: MatchDTO) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MatchRow match={match} />
    </QueryClientProvider>,
  );
}

const baseGroup: MatchDTO = {
  id: 1, match_number: 1, stage: "group", round: "Group Stage", group: "A", label: "Group A",
  kickoff_utc: "2030-06-20T00:00:00Z", kickoff_ist: "2030-06-20T05:30:00+05:30",
  status: "scheduled", locked: false,
  home: { id: 1, name: "Mexico", code: "MEX" }, away: { id: 2, name: "South Africa", code: "RSA" },
  venue: { name: "Estadio Azteca", city: "Mexico City", country: "Mexico" },
  home_score: null, away_score: null, prediction: null,
};

afterEach(() => vi.restoreAllMocks());

describe("MatchRow editor", () => {
  it("expands on tap and saves the entered score", async () => {
    const put = vi.spyOn(matches, "putPrediction").mockResolvedValue({ home_score: 1, away_score: 0, penalty_winner_team_id: null });
    const user = userEvent.setup();
    renderRow(baseGroup);

    await user.click(screen.getByRole("button", { name: /predict|edit/i }));
    const editor = screen.getByRole("group", { name: /your prediction/i });
    const incHome = within(editor).getByRole("button", { name: /increase mexico/i });
    await user.click(incHome);
    await user.click(within(editor).getByRole("button", { name: /save prediction/i }));

    expect(put).toHaveBeenCalledWith(1, expect.objectContaining({ home_score: 1, away_score: 0 }));
  });

  it("renders a locked match read-only with no Save button", () => {
    renderRow({ ...baseGroup, locked: true, prediction: { home_score: 2, away_score: 1, penalty_winner_team_id: null } });
    expect(screen.queryByRole("button", { name: /save prediction/i })).toBeNull();
    expect(screen.getByText(/2\s*[–-]\s*1/)).toBeInTheDocument();
  });

  it("shows the penalty-winner control only on a knockout draw", async () => {
    const user = userEvent.setup();
    const ko: MatchDTO = {
      ...baseGroup, id: 90, stage: "knockout", round: "Round of 16", group: "", label: "Round of 16",
      home: { id: 1, name: "Brazil", code: "BRA" }, away: { id: 2, name: "Spain", code: "ESP" },
    };
    renderRow(ko);
    await user.click(screen.getByRole("button", { name: /predict|edit/i }));
    // 0-0 default is a draw → penalty control visible.
    expect(screen.getByRole("group", { name: /shootout winner/i })).toBeInTheDocument();

    // Make it 1-0 (not a draw) → control hidden.
    const editor = screen.getByRole("group", { name: /your prediction/i });
    await user.click(within(editor).getByRole("button", { name: /increase brazil/i }));
    expect(screen.queryByRole("group", { name: /shootout winner/i })).toBeNull();
  });

  it("renders TBD matches non-editable", () => {
    renderRow({ ...baseGroup, id: 100, stage: "knockout", group: "", label: "W74 vs W77", home: null, away: null });
    expect(screen.queryByRole("button", { name: /predict|edit/i })).toBeNull();
    expect(screen.getByText("W74 vs W77")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm RED**

Run: `cd frontend && pnpm test src/components/MatchRow.test.tsx`
Expected: FAIL — current `MatchRow` has no editor / buttons.

- [ ] **Step 3: Rewrite `frontend/src/components/MatchRow.tsx`**

```tsx
import { useState } from "react";
import type { MatchDTO, TeamDTO } from "../lib/matches";
import { flagClass } from "../lib/flags";
import { usePutPrediction, PredictionLockedError } from "../lib/matches";
import { Countdown } from "./Countdown";

type Props = { match: MatchDTO };

const istTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
    hour12: true,
  });

function Flag({ code }: { code?: string }) {
  const cls = flagClass(code);
  if (cls) return <span className={`flag ${cls}`} aria-hidden="true" />;
  return (
    <span className="flag flag--tbd" aria-hidden="true">
      ?
    </span>
  );
}

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function Stepper({
  label, value, onChange, disabled,
}: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="stepper">
      <button
        type="button" className="stepper__btn" aria-label={`Decrease ${label}`}
        disabled={disabled || value <= 0} onClick={() => onChange(Math.max(0, value - 1))}
      >−</button>
      <span className="stepper__value mono" aria-label={`${label} score`}>{value}</span>
      <button
        type="button" className="stepper__btn" aria-label={`Increase ${label}`}
        disabled={disabled || value >= 99} onClick={() => onChange(Math.min(99, value + 1))}
      >+</button>
    </div>
  );
}

function Editor({ match }: { match: MatchDTO }) {
  const home = match.home as TeamDTO;
  const away = match.away as TeamDTO;
  const [h, setH] = useState(match.prediction?.home_score ?? 0);
  const [a, setA] = useState(match.prediction?.away_score ?? 0);
  const [pen, setPen] = useState<number | null>(match.prediction?.penalty_winner_team_id ?? null);
  const mut = usePutPrediction(match.id);

  const isDraw = h === a;
  const showPenalty = match.stage === "knockout" && isDraw;

  const dirty =
    h !== (match.prediction?.home_score ?? 0) ||
    a !== (match.prediction?.away_score ?? 0) ||
    (showPenalty ? pen : null) !== (match.prediction?.penalty_winner_team_id ?? null);

  const onSave = () => {
    mut.mutate({
      home_score: h,
      away_score: a,
      penalty_winner_team_id: showPenalty ? pen : null,
    });
  };

  const locked = mut.error instanceof PredictionLockedError;

  return (
    <div className="match__editor" role="group" aria-label={`Your prediction for ${home.name} versus ${away.name}`}>
      <div className="match__editor-row">
        <span className="match__editor-team">{home.name}</span>
        <Stepper label={home.name} value={h} onChange={setH} disabled={mut.isPending || locked} />
      </div>
      <div className="match__editor-row">
        <span className="match__editor-team">{away.name}</span>
        <Stepper label={away.name} value={a} onChange={setA} disabled={mut.isPending || locked} />
      </div>

      {showPenalty && (
        <div className="match__penalty" role="group" aria-label="Shootout winner">
          <span className="match__penalty-label">Shootout winner</span>
          <div className="segmented">
            <button
              type="button" className={`segmented__opt ${pen === home.id ? "is-active" : ""}`}
              aria-pressed={pen === home.id} onClick={() => setPen(home.id)} disabled={mut.isPending || locked}
            >{home.code}</button>
            <button
              type="button" className={`segmented__opt ${pen === away.id ? "is-active" : ""}`}
              aria-pressed={pen === away.id} onClick={() => setPen(away.id)} disabled={mut.isPending || locked}
            >{away.code}</button>
          </div>
        </div>
      )}

      <div className="match__editor-actions">
        {locked && <span className="match__editor-error" role="alert">This match locked at kickoff.</span>}
        <button
          type="button" className="btn-brand"
          disabled={!dirty || mut.isPending || locked} onClick={onSave}
          aria-label="Save prediction"
        >
          {mut.isPending ? "Saving…" : "Save prediction"}
        </button>
      </div>
    </div>
  );
}

export function MatchRow({ match }: Props) {
  const { home, away, venue, group, round, kickoff_utc, kickoff_ist, status, locked, home_score, away_score, label, prediction } = match;
  const [open, setOpen] = useState(false);

  const decided = home !== null && away !== null;
  const isFinal = status === "final";
  const stageTag = group ? `Group ${group}` : round;
  const editable = decided && !locked;

  return (
    <article className="match" aria-label={decided ? `${home!.name} versus ${away!.name}` : label}>
      <div className="match__meta">
        <span className="match__tag">
          {stageTag}
          {venue ? <span className="match__venue"> · {venue.city}</span> : null}
        </span>
        <span className="match__when">
          <time className="mono">{istTime(kickoff_ist)} IST</time>
          {locked ? (
            <span className="match__lock"><LockIcon /> Locked</span>
          ) : (
            <span className="match__countdown"><Countdown to={kickoff_utc} /></span>
          )}
        </span>
      </div>

      {decided ? (
        <div className="match__teams">
          <div className="team team--home">
            <Flag code={home!.code} />
            <span className="team__label"><span className="team__name">{home!.name}</span><span className="team__code mono">{home!.code}</span></span>
          </div>
          <div className="match__center">
            {isFinal && home_score !== null && away_score !== null ? (
              <span className="match__score mono" aria-label={`${home_score} to ${away_score}`}>
                {home_score}<span className="match__dash">–</span>{away_score}
              </span>
            ) : (
              <span className="match__vs">vs</span>
            )}
          </div>
          <div className="team team--away">
            <Flag code={away!.code} />
            <span className="team__label"><span className="team__name">{away!.name}</span><span className="team__code mono">{away!.code}</span></span>
          </div>
        </div>
      ) : (
        <div className="match__teams match__teams--tbd">
          <span className="match__placeholder">{label}</span>
        </div>
      )}

      {decided && (
        <div className="match__predict">
          {prediction ? (
            <span className="match__pick mono">Your pick: {prediction.home_score}–{prediction.away_score}</span>
          ) : (
            !locked && <span className="match__pick match__pick--empty">No prediction yet</span>
          )}
          {editable && (
            <button
              type="button" className="match__predict-toggle"
              aria-expanded={open} onClick={() => setOpen((v) => !v)}
              aria-label={prediction ? "Edit prediction" : "Predict score"}
            >
              {prediction ? "Edit" : "Predict"}
            </button>
          )}
        </div>
      )}

      {editable && open && <Editor match={match} />}
    </article>
  );
}
```

- [ ] **Step 4: Add editor styles to `frontend/src/styles/tokens.css` (impeccable)**

Use the `impeccable` skill to author these against §7 (dark tokens, mono numerics, ≥44px targets, visible focus rings, reduced-motion). Minimum classes the test + markup rely on: `.match__predict`, `.match__pick`, `.match__predict-toggle`, `.match__editor`, `.match__editor-row`, `.stepper`, `.stepper__btn`, `.stepper__value`, `.match__penalty`, `.segmented`, `.segmented__opt`, `.match__editor-actions`, `.match__editor-error`. Baseline to refine:

```css
.match__predict {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border);
}
.match__pick { font-size: 13px; color: var(--ink); }
.match__pick--empty { color: var(--muted); }
.match__predict-toggle {
  min-height: 36px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--ink);
  font-weight: 500;
}
.match__predict-toggle:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.match__editor { margin-top: var(--space-3); display: flex; flex-direction: column; gap: var(--space-3); }
.match__editor-row { display: flex; align-items: center; justify-content: space-between; }
.stepper { display: flex; align-items: center; gap: var(--space-2); }
.stepper__btn {
  width: 44px; height: 44px; border-radius: var(--radius-md);
  border: 1px solid var(--border); background: var(--surface-2); color: var(--ink);
  font-size: 20px; line-height: 1;
}
.stepper__btn:disabled { opacity: 0.4; }
.stepper__btn:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.stepper__value { min-width: 2ch; text-align: center; font-size: 20px; }
.match__penalty { display: flex; align-items: center; justify-content: space-between; }
.match__penalty-label { font-size: 13px; color: var(--muted); }
.segmented { display: inline-flex; border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; }
.segmented__opt { min-height: 40px; padding: 0 var(--space-3); background: var(--surface-1); color: var(--ink); }
.segmented__opt.is-active { background: var(--brand); color: var(--on-brand); }
.segmented__opt:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
.match__editor-actions { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-3); }
.match__editor-error { color: var(--danger); font-size: 13px; }
@media (prefers-reduced-motion: reduce) { .match__editor { transition: none; } }
```

- [ ] **Step 5: Run the component tests to GREEN**

Run: `cd frontend && pnpm test src/components/MatchRow.test.tsx`
Expected: 4 passed. (If a class token like `--surface-2`/`--danger` doesn't exist in `tokens.css`, use the nearest existing token — check `:root` in `tokens.css`.)

- [ ] **Step 6: Type-check + full frontend test run**

Run: `cd frontend && pnpm tsc --noEmit && pnpm test`
Expected: clean types; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/MatchRow.tsx frontend/src/components/MatchRow.test.tsx frontend/src/styles/tokens.css
git commit -m "feat(frontend): tap-to-expand prediction editor with steppers + penalty pick"
```

---

### Task 9: End-to-end verification + Definition of Done

**Files:** none (verification only).

- [ ] **Step 1: Apply the new migration to the running stack**

Run: `make migrate-up` (or `make up-d` to rebuild the whole stack)
Expected: `0003_create_predictions` applies; `docker exec sayscore-mysql-1 mysql -uwcp -pwcp wcp -e "SHOW TABLES LIKE 'predictions';"` lists the table.

- [ ] **Step 2: Run the full backend suite + vet**

Run: `cd backend && go vet ./... && go test ./... -count=1`
Expected: all green.

- [ ] **Step 3: Run the full frontend suite + type-check + build**

Run: `cd frontend && pnpm tsc --noEmit && pnpm test && pnpm build`
Expected: all green; build succeeds.

- [ ] **Step 4: Manual e2e against the Docker stack**

Run: `make up-d` then exercise at http://localhost:8080 (sign in):
- Expand a group fixture, set a score, Save → reload the page → the pick persists ("Your pick: x–y").
- Edit the same fixture → Save → value updates (no duplicate; idempotent).
- For a knockout match with known teams set a draw → the shootout-winner control appears; pick a side → Save.
- Confirm a TBD knockout row shows the label and has no Predict button.

Then verify the server lock with a curl whose match has already kicked off (pick any past-kickoff match id from the DB):

```bash
# replace <id> with a match whose kickoff_utc < now, and <cookie> with your session
curl -i -X PUT http://localhost:8000/api/matches/<id>/prediction \
  -H 'Content-Type: application/json' -b 'sayscore_session=<cookie>' \
  -d '{"home_score":1,"away_score":0}'
```
Expected: `409 Conflict` with `{"error":"match is locked"}`.

- [ ] **Step 5: Confirm no prediction leakage**

Run: `curl -s http://localhost:8000/api/matches -b 'sayscore_session=<cookie>' | grep -o '"prediction":[^}]*}' | head`
Expected: only the caller's own picks appear; there is no field exposing other users' predictions anywhere in the payload.

- [ ] **Step 6: Definition of Done checklist** (tick each)

- [ ] A user can expand a group fixture, set/edit a score, Save, and it survives reload.
- [ ] Penalty-winner pick works on knockout draws with known teams.
- [ ] Server rejects writes at/after kickoff (409), verified by test + curl.
- [ ] No endpoint exposes another user's prediction.
- [ ] `go vet` + `go test ./...` green; `tsc --noEmit` + `vitest` + `pnpm build` green.

- [ ] **Step 7: Optionally run the sayscore-verifier agent** for an independent DoD check, then open the M3 PR to `main`.

---

## Self-Review

**Spec coverage:**
- §3.2 server-authoritative lock → Task 3 (409 at/after kickoff, tested at the boundary).
- §3.3 penalty-winner shape → Task 3 (knockout + draw + participating team) + Task 8 UI.
- §4 privacy → Task 4 (only caller's predictions attached; Task 9 Step 5 verifies no leak).
- §10 predictions table → Task 1 (matches the columns + `UNIQUE(user_id, match_id)`).
- §11 `PUT /api/matches/:id/prediction` + `GET /api/matches` → Tasks 3, 4, 5 (openapi).
- Known-teams rule (design) → Task 3 (TBD → 422) + Task 8 (non-editable).
- Frontend lock/TBD/penalty states + TDD → Tasks 6–8.

**Type consistency:** `predictionDTO` (Go) defined in Task 3, reused in Task 4. `PredictionDTO`/`PredictionInput`/`PredictionLockedError`/`putPrediction`/`usePutPrediction` (TS) defined in Task 7, consumed in Task 8. `store.MatchByID`, `store.ErrNotFound`, `store.UpsertPredictionParams`, `store.Prediction`, `PredictionStore`, `GetMatchByID` defined in Tasks 1–2, consumed in Tasks 3–5. `Deps.Predictions` added in Task 3, wired in Task 5.

**Placeholder scan:** no TBD/“handle errors”/“similar to”; every code step shows complete code. The only deliberately-flexible step is Task 8 Step 4 (impeccable refines CSS), which still ships a complete working baseline and fixes the test-relevant class/role contract.
