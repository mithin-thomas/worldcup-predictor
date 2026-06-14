# Admin foundation + match/result management + users (M8a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A role-gated Admin screen with match CRUD, result/penalty correction (sets `manual_override`, immediately re-scores), and user promote/demote — the admin shell M8b/M8c reuse.

**Architecture:** New admin store methods (thin sqlc pass-throughs) + admin handlers behind `RequireAdmin`, registered in all environments. Result correction reuses the M5 `ResultsStore` tx (`WithTx`/`UpdateMatchResult`/`ListPredictionsForMatch`/`SetPredictionScore`) + the pure `scoring.Compute`. Admin-created matches synthesize a `source_id` (`MAX+1`) since the column is `NOT NULL UNIQUE`. Frontend gets an Admin nav entry (role-gated) + an Admin screen (Matches + Users) built with `impeccable`.

**Tech Stack:** Go 1.26 · chi/v5 · sqlc · MySQL 8 · React 18 + TS + Vite · TanStack Query · Vitest. (No react-router / no shadcn — state-driven nav + hand-rolled components, per the repo.)

**Branch:** `feat/m8a-admin-match-mgmt` (already created off `main`).

**Spec:** `docs/superpowers/specs/2026-06-14-sayscore-m8a-admin-match-mgmt-design.md`.

**Conventions:** thin sqlc pass-throughs (`store: …: %w`); handlers use `now()`, `writeJSON`/`writeError`, generic 500 + `slog`; server-authoritative; chi `chi.URLParam` for `:id`; no new migrations (schema already supports everything; `predictions.match_id` cascades); Conventional Commits per task; `gofmt -w` + `go vet`.

**No migration needed:** `matches` has all columns; `predictions.match_id` is `ON DELETE CASCADE` (verified); `users.role` exists.

---

## File structure

- `backend/internal/store/queries/admin.sql` — admin match + user queries (create).
- `backend/internal/store/sqlc/*` — regenerated.
- `backend/internal/store/admin.go` — `AdminMatchStore` + `AdminUserStore` types/interfaces/methods (create).
- `backend/internal/httpapi/admin_matches_handler.go` (+ test) — match CRUD + result (create).
- `backend/internal/httpapi/admin_users_handler.go` (+ test) — list + role (create).
- `backend/internal/httpapi/middleware.go` — `Deps.AdminMatches`, `Deps.AdminUsers` (modify).
- `backend/internal/httpapi/router.go` — register admin routes (modify).
- `backend/cmd/server/main.go` — wire the new Deps (modify).
- `frontend/src/lib/admin.ts` — hooks (create).
- `frontend/src/routes/Admin.tsx` (+ test) — Admin screen (create).
- `frontend/src/App.tsx` — Admin nav entry (modify).
- `frontend/src/styles/tokens.css` — `.admin*` (modify).
- `docs/REQUIREMENTS.md` + `backend/internal/httpapi/openapi.yaml` (modify).

---

## Task 1: sqlc — admin match + user queries

**Files:** Create `backend/internal/store/queries/admin.sql`; regenerate.

- [ ] **Step 1: write the queries**

```sql
-- name: ListMatchesForAdmin :many
SELECT m.id, m.match_number, m.stage, m.round,
       m.home_team_id, ht.name AS home_team, ht.code AS home_code,
       m.away_team_id, at.name AS away_team, at.code AS away_code,
       m.kickoff_utc, m.status, m.home_score, m.away_score,
       m.went_to_penalties, m.penalty_winner_team_id, m.manual_override
FROM matches m
LEFT JOIN teams ht ON ht.id = m.home_team_id
LEFT JOIN teams at ON at.id = m.away_team_id
ORDER BY m.kickoff_utc ASC, m.id ASC;

-- name: CreateMatchAdmin :execlastid
INSERT INTO matches
  (source_id, match_number, stage, round, group_letter, match_label,
   home_team_id, away_team_id, kickoff_utc, status, manual_override)
VALUES
  ((SELECT COALESCE(MAX(source_id),0)+1 FROM matches AS m2),
   ?, ?, ?, '', '', ?, ?, ?, 'scheduled', 1);

-- name: UpdateMatchDetailAdmin :exec
UPDATE matches
SET home_team_id = ?, away_team_id = ?, kickoff_utc = ?, stage = ?, round = ?, manual_override = 1
WHERE id = ?;

-- name: DeleteMatchAdmin :execrows
DELETE FROM matches WHERE id = ?;

-- name: MatchExists :one
SELECT COUNT(*) FROM matches WHERE id = ?;

-- name: ListUsersAdmin :many
SELECT id, email, name, avatar_url, role FROM users ORDER BY name ASC, email ASC;

-- name: CountAdmins :one
SELECT COUNT(*) FROM users WHERE role = 'admin';

-- name: GetUserRole :one
SELECT role FROM users WHERE id = ?;
```

(For result correction, reuse the existing `GetMatchByID` / `ResultsStore` methods — see Task 4. `MatchExists` guards PUT-detail/result 404s.)

- [ ] **Step 2: regenerate + build**

Run: `make sqlc && cd backend && go build ./...`
Expected: PASS. Note the generated names (`ListMatchesForAdminRow`, `CreateMatchAdminParams`, etc.) — Task 2 adapts to them. `CreateMatchAdmin` returns `(int64, error)` (last insert id).

- [ ] **Step 3: commit**

```bash
git add backend/internal/store/queries/admin.sql backend/internal/store/sqlc
git commit -m "feat(store): sqlc admin match CRUD + user list/role queries"
```

---

## Task 2: Store — AdminMatchStore + AdminUserStore

**Files:** Create `backend/internal/store/admin.go`.

- [ ] **Step 1: types + interfaces + methods**

```go
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store/sqlc"
)

// AdminMatch is a full match row for the admin management list.
type AdminMatch struct {
	ID                  int64
	MatchNumber         int32
	Stage               string
	Round               string
	HomeTeamID          *int64
	HomeTeam            string
	AwayTeamID          *int64
	AwayTeam            string
	KickoffUTC          time.Time
	Status              string
	HomeScore           *int64
	AwayScore           *int64
	WentToPenalties     bool
	PenaltyWinnerTeamID *int64
	ManualOverride      bool
}

type CreateMatchParams struct {
	MatchNumber int32
	Stage       string
	Round       string
	HomeTeamID  int64
	AwayTeamID  int64
	KickoffUTC  time.Time
}

type UpdateMatchDetailParams struct {
	ID         int64
	HomeTeamID int64
	AwayTeamID int64
	KickoffUTC time.Time
	Stage      string
	Round      string
}

type AdminMatchStore interface {
	ListMatchesForAdmin(ctx context.Context) ([]AdminMatch, error)
	CreateMatch(ctx context.Context, p CreateMatchParams) (int64, error)
	UpdateMatchDetail(ctx context.Context, p UpdateMatchDetailParams) error
	DeleteMatch(ctx context.Context, id int64) (bool, error)
	MatchExists(ctx context.Context, id int64) (bool, error)
	TeamExists(ctx context.Context, id int64) (bool, error) // already on SQLStore (M7)
}

type AdminUserStore interface {
	ListUsers(ctx context.Context) ([]User, error)
	CountAdmins(ctx context.Context) (int64, error)
	GetUserRole(ctx context.Context, id int64) (Role, error)
	SetUserRole(ctx context.Context, id int64, role Role) error // already on SQLStore (M5)
}

var _ AdminMatchStore = (*SQLStore)(nil)
var _ AdminUserStore = (*SQLStore)(nil)

func (s *SQLStore) ListMatchesForAdmin(ctx context.Context) ([]AdminMatch, error) {
	rows, err := s.q.ListMatchesForAdmin(ctx)
	if err != nil {
		return nil, fmt.Errorf("store: list matches for admin: %w", err)
	}
	out := make([]AdminMatch, 0, len(rows))
	for _, r := range rows {
		out = append(out, AdminMatch{
			ID: r.ID, MatchNumber: r.MatchNumber, Stage: string(r.Stage), Round: r.Round,
			HomeTeamID: ptrI64(r.HomeTeamID), HomeTeam: r.HomeTeam.String,
			AwayTeamID: ptrI64(r.AwayTeamID), AwayTeam: r.AwayTeam.String,
			KickoffUTC: r.KickoffUtc, Status: string(r.Status),
			HomeScore: ptrI64FromInt32(r.HomeScore), AwayScore: ptrI64FromInt32(r.AwayScore),
			WentToPenalties: r.WentToPenalties, PenaltyWinnerTeamID: ptrI64(r.PenaltyWinnerTeamID),
			ManualOverride: r.ManualOverride,
		})
	}
	return out, nil
}

func (s *SQLStore) CreateMatch(ctx context.Context, p CreateMatchParams) (int64, error) {
	id, err := s.q.CreateMatchAdmin(ctx, sqlc.CreateMatchAdminParams{
		MatchNumber: p.MatchNumber, Stage: sqlc.MatchesStage(p.Stage), Round: p.Round,
		HomeTeamID: sql.NullInt64{Int64: p.HomeTeamID, Valid: true},
		AwayTeamID: sql.NullInt64{Int64: p.AwayTeamID, Valid: true},
		KickoffUtc: p.KickoffUTC,
	})
	if err != nil {
		return 0, fmt.Errorf("store: create match: %w", err)
	}
	return id, nil
}

func (s *SQLStore) UpdateMatchDetail(ctx context.Context, p UpdateMatchDetailParams) error {
	if err := s.q.UpdateMatchDetailAdmin(ctx, sqlc.UpdateMatchDetailAdminParams{
		HomeTeamID: sql.NullInt64{Int64: p.HomeTeamID, Valid: true},
		AwayTeamID: sql.NullInt64{Int64: p.AwayTeamID, Valid: true},
		KickoffUtc: p.KickoffUTC, Stage: sqlc.MatchesStage(p.Stage), Round: p.Round, ID: p.ID,
	}); err != nil {
		return fmt.Errorf("store: update match detail: %w", err)
	}
	return nil
}

func (s *SQLStore) DeleteMatch(ctx context.Context, id int64) (bool, error) {
	n, err := s.q.DeleteMatchAdmin(ctx, id)
	if err != nil {
		return false, fmt.Errorf("store: delete match: %w", err)
	}
	return n > 0, nil
}

func (s *SQLStore) MatchExists(ctx context.Context, id int64) (bool, error) {
	n, err := s.q.MatchExists(ctx, id)
	if err != nil {
		return false, fmt.Errorf("store: match exists: %w", err)
	}
	return n > 0, nil
}

func (s *SQLStore) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := s.q.ListUsersAdmin(ctx)
	if err != nil {
		return nil, fmt.Errorf("store: list users: %w", err)
	}
	out := make([]User, 0, len(rows))
	for _, r := range rows {
		out = append(out, User{ID: r.ID, Email: r.Email, Name: r.Name, AvatarURL: r.AvatarUrl, Role: Role(r.Role)})
	}
	return out, nil
}

func (s *SQLStore) CountAdmins(ctx context.Context) (int64, error) {
	n, err := s.q.CountAdmins(ctx)
	if err != nil {
		return 0, fmt.Errorf("store: count admins: %w", err)
	}
	return n, nil
}

func (s *SQLStore) GetUserRole(ctx context.Context, id int64) (Role, error) {
	r, err := s.q.GetUserRole(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("store: get user role: %w", err)
	}
	return Role(r), nil
}

// ptrI64FromInt32 maps a nullable INT score column to *int64.
func ptrI64FromInt32(n sql.NullInt32) *int64 {
	if !n.Valid {
		return nil
	}
	v := int64(n.Int32)
	return &v
}
```

Adapt field names/types to the actual generated sqlc (e.g. `HomeScore` may be `sql.NullInt32`; the `User` struct field names; whether `ptrI64` exists already — it does, used in results.go). If `ptrI64FromInt32` collides, reuse an existing helper.

- [ ] **Step 2: build + vet**

Run: `cd backend && go build ./... && go vet ./...`
Expected: PASS.

- [ ] **Step 3: commit**

```bash
git add backend/internal/store/admin.go
git commit -m "feat(store): AdminMatchStore + AdminUserStore (CRUD, list, role, guards data)"
```

---

## Task 3: Admin match CRUD handlers (TDD)

**Files:** Create `backend/internal/httpapi/admin_matches_handler.go` + `_test.go`; add `Deps.AdminMatches store.AdminMatchStore` and (for result re-score) `Deps.Results store.ResultsStore` to `middleware.go`.

- [ ] **Step 1: failing tests** (list 200, create 201 + manual_override, create bad teams 400, delete 204/404, authz). Use a fake `AdminMatchStore`. Example shape:

```go
func TestPostAdminMatch_CreatesWithOverride(t *testing.T) {
	st := &fakeAdminMatchStore{teamOK: true, createID: 77}
	d := &Deps{AdminMatches: st}
	body := `{"home_team_id":1,"away_team_id":2,"kickoff_utc":"2026-06-20T18:00:00Z","stage":"group"}`
	req := ctxUser(httptest.NewRequest(http.MethodPost, "/api/admin/matches", strings.NewReader(body)), 1)
	rec := httptest.NewRecorder()
	d.PostAdminMatch(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d want 201", rec.Code)
	}
	if !st.created { t.Error("CreateMatch not called") }
}

func TestPostAdminMatch_SameTeams400(t *testing.T) { /* home==away → 400, no create */ }
func TestPostAdminMatch_BadStage400(t *testing.T) { /* stage not group/knockout → 400 */ }
func TestDeleteAdminMatch_NotFound404(t *testing.T) { /* DeleteMatch returns false → 404 */ }
```

The fake records calls and returns configured `teamOK`/`createID`/`deleted`.

- [ ] **Step 2: run RED** → handlers undefined.

- [ ] **Step 3: implement** `admin_matches_handler.go`:

```go
package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

type adminMatchDTO struct { /* mirror store.AdminMatch as JSON */ }

func (d *Deps) GetAdminMatches(w http.ResponseWriter, r *http.Request) {
	rows, err := d.AdminMatches.ListMatchesForAdmin(r.Context())
	if err != nil {
		slog.Error("admin list matches", "err", err)
		writeError(w, http.StatusInternalServerError, "could not load matches")
		return
	}
	// map rows → DTO slice (resolve nil scores → omitted/null), writeJSON 200
}

type createMatchRequest struct {
	HomeTeamID int64  `json:"home_team_id"`
	AwayTeamID int64  `json:"away_team_id"`
	KickoffUTC string `json:"kickoff_utc"`
	Stage      string `json:"stage"`
	Round      string `json:"round"`
}

func (d *Deps) PostAdminMatch(w http.ResponseWriter, r *http.Request) {
	var req createMatchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body"); return
	}
	kickoff, ok := d.validateMatchInput(w, r, req.HomeTeamID, req.AwayTeamID, req.KickoffUTC, req.Stage)
	if !ok { return }
	id, err := d.AdminMatches.CreateMatch(r.Context(), store.CreateMatchParams{
		Stage: req.Stage, Round: req.Round, HomeTeamID: req.HomeTeamID,
		AwayTeamID: req.AwayTeamID, KickoffUTC: kickoff,
	})
	if err != nil {
		slog.Error("admin create match", "err", err)
		writeError(w, http.StatusInternalServerError, "could not create match"); return
	}
	writeJSON(w, http.StatusCreated, map[string]int64{"id": id})
}

func (d *Deps) PutAdminMatch(w http.ResponseWriter, r *http.Request) {
	id, ok := adminMatchID(w, r); if !ok { return }
	var req createMatchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body"); return
	}
	exists, err := d.AdminMatches.MatchExists(r.Context(), id)
	if err != nil { slog.Error("admin match exists", "err", err); writeError(w, http.StatusInternalServerError, "error"); return }
	if !exists { writeError(w, http.StatusNotFound, "match not found"); return }
	kickoff, ok2 := d.validateMatchInput(w, r, req.HomeTeamID, req.AwayTeamID, req.KickoffUTC, req.Stage)
	if !ok2 { return }
	if err := d.AdminMatches.UpdateMatchDetail(r.Context(), store.UpdateMatchDetailParams{
		ID: id, HomeTeamID: req.HomeTeamID, AwayTeamID: req.AwayTeamID, KickoffUTC: kickoff, Stage: req.Stage, Round: req.Round,
	}); err != nil { slog.Error("admin update match", "err", err); writeError(w, http.StatusInternalServerError, "could not update match"); return }
	writeJSON(w, http.StatusOK, map[string]int64{"id": id})
}

func (d *Deps) DeleteAdminMatch(w http.ResponseWriter, r *http.Request) {
	id, ok := adminMatchID(w, r); if !ok { return }
	deleted, err := d.AdminMatches.DeleteMatch(r.Context(), id)
	if err != nil { slog.Error("admin delete match", "err", err); writeError(w, http.StatusInternalServerError, "could not delete match"); return }
	if !deleted { writeError(w, http.StatusNotFound, "match not found"); return }
	w.WriteHeader(http.StatusNoContent)
}

// validateMatchInput: teams distinct + exist, kickoff RFC3339, stage in {group,knockout}.
func (d *Deps) validateMatchInput(w http.ResponseWriter, r *http.Request, home, away int64, kickoffStr, stage string) (time.Time, bool) {
	if home == away { writeError(w, http.StatusBadRequest, "home and away teams must differ"); return time.Time{}, false }
	if stage != "group" && stage != "knockout" { writeError(w, http.StatusBadRequest, "stage must be group or knockout"); return time.Time{}, false }
	kickoff, err := time.Parse(time.RFC3339, kickoffStr)
	if err != nil { writeError(w, http.StatusBadRequest, "kickoff_utc must be RFC3339"); return time.Time{}, false }
	for _, id := range []int64{home, away} {
		ok, err := d.AdminMatches.TeamExists(r.Context(), id)
		if err != nil { slog.Error("team exists", "err", err); writeError(w, http.StatusInternalServerError, "validation failed"); return time.Time{}, false }
		if !ok { writeError(w, http.StatusBadRequest, "unknown team"); return time.Time{}, false }
	}
	return kickoff, true
}

func adminMatchID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 { writeError(w, http.StatusBadRequest, "invalid id"); return 0, false }
	return id, true
}
```

(Tests inject `chi` URL params via `chi.NewRouteContext()` + `context.WithValue(req.Context(), chi.RouteCtxKey, rctx)`, or test through `NewRouter`. Use whichever the existing tests use — match the M6/M7 style.)

- [ ] **Step 4: run GREEN** → `go test ./internal/httpapi/ -run AdminMatch -v`.

- [ ] **Step 5: commit**

```bash
git add backend/internal/httpapi/admin_matches_handler.go backend/internal/httpapi/admin_matches_handler_test.go backend/internal/httpapi/middleware.go
git commit -m "feat(api): admin match CRUD (create/edit/delete + list), manual_override on writes"
```

---

## Task 4: Result correction + re-score (TDD)

**Files:** Modify `admin_matches_handler.go` (+ test). Reuse `Deps.Results store.ResultsStore` and the M5 re-score pattern (`backend/internal/jobs/results_ingest.go` lines ~85-105) + `scoring.Compute`.

- [ ] **Step 1: failing test** — correcting a result sets the match final + re-scores predictions idempotently. Use a fake `ResultsStore` (mirror the jobs test fake) that records the match update + returns predictions + captures `SetPredictionScore` calls. Assert: status final, `manual_override` intent, points computed via the real `scoring.Compute` (e.g. exact → 5), and running twice yields identical scores. Add a validation test (negative score → 400; went_to_penalties with a penalty winner not in {home,away} or non-knockout → 400).

- [ ] **Step 2: run RED.**

- [ ] **Step 3: implement** `PutAdminMatchResult`:

```go
type matchResultRequest struct {
	HomeScore           int    `json:"home_score"`
	AwayScore           int    `json:"away_score"`
	WentToPenalties     bool   `json:"went_to_penalties"`
	PenaltyWinnerTeamID *int64 `json:"penalty_winner_team_id"`
}

func (d *Deps) PutAdminMatchResult(w http.ResponseWriter, r *http.Request) {
	id, ok := adminMatchID(w, r); if !ok { return }
	var req matchResultRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body"); return
	}
	if req.HomeScore < 0 || req.AwayScore < 0 {
		writeError(w, http.StatusBadRequest, "scores must be non-negative"); return
	}
	// Load the match (stage + team ids) for knockout/penalty validation + Compute.
	m, err := d.Results.FindMatchByID(r.Context(), id) // add this thin read (see note)
	if errors.Is(err, store.ErrNotFound) { writeError(w, http.StatusNotFound, "match not found"); return }
	if err != nil { slog.Error("admin result load", "err", err); writeError(w, http.StatusInternalServerError, "error"); return }
	knockout := m.Stage == store.StageKnockout
	if req.WentToPenalties {
		if !knockout { writeError(w, http.StatusBadRequest, "only knockout matches go to penalties"); return }
		if req.PenaltyWinnerTeamID == nil || (m.HomeTeamID != nil && *req.PenaltyWinnerTeamID != *m.HomeTeamID && m.AwayTeamID != nil && *req.PenaltyWinnerTeamID != *m.AwayTeamID) {
			writeError(w, http.StatusBadRequest, "penalty winner must be the home or away team"); return
		}
	}
	err = d.Results.WithTx(r.Context(), func(tx store.ResultsStore) error {
		if err := tx.UpdateMatchResult(r.Context(), store.UpdateMatchResultParams{
			ID: id, Status: store.StatusFinal, HomeScore: int32(req.HomeScore), AwayScore: int32(req.AwayScore),
			WentToPenalties: req.WentToPenalties, PenaltyWinnerTeamID: req.PenaltyWinnerTeamID,
			APIFixtureID: m.APIFixtureID, // preserve existing
		}); err != nil { return err }
		preds, err := tx.ListPredictionsForMatch(r.Context(), id)
		if err != nil { return err }
		for _, p := range preds {
			sc := scoring.Compute(
				scoring.Prediction{Home: int(p.HomeScore), Away: int(p.AwayScore), PenaltyWinner: p.PenaltyWinnerTeamID},
				scoring.Result{Final: true, Knockout: knockout, Home: req.HomeScore, Away: req.AwayScore,
					WentToPenalties: req.WentToPenalties, PenaltyWinner: req.PenaltyWinnerTeamID},
			)
			if err := tx.SetPredictionScore(r.Context(), p.ID, int32(sc.Points), int32(sc.PenaltyBonus)); err != nil { return err }
		}
		return tx.SetMatchManualOverride(r.Context(), id) // ensure override flag (see note)
	})
	if err != nil { slog.Error("admin result tx", "err", err); writeError(w, http.StatusInternalServerError, "could not save result"); return }
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "final"})
}
```

Two small store additions this needs (add to `ResultsStore` + a query; the existing `UpdateMatchResult` does NOT set `manual_override`):
- `FindMatchByID(ctx, id) (MatchForResult, error)` — a `GetMatchByID`-backed read returning stage/teams/api_fixture_id (`ErrNotFound` on missing). (There is already `GetMatchByID`; wrap it into a `MatchForResult`.)
- `SetMatchManualOverride(ctx, id) error` — `UPDATE matches SET manual_override = 1 WHERE id = ?` (new query). Alternatively extend `UpdateMatchResult` to also set `manual_override = 1` for the admin path — but the ingest must NOT set it, so keep a separate `SetMatchManualOverride` call in the admin tx rather than changing the shared `UpdateMatchResult`.

Add these to `internal/store/queries/admin.sql` (`SetMatchManualOverride :exec`) + `results.go`/`admin.go`, regenerate, and to the `ResultsStore` interface (and the jobs fake + any test fake gets the no-op).

- [ ] **Step 4: run GREEN.**

- [ ] **Step 5: commit**

```bash
git add backend/internal/httpapi/admin_matches_handler.go backend/internal/httpapi/admin_matches_handler_test.go backend/internal/store backend/internal/jobs
git commit -m "feat(api): admin result/penalty correction re-scores predictions (idempotent, manual_override)"
```

---

## Task 5: Admin user list + role (TDD)

**Files:** Create `backend/internal/httpapi/admin_users_handler.go` + `_test.go`; add `Deps.AdminUsers store.AdminUserStore`.

- [ ] **Step 1: failing tests** — list 200; promote user→admin 200; **demote self → 400**; **demote last admin → 400**; demote a non-last admin → 200; unknown id → 404; bad role → 400. Fake `AdminUserStore` with configurable `adminCount`, `roleByID`.

```go
func TestPostUserRole_CannotDemoteSelf(t *testing.T) {
	st := &fakeAdminUserStore{adminCount: 2, roleByID: map[int64]store.Role{1: store.RoleAdmin}}
	d := &Deps{AdminUsers: st}
	req := ctxUser(httptest.NewRequest(http.MethodPost, "/api/admin/users/1/role", strings.NewReader(`{"role":"user"}`)), 1) // self = id 1
	// route id param = 1 → 400
}
func TestPostUserRole_CannotDemoteLastAdmin(t *testing.T) {
	st := &fakeAdminUserStore{adminCount: 1, roleByID: map[int64]store.Role{2: store.RoleAdmin}}
	// caller id 9 demoting the only admin id 2 → 400
}
```

- [ ] **Step 2: run RED.**

- [ ] **Step 3: implement** `admin_users_handler.go`:

```go
func (d *Deps) GetAdminUsers(w http.ResponseWriter, r *http.Request) {
	users, err := d.AdminUsers.ListUsers(r.Context())
	if err != nil { slog.Error("admin list users", "err", err); writeError(w, http.StatusInternalServerError, "could not load users"); return }
	// map to DTO {id,email,name,avatar_url,role}, writeJSON 200
}

type setRoleRequest struct { Role string `json:"role"` }

func (d *Deps) PostUserRole(w http.ResponseWriter, r *http.Request) {
	id, ok := adminMatchID(w, r); if !ok { return } // reuse the :id parser
	var req setRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil { writeError(w, http.StatusBadRequest, "invalid JSON body"); return }
	role := store.Role(req.Role)
	if role != store.RoleAdmin && role != store.RoleUser { writeError(w, http.StatusBadRequest, "role must be admin or user"); return }
	caller, _ := userFromContext(r.Context())
	if id == caller.ID { writeError(w, http.StatusBadRequest, "cannot change your own role"); return }
	current, err := d.AdminUsers.GetUserRole(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) { writeError(w, http.StatusNotFound, "user not found"); return }
	if err != nil { slog.Error("get role", "err", err); writeError(w, http.StatusInternalServerError, "error"); return }
	if current == store.RoleAdmin && role == store.RoleUser {
		n, err := d.AdminUsers.CountAdmins(r.Context())
		if err != nil { slog.Error("count admins", "err", err); writeError(w, http.StatusInternalServerError, "error"); return }
		if n <= 1 { writeError(w, http.StatusBadRequest, "cannot remove the last admin"); return }
	}
	if err := d.AdminUsers.SetUserRole(r.Context(), id, role); err != nil { slog.Error("set role", "err", err); writeError(w, http.StatusInternalServerError, "could not update role"); return }
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "role": role})
}
```

- [ ] **Step 4: run GREEN.**

- [ ] **Step 5: commit**

```bash
git add backend/internal/httpapi/admin_users_handler.go backend/internal/httpapi/admin_users_handler_test.go backend/internal/httpapi/middleware.go
git commit -m "feat(api): admin user list + role change with self/last-admin guards"
```

---

## Task 6: Wire routes + main.go + authz tests

**Files:** Modify `router.go`, `cmd/server/main.go`; add an authz test.

- [ ] **Step 1: routes** — in `router.go`, inside the authed `priv` group:

```go
			priv.With(d.RequireAdmin).Get("/admin/matches", d.GetAdminMatches)
			priv.With(d.RequireAdmin).Post("/admin/matches", d.PostAdminMatch)
			priv.With(d.RequireAdmin).Put("/admin/matches/{id}", d.PutAdminMatch)
			priv.With(d.RequireAdmin).Put("/admin/matches/{id}/result", d.PutAdminMatchResult)
			priv.With(d.RequireAdmin).Delete("/admin/matches/{id}", d.DeleteAdminMatch)
			priv.With(d.RequireAdmin).Get("/admin/users", d.GetAdminUsers)
			priv.With(d.RequireAdmin).Post("/admin/users/{id}/role", d.PostUserRole)
```

(All unconditional — not in `if debug{}`.)

- [ ] **Step 2: main.go** — set `deps.AdminMatches = st`, `deps.AdminUsers = st`, `deps.Results = st` (if not already wired for M5; check — the ingest builds its own, but Deps may not hold a ResultsStore yet; add the field + wire `st`).

- [ ] **Step 3: authz test** — through `NewRouter`, a non-admin session → 403 on `GET/POST/PUT/DELETE /api/admin/matches*` and `/api/admin/users*`; no session → 401. (Table-driven over the paths/methods.)

- [ ] **Step 4: full backend suite**

Run: `cd backend && go build ./... && go vet ./... && go test ./...`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add backend/internal/httpapi/router.go backend/cmd/server/main.go backend/internal/httpapi/*_test.go
git commit -m "feat(server): wire admin match/user routes + deps; authz tests"
```

---

## Task 7: Frontend — Admin screen + nav (impeccable)

**Files:** Create `frontend/src/lib/admin.ts`, `frontend/src/routes/Admin.tsx` (+ test); modify `App.tsx`, `tokens.css`.

**Design contract (§7 / impeccable):** dark tokens; JetBrains Mono for scores/dates; ≥44px targets; confirm dialog (`--danger`) for delete-match + demote; skeletons; `role="alert"` errors; teaching empty states; IST display (kickoff entered in IST, converted to UTC at the edge). **Build with the `impeccable` skill.**

- [ ] **Step 1: API client** `frontend/src/lib/admin.ts` — types + hooks: `useAdminMatches`, `useAdminUsers`, and mutations `useCreateMatch`, `useUpdateMatch`, `useDeleteMatch`, `useSetMatchResult`, `useSetUserRole` (each PUT/POST/DELETE with `credentials:"include"`, invalidating `["admin","matches"]` / `["admin","users"]`). Mirror `lib/winners.ts`/`lib/bonus.ts`.

- [ ] **Step 2: failing component test** `Admin.test.tsx` (mock `../lib/admin`, `../lib/auth`): renders the matches list + users list; a delete requires confirm before calling the mutation; the user's own row has no demote control; the result form shows the penalty-winner picker only when stage=knockout && went_to_penalties.

- [ ] **Step 3: implement `Admin.tsx`** — two sections via a segmented control (Matches | Users). Matches: list grouped by IST date (reuse the IST formatting from LeaderboardPanel/HallOfFame), per-row Edit/Result/Delete + a New-match form (team selects from `useTeams`, IST kickoff input → UTC); Users: list with role badge + Make admin/Make user toggle (confirm on demote; self row read-only). Build visuals with impeccable; `.admin*` classes in tokens.css.

- [ ] **Step 4: nav** — in `App.tsx`, add an **Admin** nav item to the existing toggle, rendered only when `me.role === "admin"`; selecting shows `<Admin/>`.

- [ ] **Step 5: tests + type-check**

Run: `cd frontend && pnpm vitest run && pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: commit**

```bash
git add frontend/src/lib/admin.ts frontend/src/routes/Admin.tsx frontend/src/routes/Admin.test.tsx frontend/src/App.tsx frontend/src/styles/tokens.css
git commit -m "feat(frontend): admin screen — match CRUD + result correction + user roles (impeccable)"
```

---

## Task 8: Docs — REQUIREMENTS.md + OpenAPI

**Files:** Modify `docs/REQUIREMENTS.md`, `backend/internal/httpapi/openapi.yaml`.

- [ ] **Step 1:** §11 — document the seven admin endpoints (matches list/create/edit/delete/result, users list/role) with shapes; note `manual_override` is set on every admin match write and result correction re-scores. Note fixtures/sync + settings + recompute remain M8b/M8c.
- [ ] **Step 2:** add the paths + schemas to `openapi.yaml`, mirroring existing entries (keep valid 3.1).
- [ ] **Step 3:** `cd backend && go test ./internal/httpapi/... && python3 -c "import yaml; yaml.safe_load(open('backend/internal/httpapi/openapi.yaml')); print('YAML_OK')"`.
- [ ] **Step 4:** commit `docs: spec + OpenAPI for admin match/user endpoints`.

---

## Task 9: Verification + DoD

- [ ] **Step 1:** `cd backend && go vet ./... && go test ./...` green.
- [ ] **Step 2:** `cd frontend && pnpm tsc --noEmit && pnpm vitest run && pnpm build` green.
- [ ] **Step 3:** live smoke (mint admin cookie as in M6/M7, or browser): create a match → appears in `GET /api/admin/matches`; `PUT …/result` on a match with predictions → predictions re-scored (check `GET /api/leaderboard?period=overall` reflects it) and re-running is idempotent; `DELETE` a match → its predictions gone; `POST /api/admin/users/:id/role` promotes, and demoting yourself / the last admin → 400; every `/api/admin/*` → 403 for a non-admin.
- [ ] **Step 4:** run `sayscore-verifier`.

---

## Self-review notes

- **Spec coverage:** queries (T1), store (T2), match CRUD (T3), result re-score (T4), users+guards (T5), routes/authz/wiring (T6), frontend (T7), docs (T8), DoD (T9). All M8a spec sections mapped.
- **manual_override:** set in CreateMatchAdmin/UpdateMatchDetailAdmin (SQL) and via SetMatchManualOverride in the result tx — the shared `UpdateMatchResult` is deliberately left NOT setting it (so the ingest path is unchanged).
- **Re-score reuse:** Task 4 mirrors the M5 ingest tx (`WithTx`+`Compute`) exactly; idempotent absolute `SET`.
- **No placeholders beyond generated-name adaptation** (T1→T2) and the existing-helper checks (`ptrI64`, the `:id` test-context pattern) — each says what to adapt.
- **Type consistency:** `CreateMatchParams`/`UpdateMatchDetailParams`/`AdminMatch` defined T2 used T3; `store.ResultsStore` reused T4; guards use `CountAdmins`+`GetUserRole` defined T2 used T5.
