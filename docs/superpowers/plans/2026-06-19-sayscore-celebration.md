# Match Celebration (Brazil) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Brazil wins a match, every user sees a one-time, full-screen victory celebration (with an inline scorecard of the won match) on their next login after the match goes FINAL — tracked once-per-user-per-match server-side.

**Architecture:** Backend detects celebrated-team wins among finalized matches the user hasn't seen and exposes them via two `RequireAuth` endpoints (`GET /api/celebrations`, `POST /api/celebrations/seen`); a new `celebration_views(user_id, match_id)` table tracks "seen". The win-determination is a pure, table-tested Go function. The frontend ports the imported `VictoryCelebration` overlay (canvas particles + synthesized WebAudio + Brazil reveal), adds a scorecard from the API data, plays the latest pending win on login, marks all pending seen, and offers an admin-only replay button.

**Tech Stack:** Go 1.26 · chi · sqlc · golang-migrate · MySQL 8 (backend); React 18 + TS + Vite · TanStack Query · Vitest (frontend).

## Global Constraints

- **Branch:** `feat/celebration` (already checked out, off `feat/frontend-v2-design`). Do NOT rebase onto main.
- **Spec:** `docs/superpowers/specs/2026-06-19-sayscore-celebration-design.md` is the contract.
- **Celebrated teams:** Brazil only — allowlist is the team **code** `"BRA"` (stable across reseeds).
- **Conventions (CLAUDE.md):** TDD (RED→GREEN→commit). Conventional Commits. Edit SQL in `backend/internal/store/queries/`, then `make sqlc` (never hand-edit generated code in `internal/store/sqlc/`). Migrations are numbered up/down pairs; never edit an applied one. Handlers depend on store **interfaces**. Store UTC, display IST. Never commit secrets. Don't use `--no-verify`.
- **Next migration number:** `0010` (highest existing is `0009`).
- **Celebration source to port (on disk):** `/tmp/design-handoff/renjith-design/project/app/victory.jsx`, `…/app/victory.css`, asset `…/app/legends-flag.jpg`.
- **Verify gates:** backend `cd backend && go build ./... && go vet ./... && go test ./...`; frontend `cd frontend && pnpm tsc --noEmit && pnpm vitest run && pnpm build`.

---

### Task 1: Migration + sqlc queries (data layer)

**Files:**
- Create: `backend/migrations/0010_create_celebration_views.up.sql`
- Create: `backend/migrations/0010_create_celebration_views.down.sql`
- Create: `backend/internal/store/queries/celebrations.sql`
- Generated (via `make sqlc`): `backend/internal/store/sqlc/*` (do not hand-edit)

**Interfaces:**
- Produces (sqlc-generated, consumed by Task 2): `Queries.ListUnseenFinalMatchesForUser(ctx, userID int64) ([]ListUnseenFinalMatchesForUserRow, error)` and `Queries.MarkCelebrationSeen(ctx, MarkCelebrationSeenParams{UserID, MatchID int64}) error`. Row fields: `MatchID int64`, `HomeID int64`, `HomeCode string`, `HomeScore *int32`, `AwayID int64`, `AwayCode string`, `AwayScore *int32`, `PenaltyWinnerTeamID *int64`, `KickoffUtc time.Time`.

- [ ] **Step 1: Write the up migration**

`backend/migrations/0010_create_celebration_views.up.sql`:
```sql
CREATE TABLE celebration_views (
  user_id  BIGINT    NOT NULL,
  match_id BIGINT    NOT NULL,
  seen_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, match_id),
  CONSTRAINT fk_celview_user  FOREIGN KEY (user_id)  REFERENCES users (id)   ON DELETE CASCADE,
  CONSTRAINT fk_celview_match FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 2: Write the down migration**

`backend/migrations/0010_create_celebration_views.down.sql`:
```sql
DROP TABLE celebration_views;
```

- [ ] **Step 3: Write the sqlc queries**

`backend/internal/store/queries/celebrations.sql`:
```sql
-- name: ListUnseenFinalMatchesForUser :many
-- All FINAL matches the given user has not yet had a celebration recorded for,
-- newest kickoff first. Win/allowlist filtering happens in Go (celebrationFor).
SELECT m.id                     AS match_id,
       ht.id                    AS home_id,
       ht.code                  AS home_code,
       m.home_score             AS home_score,
       at.id                    AS away_id,
       at.code                  AS away_code,
       m.away_score             AS away_score,
       m.penalty_winner_team_id AS penalty_winner_team_id,
       m.kickoff_utc            AS kickoff_utc
FROM matches m
JOIN teams ht ON ht.id = m.home_team_id
JOIN teams at ON at.id = m.away_team_id
LEFT JOIN celebration_views cv ON cv.match_id = m.id AND cv.user_id = ?
WHERE m.status = 'final' AND cv.match_id IS NULL
ORDER BY m.kickoff_utc DESC;

-- name: MarkCelebrationSeen :exec
INSERT INTO celebration_views (user_id, match_id)
VALUES (?, ?)
ON DUPLICATE KEY UPDATE seen_at = seen_at;
```

- [ ] **Step 4: Regenerate sqlc and build**

Run: `cd backend && make sqlc && go build ./...`
Expected: `make sqlc` regenerates `internal/store/sqlc/` with no error; build succeeds. Confirm the generated `ListUnseenFinalMatchesForUserRow` has the fields listed in **Interfaces** above (note `HomeScore`/`AwayScore` are `*int32`, `PenaltyWinnerTeamID` is `*int64`). If `make` isn't available, run `cd backend && sqlc generate`.

- [ ] **Step 5: Apply the migration against the local DB (smoke)**

Run (only if a local DB is up via `make up`): `make migrate-up`
Expected: migration `0010` applies cleanly. If no DB is available, note it and rely on the build.

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/0010_create_celebration_views.up.sql backend/migrations/0010_create_celebration_views.down.sql backend/internal/store/queries/celebrations.sql backend/internal/store/sqlc/
git commit -m "feat(celebration): add celebration_views migration + sqlc queries"
```

---

### Task 2: Store layer — pure win-detection + methods + interface

**Files:**
- Create: `backend/internal/store/celebrations.go`
- Test: `backend/internal/store/celebrations_test.go`

**Interfaces:**
- Consumes (from Task 1): the sqlc `ListUnseenFinalMatchesForUserRow` fields and `MarkCelebrationSeenParams{UserID, MatchID int64}`.
- Produces (consumed by Task 3): type `Celebration struct { MatchID int64; TeamCode string; TeamScore int32; OpponentCode string; OpponentScore int32; KickoffUTC time.Time }`; interface `CelebrationStore interface { ListPendingCelebrations(ctx context.Context, userID int64) ([]Celebration, error); MarkCelebrationsSeen(ctx context.Context, userID int64, matchIDs []int64) error }`; var `CelebratedTeamCodes map[string]bool` (default `{"BRA": true}`).

- [ ] **Step 1: Write the failing test for the pure win-detection**

`backend/internal/store/celebrations_test.go`:
```go
package store

import (
	"testing"
	"time"
)

func i64(v int64) *int64 { return &v }

func TestCelebrationFor(t *testing.T) {
	codes := map[string]bool{"BRA": true}
	kt := time.Date(2026, 6, 19, 18, 0, 0, 0, time.UTC)

	cases := []struct {
		name string
		m    finalMatch
		want *Celebration
	}{
		{"brazil home win", finalMatch{MatchID: 1, HomeID: 9, HomeCode: "BRA", HomeScore: 3, AwayID: 5, AwayCode: "JOR", AwayScore: 1, KickoffUTC: kt},
			&Celebration{MatchID: 1, TeamCode: "BRA", TeamScore: 3, OpponentCode: "JOR", OpponentScore: 1, KickoffUTC: kt}},
		{"brazil away win", finalMatch{MatchID: 2, HomeID: 5, HomeCode: "JOR", HomeScore: 0, AwayID: 9, AwayCode: "BRA", AwayScore: 2, KickoffUTC: kt},
			&Celebration{MatchID: 2, TeamCode: "BRA", TeamScore: 2, OpponentCode: "JOR", OpponentScore: 0, KickoffUTC: kt}},
		{"brazil shootout win on a draw", finalMatch{MatchID: 3, HomeID: 9, HomeCode: "BRA", HomeScore: 1, AwayID: 5, AwayCode: "JOR", AwayScore: 1, PenaltyWinner: i64(9), KickoffUTC: kt},
			&Celebration{MatchID: 3, TeamCode: "BRA", TeamScore: 1, OpponentCode: "JOR", OpponentScore: 1, KickoffUTC: kt}},
		{"brazil loses", finalMatch{MatchID: 4, HomeID: 9, HomeCode: "BRA", HomeScore: 0, AwayID: 5, AwayCode: "JOR", AwayScore: 1, KickoffUTC: kt}, nil},
		{"brazil draw no shootout", finalMatch{MatchID: 5, HomeID: 9, HomeCode: "BRA", HomeScore: 1, AwayID: 5, AwayCode: "JOR", AwayScore: 1, KickoffUTC: kt}, nil},
		{"brazil loses shootout", finalMatch{MatchID: 6, HomeID: 9, HomeCode: "BRA", HomeScore: 1, AwayID: 5, AwayCode: "JOR", AwayScore: 1, PenaltyWinner: i64(5), KickoffUTC: kt}, nil},
		{"non-brazil win", finalMatch{MatchID: 7, HomeID: 5, HomeCode: "JOR", HomeScore: 2, AwayID: 6, AwayCode: "ESP", AwayScore: 1, KickoffUTC: kt}, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := celebrationFor(c.m, codes)
			if c.want == nil {
				if ok {
					t.Fatalf("expected no celebration, got %+v", got)
				}
				return
			}
			if !ok {
				t.Fatalf("expected a celebration, got none")
			}
			if got != *c.want {
				t.Fatalf("got %+v, want %+v", got, *c.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && go test ./internal/store/ -run TestCelebrationFor -v`
Expected: FAIL — `undefined: finalMatch` / `undefined: celebrationFor` / `undefined: Celebration`.

- [ ] **Step 3: Implement the store file**

`backend/internal/store/celebrations.go`:
```go
package store

import (
	"context"
	"fmt"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store/sqlc"
)

// CelebratedTeamCodes is the allowlist of team codes that trigger a victory
// celebration. Brazil only, for now; extend here to add more.
var CelebratedTeamCodes = map[string]bool{"BRA": true}

// Celebration is a celebrated-team win the user has not yet seen.
type Celebration struct {
	MatchID       int64
	TeamCode      string
	TeamScore     int32
	OpponentCode  string
	OpponentScore int32
	KickoffUTC    time.Time
}

// CelebrationStore is the handler-facing slice of the data layer for celebrations.
type CelebrationStore interface {
	ListPendingCelebrations(ctx context.Context, userID int64) ([]Celebration, error)
	MarkCelebrationsSeen(ctx context.Context, userID int64, matchIDs []int64) error
}

var _ CelebrationStore = (*SQLStore)(nil)

// finalMatch is the pure-Go view of one finalized match used by celebrationFor.
type finalMatch struct {
	MatchID       int64
	HomeID        int64
	HomeCode      string
	HomeScore     int32
	AwayID        int64
	AwayCode      string
	AwayScore     int32
	PenaltyWinner *int64 // shootout winner team id (set only on a regulation draw)
	KickoffUTC    time.Time
}

// celebrationFor decides whether a finalized match is a celebrated-team win and,
// if so, returns the Celebration to show. Winner = higher score; on a regulation
// draw the shootout winner (PenaltyWinner) wins. Pure: no I/O.
func celebrationFor(m finalMatch, codes map[string]bool) (Celebration, bool) {
	var winnerHome bool
	switch {
	case m.HomeScore > m.AwayScore:
		winnerHome = true
	case m.AwayScore > m.HomeScore:
		winnerHome = false
	default: // regulation draw → shootout
		if m.PenaltyWinner == nil {
			return Celebration{}, false
		}
		switch *m.PenaltyWinner {
		case m.HomeID:
			winnerHome = true
		case m.AwayID:
			winnerHome = false
		default:
			return Celebration{}, false
		}
	}

	winCode, winScore, oppCode, oppScore := m.AwayCode, m.AwayScore, m.HomeCode, m.HomeScore
	if winnerHome {
		winCode, winScore, oppCode, oppScore = m.HomeCode, m.HomeScore, m.AwayCode, m.AwayScore
	}
	if !codes[winCode] {
		return Celebration{}, false
	}
	return Celebration{
		MatchID:       m.MatchID,
		TeamCode:      winCode,
		TeamScore:     winScore,
		OpponentCode:  oppCode,
		OpponentScore: oppScore,
		KickoffUTC:    m.KickoffUTC,
	}, true
}

func deref32(p *int32) int32 {
	if p == nil {
		return 0
	}
	return *p
}

// ListPendingCelebrations returns the user's unseen celebrated-team wins, newest first.
func (s *SQLStore) ListPendingCelebrations(ctx context.Context, userID int64) ([]Celebration, error) {
	rows, err := s.q.ListUnseenFinalMatchesForUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("store: list unseen finals: %w", err)
	}
	out := make([]Celebration, 0, len(rows))
	for _, r := range rows {
		m := finalMatch{
			MatchID:       r.MatchID,
			HomeID:        r.HomeID,
			HomeCode:      r.HomeCode,
			HomeScore:     deref32(r.HomeScore),
			AwayID:        r.AwayID,
			AwayCode:      r.AwayCode,
			AwayScore:     deref32(r.AwayScore),
			PenaltyWinner: r.PenaltyWinnerTeamID,
			KickoffUTC:    r.KickoffUtc,
		}
		if c, ok := celebrationFor(m, CelebratedTeamCodes); ok {
			out = append(out, c)
		}
	}
	return out, nil
}

// MarkCelebrationsSeen idempotently records that the user has seen each match's celebration.
func (s *SQLStore) MarkCelebrationsSeen(ctx context.Context, userID int64, matchIDs []int64) error {
	for _, mid := range matchIDs {
		if err := s.q.MarkCelebrationSeen(ctx, sqlc.MarkCelebrationSeenParams{UserID: userID, MatchID: mid}); err != nil {
			return fmt.Errorf("store: mark celebration seen: %w", err)
		}
	}
	return nil
}
```

> Note on the sqlc param type for `ListUnseenFinalMatchesForUser`: the query has a single `?` (cv.user_id), so sqlc generates `ListUnseenFinalMatchesForUser(ctx, userID int64)`. If your sqlc version names the param differently, adapt the call — the generated signature is authoritative.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && go test ./internal/store/ -run TestCelebrationFor -v && go build ./...`
Expected: PASS; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/store/celebrations.go backend/internal/store/celebrations_test.go
git commit -m "feat(celebration): store layer + table-tested win detection"
```

---

### Task 3: HTTP handlers + wiring

**Files:**
- Create: `backend/internal/httpapi/celebrations_handler.go`
- Test: `backend/internal/httpapi/celebrations_test.go`
- Modify: `backend/internal/httpapi/middleware.go` (add `Celebrations` to `Deps`)
- Modify: `backend/internal/httpapi/router.go` (register two routes)
- Modify: `backend/cmd/server/main.go` (wire `Celebrations: st`)

**Interfaces:**
- Consumes (from Task 2): `store.CelebrationStore`, `store.Celebration`.
- Produces: `GET /api/celebrations` → `200 {"celebrations":[{match_id,team_code,team_score,opponent_code,opponent_score,kickoff_utc}]}`; `POST /api/celebrations/seen` body `{"match_ids":[int]}` → `200 {"seen":N}`.

- [ ] **Step 1: Write the failing handler tests**

`backend/internal/httpapi/celebrations_test.go`:
```go
package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/auth"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

type fakeCelebrationStore struct {
	pending  []store.Celebration
	seenArgs []int64
	seenUser int64
}

func (f *fakeCelebrationStore) ListPendingCelebrations(_ context.Context, _ int64) ([]store.Celebration, error) {
	return f.pending, nil
}
func (f *fakeCelebrationStore) MarkCelebrationsSeen(_ context.Context, userID int64, matchIDs []int64) error {
	f.seenUser = userID
	f.seenArgs = append(f.seenArgs, matchIDs...)
	return nil
}

func celebDeps(t *testing.T) (*Deps, *http.Cookie, *fakeCelebrationStore) {
	t.Helper()
	fs := newFakeStore()
	u, _ := fs.UpsertUser(context.Background(), store.UpsertUserParams{Email: "a@sayonetech.com", Role: store.RoleUser})
	sm := auth.NewSessionManager("test-secret")
	cs := &fakeCelebrationStore{}
	d := &Deps{Store: fs, Sessions: sm, Celebrations: cs}
	cookie := &http.Cookie{Name: sessionCookieName, Value: sm.Encode(auth.Session{UserID: u.ID}, time.Hour)}
	return d, cookie, cs
}

func TestGetCelebrations(t *testing.T) {
	d, cookie, cs := celebDeps(t)
	cs.pending = []store.Celebration{{MatchID: 12, TeamCode: "BRA", TeamScore: 3, OpponentCode: "JOR", OpponentScore: 1, KickoffUTC: time.Now().UTC()}}
	req := httptest.NewRequest(http.MethodGet, "/api/celebrations", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	NewRouter(d, false).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"match_id":12`) || !strings.Contains(rec.Body.String(), `"team_code":"BRA"`) {
		t.Fatalf("body missing celebration: %s", rec.Body.String())
	}
}

func TestGetCelebrationsRequiresAuth(t *testing.T) {
	d, _, _ := celebDeps(t)
	req := httptest.NewRequest(http.MethodGet, "/api/celebrations", nil)
	rec := httptest.NewRecorder()
	NewRouter(d, false).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestPostCelebrationsSeen(t *testing.T) {
	d, cookie, cs := celebDeps(t)
	req := httptest.NewRequest(http.MethodPost, "/api/celebrations/seen", strings.NewReader(`{"match_ids":[12,9]}`))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	NewRouter(d, false).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if len(cs.seenArgs) != 2 || cs.seenArgs[0] != 12 || cs.seenArgs[1] != 9 {
		t.Fatalf("seenArgs = %v, want [12 9]", cs.seenArgs)
	}
}

func TestPostCelebrationsSeenBadBody(t *testing.T) {
	d, cookie, _ := celebDeps(t)
	for _, body := range []string{`not json`, `{"match_ids":[]}`} {
		req := httptest.NewRequest(http.MethodPost, "/api/celebrations/seen", strings.NewReader(body))
		req.AddCookie(cookie)
		rec := httptest.NewRecorder()
		NewRouter(d, false).ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("body %q: status = %d, want 400", body, rec.Code)
		}
	}
}
```

> `NewRouter(d, false)` — match the current `NewRouter` signature. As of the merged admin-jobs change it is `NewRouter(d *Deps, _ bool)`; pass `false`. If the signature has changed to `NewRouter(d *Deps)`, drop the second arg in all four tests.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && go test ./internal/httpapi/ -run TestGetCelebrations -v`
Expected: FAIL — `Deps` has no field `Celebrations` / `d.GetCelebrations` undefined.

- [ ] **Step 3: Add the `Celebrations` field to `Deps`**

In `backend/internal/httpapi/middleware.go`, add to the `Deps` struct (after `Results`):
```go
	Results            store.ResultsStore
	Celebrations       store.CelebrationStore
```

- [ ] **Step 4: Implement the handlers**

`backend/internal/httpapi/celebrations_handler.go`:
```go
package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"
)

type celebrationDTO struct {
	MatchID       int64     `json:"match_id"`
	TeamCode      string    `json:"team_code"`
	TeamScore     int32     `json:"team_score"`
	OpponentCode  string    `json:"opponent_code"`
	OpponentScore int32     `json:"opponent_score"`
	KickoffUTC    time.Time `json:"kickoff_utc"`
}

// GetCelebrations returns the authenticated user's unseen celebrated-team wins, newest first.
func (d *Deps) GetCelebrations(w http.ResponseWriter, r *http.Request) {
	u, ok := userFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	cels, err := d.Celebrations.ListPendingCelebrations(r.Context(), u.ID)
	if err != nil {
		slog.Error("list celebrations", "err", err)
		writeError(w, http.StatusInternalServerError, "could not load celebrations")
		return
	}
	out := make([]celebrationDTO, 0, len(cels))
	for _, c := range cels {
		out = append(out, celebrationDTO(c)) // struct conversion (identical fields; json tags ignored)
	}
	writeJSON(w, http.StatusOK, map[string]any{"celebrations": out})
}

type seenRequest struct {
	MatchIDs []int64 `json:"match_ids"`
}

// PostCelebrationsSeen records that the user has seen the given matches' celebrations.
func (d *Deps) PostCelebrationsSeen(w http.ResponseWriter, r *http.Request) {
	u, ok := userFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var req seenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if len(req.MatchIDs) == 0 {
		writeError(w, http.StatusBadRequest, "match_ids required")
		return
	}
	if err := d.Celebrations.MarkCelebrationsSeen(r.Context(), u.ID, req.MatchIDs); err != nil {
		slog.Error("mark celebrations seen", "err", err)
		writeError(w, http.StatusInternalServerError, "could not save")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"seen": len(req.MatchIDs)})
}
```

> The `celebrationDTO(store.Celebration(c))` conversion works only if the field order/types of `celebrationDTO` exactly match `store.Celebration`. They do (MatchID, TeamCode, TeamScore, OpponentCode, OpponentScore, KickoffUTC). If you change either struct, build a field-by-field literal instead.

- [ ] **Step 5: Register the routes**

In `backend/internal/httpapi/router.go`, inside the `priv` (RequireAuth) group, after the `priv.Get("/winners", d.GetWinners)` line, add:
```go
			priv.Get("/celebrations", d.GetCelebrations)
			priv.Post("/celebrations/seen", d.PostCelebrationsSeen)
```

- [ ] **Step 6: Wire the store in main.go**

In `backend/cmd/server/main.go`, in the `httpapi.Deps{...}` literal, after `Results: st,` add:
```go
		Results:            st,
		Celebrations:       st,
```

- [ ] **Step 7: Run the tests + build to verify they pass**

Run: `cd backend && go test ./internal/httpapi/ -run 'TestGetCelebrations|TestPostCelebrations' -v && go build ./...`
Expected: all PASS; build succeeds.

- [ ] **Step 8: Commit**

```bash
git add backend/internal/httpapi/celebrations_handler.go backend/internal/httpapi/celebrations_test.go backend/internal/httpapi/middleware.go backend/internal/httpapi/router.go backend/cmd/server/main.go
git commit -m "feat(celebration): GET/POST celebration endpoints + wiring"
```

---

### Task 4: Frontend data layer (`celebrations.ts`)

**Files:**
- Create: `frontend/src/lib/celebrations.ts`
- Test: `frontend/src/lib/celebrations.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 5 & 6): `type Celebration = { match_id: number; team_code: string; team_score: number; opponent_code: string; opponent_score: number; kickoff_utc: string }`; `useCelebrations(enabled: boolean)` (TanStack `useQuery`, key `["celebrations"]`); `useMarkCelebrationsSeen()` (TanStack `useMutation`, `mutate(matchIds: number[])`).

- [ ] **Step 1: Write the failing test**

`frontend/src/lib/celebrations.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getCelebrations, markCelebrationsSeen } from "./celebrations";

describe("celebrations api", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("getCelebrations returns the celebrations array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ celebrations: [{ match_id: 12, team_code: "BRA", team_score: 3, opponent_code: "JOR", opponent_score: 1, kickoff_utc: "2026-06-19T18:00:00Z" }] }),
    }));
    const out = await getCelebrations();
    expect(out).toHaveLength(1);
    expect(out[0].match_id).toBe(12);
    expect(out[0].team_code).toBe("BRA");
  });

  it("markCelebrationsSeen POSTs match_ids", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ seen: 2 }) });
    vi.stubGlobal("fetch", f);
    await markCelebrationsSeen([12, 9]);
    expect(f).toHaveBeenCalledOnce();
    const [, init] = f.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ match_ids: [12, 9] });
    expect(init.credentials).toBe("include");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && pnpm vitest run src/lib/celebrations.test.ts`
Expected: FAIL — cannot resolve `./celebrations`.

- [ ] **Step 3: Implement the data layer**

`frontend/src/lib/celebrations.ts`:
```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

export type Celebration = {
  match_id: number;
  team_code: string;
  team_score: number;
  opponent_code: string;
  opponent_score: number;
  kickoff_utc: string;
};

export async function getCelebrations(): Promise<Celebration[]> {
  const res = await fetch(`${BASE}/celebrations`, { credentials: "include" });
  if (!res.ok) throw new Error(`celebrations failed: ${res.status}`);
  const body = (await res.json()) as { celebrations: Celebration[] };
  return body.celebrations ?? [];
}

export async function markCelebrationsSeen(matchIds: number[]): Promise<void> {
  const res = await fetch(`${BASE}/celebrations/seen`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ match_ids: matchIds }),
  });
  if (!res.ok) throw new Error(`mark seen failed: ${res.status}`);
}

export function useCelebrations(enabled: boolean) {
  return useQuery({ queryKey: ["celebrations"], queryFn: getCelebrations, enabled });
}

export function useMarkCelebrationsSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markCelebrationsSeen,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["celebrations"] });
    },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && pnpm vitest run src/lib/celebrations.test.ts && pnpm tsc --noEmit`
Expected: PASS; type-check clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/celebrations.ts frontend/src/lib/celebrations.test.ts
git commit -m "feat(celebration): frontend celebrations api + hooks"
```

---

### Task 5: Port `VictoryCelebration` + styles + asset + scorecard

**Files:**
- Create: `frontend/src/components/VictoryCelebration.tsx` (port of `/tmp/design-handoff/renjith-design/project/app/victory.jsx`)
- Create: `frontend/src/styles/victory.css` (port of `/tmp/design-handoff/renjith-design/project/app/victory.css`)
- Create: `frontend/public/legends-flag.jpg` (copy of `/tmp/design-handoff/renjith-design/project/app/legends-flag.jpg`)
- Test: `frontend/src/components/VictoryCelebration.test.tsx`

**Interfaces:**
- Consumes (from Task 4): `Celebration`.
- Produces (consumed by Task 6): `VictoryCelebration({ celebration, onDone }: { celebration: Celebration; onDone: () => void })`.

- [ ] **Step 1: Copy the asset and the CSS**

```bash
cp "/tmp/design-handoff/renjith-design/project/app/legends-flag.jpg" frontend/public/legends-flag.jpg
cp "/tmp/design-handoff/renjith-design/project/app/victory.css" frontend/src/styles/victory.css
```

- [ ] **Step 2: Adapt the CSS — fix the asset path, drop the replay FAB, add the scorecard**

In `frontend/src/styles/victory.css`:
1. The component will reference the image as `/legends-flag.jpg` (public root) — no CSS change needed for that (the `src` is set in JSX); leave the CSS as-is.
2. **Delete** the `.vc-replay-fab`, `.vc-replay-fab:hover`, `.vc-replay-fab:active`, and `.vc-replay-emoji` rules (the prototype's review-only FAB; we add an admin button in Task 6).
3. **Append** the scorecard styles before the final `@media (prefers-reduced-motion: reduce)` block:
```css
/* ---- Inline match scorecard (e.g. BRA 3 – 1 JOR) ---- */
.vc-scoreline {
  display: inline-flex; align-items: center; gap: 12px;
  margin-top: 16px; padding: 8px 16px; border-radius: 999px; z-index: 4;
  background: rgba(2, 12, 8, 0.4);
  border: 1px solid rgba(255, 223, 0, 0.42);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  font-family: var(--font-display); font-weight: 800; opacity: 0;
}
.vc-overlay.playing .vc-scoreline { animation: vc-score-in 0.7s cubic-bezier(.2,1.4,.4,1) 4.1s both; }
@keyframes vc-score-in {
  0%   { opacity: 0; transform: translateY(14px) scale(0.9); }
  100% { opacity: 1; transform: none; }
}
.vc-scoreline__team { display: inline-flex; align-items: center; gap: 7px; color: #fff; font-size: clamp(14px, 3vw, 20px); }
.vc-scoreline__score { font-size: clamp(20px, 4.4vw, 30px); color: #ffe14d; letter-spacing: 0.04em; }
.vc-scoreline__dash { opacity: 0.55; padding: 0 2px; }
```
4. In the existing `@media (prefers-reduced-motion: reduce)` block, **add** `.vc-overlay.playing .vc-scoreline` to the comma-separated selector list (so its animation duration/delay is reduced too).

- [ ] **Step 3: Create the component from the source, converting to TS**

Create `frontend/src/components/VictoryCelebration.tsx` by copying `/tmp/design-handoff/renjith-design/project/app/victory.jsx` and applying exactly these changes:

1. **Top of file** — replace the source's bare `function createVictoryAudio()` preamble with these imports first:
```tsx
import { useEffect, useRef, useState } from "react";
import { TrophyIcon } from "./icons";
import { Flag } from "./Flag";
import type { Celebration } from "../lib/celebrations";
import "../styles/victory.css";
```
2. **Keep `createVictoryAudio()` and `const VC_COLORS = [...]` verbatim** from the source (the synthesized-audio + particle-colour code is framework-agnostic and unchanged).
3. **Component signature** — replace the source's `function VictoryCelebration({ onDone }) {` with:
```tsx
type Props = { celebration: Celebration; onDone: () => void };

export function VictoryCelebration({ celebration, onDone }: Props) {
```
4. **Refs/state** — replace `React.useRef(null)` / `React.useState("playing")` / `React.useEffect` / `React.useRef` with the named hooks and TS types:
```tsx
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<ReturnType<typeof createVictoryAudio> | null>(null);
  const [stage, setStage] = useState<"playing" | "fading">("playing");
```
   and change `React.useEffect(() => {` → `useEffect(() => {`.
5. **TS guards inside the effect** — after `const canvas = canvasRef.current;` add `if (!canvas) return;`, and after `const ctx = canvas.getContext("2d");` add `if (!ctx) return;`. Everything else in the effect body (canvas sizing, particle arrays, `spawn*`, `drawCrowd`, `frame`, the timeouts, the cleanup) stays **verbatim**.
6. **Trophy icon** — in the returned JSX, replace `<Icon.trophy />` with `<TrophyIcon />`.
7. **Image src** — change `src="app/legends-flag.jpg"` to `src="/legends-flag.jpg"`.
8. **Add the scorecard** — inside `<div className="vc-center">`, immediately after the `<p className="vc-sub">Campeões do Mundo</p>` line, insert:
```tsx
        <div
          className="vc-scoreline"
          aria-label={`${celebration.team_code} ${celebration.team_score}, ${celebration.opponent_code} ${celebration.opponent_score}`}
        >
          <span className="vc-scoreline__team">
            <Flag code={celebration.team_code} size={26} />
            {celebration.team_code}
          </span>
          <span className="vc-scoreline__score">
            {celebration.team_score}
            <span className="vc-scoreline__dash">–</span>
            {celebration.opponent_score}
          </span>
          <span className="vc-scoreline__team">
            {celebration.opponent_code}
            <Flag code={celebration.opponent_code} size={26} />
          </span>
        </div>
```
9. **Remove the trailing** `window.VictoryCelebration = VictoryCelebration;` line from the source (not needed — it's an ES module export now).

- [ ] **Step 4: Write the component test**

`frontend/src/components/VictoryCelebration.test.tsx`:
```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { VictoryCelebration } from "./VictoryCelebration";
import type { Celebration } from "../lib/celebrations";

// jsdom has no canvas/AudioContext — stub enough that the effect doesn't throw.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    setTransform: () => {}, clearRect: () => {}, save: () => {}, restore: () => {},
    translate: () => {}, rotate: () => {}, fillRect: () => {}, beginPath: () => {},
    arc: () => {}, ellipse: () => {}, moveTo: () => {}, lineTo: () => {},
    quadraticCurveTo: () => {}, closePath: () => {}, fill: () => {}, stroke: () => {},
    fillStyle: "", strokeStyle: "", globalAlpha: 1, lineWidth: 1, lineCap: "",
    shadowColor: "", shadowBlur: 0,
  } as unknown as CanvasRenderingContext2D);
  // @ts-expect-error — jsdom has no AudioContext; createVictoryAudio catches and no-ops.
  window.AudioContext = undefined;
});

const sample: Celebration = {
  match_id: 12, team_code: "BRA", team_score: 3,
  opponent_code: "JOR", opponent_score: 1, kickoff_utc: "2026-06-19T18:00:00Z",
};

describe("VictoryCelebration", () => {
  it("renders the scorecard from the celebration prop", () => {
    render(<VictoryCelebration celebration={sample} onDone={() => {}} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByLabelText("BRA 3, JOR 1")).toBeInTheDocument();
  });

  it("calls onDone when Skip is clicked", () => {
    const onDone = vi.fn();
    render(<VictoryCelebration celebration={sample} onDone={onDone} />);
    fireEvent.click(screen.getByText(/Skip to results/i));
    // finishNow defers onDone by ~420ms; flush timers.
    return new Promise<void>((resolve) => setTimeout(() => { expect(onDone).toHaveBeenCalled(); resolve(); }, 500));
  });
});
```

- [ ] **Step 5: Run the test + type-check + build**

Run: `cd frontend && pnpm vitest run src/components/VictoryCelebration.test.tsx && pnpm tsc --noEmit && pnpm build`
Expected: PASS; type-check clean; build bundles the asset.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/VictoryCelebration.tsx frontend/src/components/VictoryCelebration.test.tsx frontend/src/styles/victory.css frontend/public/legends-flag.jpg
git commit -m "feat(celebration): port VictoryCelebration overlay + scorecard"
```

---

### Task 6: App.tsx trigger + admin replay button

**Files:**
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/App.test.tsx` (add a `describe` block)

**Interfaces:**
- Consumes (from Tasks 4 & 5): `useCelebrations`, `useMarkCelebrationsSeen`, `Celebration`, `VictoryCelebration`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/App.test.tsx`. First extend the existing mocks at the top of the file — add a mock for `./lib/celebrations` next to the other `vi.mock` calls:
```tsx
vi.mock("./lib/celebrations", () => ({
  useCelebrations: vi.fn(),
  useMarkCelebrationsSeen: vi.fn(),
}));
```
and stub the overlay so the test doesn't drive canvas/audio:
```tsx
vi.mock("./components/VictoryCelebration", () => ({
  VictoryCelebration: ({ celebration, onDone }: { celebration: { match_id: number }; onDone: () => void }) => (
    <div data-testid="victory" data-match={celebration.match_id}>
      <button onClick={onDone}>finish-celebration</button>
    </div>
  ),
}));
```
Add the imports at the top: `import { useCelebrations, useMarkCelebrationsSeen } from "./lib/celebrations";`

Then add this `describe` block (and have `mockSession`/`beforeEach` set celebration defaults — see Step 3 note):
```tsx
describe("App — celebrations", () => {
  const markMutate = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession("user");
    vi.mocked(useMarkCelebrationsSeen).mockReturnValue({ mutate: markMutate } as unknown as ReturnType<typeof useMarkCelebrationsSeen>);
  });

  it("plays the latest pending celebration and marks ALL pending seen on done", async () => {
    const user = userEvent.setup();
    vi.mocked(useCelebrations).mockReturnValue({
      data: [
        { match_id: 20, team_code: "BRA", team_score: 2, opponent_code: "ESP", opponent_score: 0, kickoff_utc: "2026-06-20T18:00:00Z" },
        { match_id: 12, team_code: "BRA", team_score: 3, opponent_code: "JOR", opponent_score: 1, kickoff_utc: "2026-06-19T18:00:00Z" },
      ],
    } as unknown as ReturnType<typeof useCelebrations>);

    render(<App />);
    // latest (index 0) is shown
    expect(screen.getByTestId("victory")).toHaveAttribute("data-match", "20");
    await user.click(screen.getByText("finish-celebration"));
    expect(markMutate).toHaveBeenCalledWith([20, 12]);
    expect(screen.queryByTestId("victory")).not.toBeInTheDocument();
  });

  it("shows no celebration when none pending", () => {
    vi.mocked(useCelebrations).mockReturnValue({ data: [] } as unknown as ReturnType<typeof useCelebrations>);
    render(<App />);
    expect(screen.queryByTestId("victory")).not.toBeInTheDocument();
  });

  it("admin debug button replays without marking seen; absent for non-admins", async () => {
    const user = userEvent.setup();
    vi.mocked(useCelebrations).mockReturnValue({ data: [] } as unknown as ReturnType<typeof useCelebrations>);

    // non-admin: no button
    mockSession("user");
    const { unmount } = render(<App />);
    expect(screen.queryByRole("button", { name: /play victory/i })).not.toBeInTheDocument();
    unmount();

    // admin: button present, replays without a seen POST
    mockSession("admin");
    render(<App />);
    await user.click(screen.getByRole("button", { name: /play victory/i }));
    expect(screen.getByTestId("victory")).toBeInTheDocument();
    await user.click(screen.getByText("finish-celebration"));
    expect(markMutate).not.toHaveBeenCalled();
  });
});
```

> The existing `App.test.tsx` defines `mockSession(role)` and mocks `useMe`/`useLogout`/`Home`/`Admin`. Reuse them. If `mockSession` doesn't already exist as a reusable helper in the file, factor the existing `useMe`/`useLogout` mock setup into one.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && pnpm vitest run src/App.test.tsx`
Expected: FAIL — App doesn't render `victory` / no "Play victory" button.

- [ ] **Step 3: Wire celebrations into App.tsx**

In `frontend/src/App.tsx`:

1. Add imports:
```tsx
import { VictoryCelebration } from "./components/VictoryCelebration";
import { useCelebrations, useMarkCelebrationsSeen, type Celebration } from "./lib/celebrations";
```
2. Inside `App()`, with the other hooks/state (near `const isAdmin = me?.role === "admin";`), add:
```tsx
  const { data: celebrations } = useCelebrations(!!me);
  const markSeen = useMarkCelebrationsSeen();
  const [replay, setReplay] = useState<Celebration | null>(null);
  const [dismissed, setDismissed] = useState(false);
```
3. After the early returns (loading / unauthenticated), where the authenticated shell is computed, derive the active celebration and the handler:
```tsx
  const pending = celebrations ?? [];
  const activeCelebration: Celebration | null =
    replay ?? (!dismissed && pending.length > 0 ? pending[0] : null);

  function handleCelebrationDone() {
    if (replay) {
      setReplay(null);
      return;
    }
    setDismissed(true);
    if (pending.length > 0) {
      markSeen.mutate(pending.map((c) => c.match_id));
    }
  }

  const sampleCelebration: Celebration = {
    match_id: -1, team_code: "BRA", team_score: 3,
    opponent_code: "JOR", opponent_score: 1, kickoff_utc: new Date().toISOString(),
  };
```
4. In the authenticated `return (...)`, render the overlay and the admin button as the last children of the `<>...</>` fragment (after the `{helpOpen && <HowToPlayModal .../>}` line):
```tsx
      {activeCelebration && (
        <VictoryCelebration celebration={activeCelebration} onDone={handleCelebrationDone} />
      )}
      {isAdmin && (
        <button
          type="button"
          className="vc-debug-fab"
          onClick={() => setReplay(pending[0] ?? sampleCelebration)}
          title="Replay the victory celebration"
        >
          🏆 Play victory
        </button>
      )}
```
5. Add the debug-button style to `frontend/src/styles/victory.css` (append):
```css
/* Admin-only replay trigger (works in all environments) */
.vc-debug-fab {
  position: fixed; left: 20px; bottom: 20px; z-index: 99980;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 16px; border-radius: 999px; cursor: pointer;
  font-family: var(--font-display); font-size: 13px; font-weight: 700;
  color: #04210f; background: linear-gradient(180deg, #ffe14d, #ffc400);
  border: 1px solid rgba(255,255,255,0.5);
  box-shadow: 0 8px 22px -6px rgba(255,196,0,0.6), inset 0 1px 0 rgba(255,255,255,0.7);
  transition: transform 0.14s, box-shadow 0.14s;
}
.vc-debug-fab:hover { transform: translateY(-2px); }
.vc-debug-fab:active { transform: translateY(0); }
@media (prefers-reduced-motion: reduce) { .vc-debug-fab { transition: none; } }
```

> `setState`-in-effect is banned by lint here (`react-hooks/set-state-in-effect`). `dismissed`/`replay` are only ever set inside event handlers (`handleCelebrationDone`, the button `onClick`) — never inside a `useEffect` — so this stays lint-clean. Do not add an effect that calls `setDismissed`.

- [ ] **Step 4: Run the tests + type-check to verify they pass**

Run: `cd frontend && pnpm vitest run src/App.test.tsx && pnpm tsc --noEmit && pnpm exec eslint src/App.tsx`
Expected: PASS; type-check clean; eslint clean (exit 0).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx frontend/src/styles/victory.css
git commit -m "feat(celebration): play latest win on login + admin replay button"
```

---

### Task 7: Spec docs + full verification (Definition of Done)

**Files:**
- Modify: `docs/REQUIREMENTS.md` (add a Celebrations subsection + the two endpoints)

**Interfaces:** none (docs + verification only).

- [ ] **Step 1: Update REQUIREMENTS.md — feature behavior**

In `docs/REQUIREMENTS.md`, add a new subsection under §3 (features), titled **"3.x Match celebrations"**, with this content:
```markdown
### 3.x Match celebrations

When a **celebrated team (Brazil only)** wins a match, each user sees a one-time
full-screen **victory celebration** on their next visit after the match goes FINAL —
**once per user per match, across devices** (tracked server-side in `celebration_views`).
The overlay (canvas confetti/fireworks + a synthesized carnival soundtrack + a "VITÓRIA"
reveal) shows an inline **scorecard** of the won match (e.g. `BRA 3 – 1 JOR`) and a "Skip"
button. A "celebrated win" is a FINAL match whose winner (higher score, or the knockout
shootout winner on a draw) is an allowlisted team (`BRA`). If multiple unseen celebrated
wins exist, only the **most recent** plays; the rest are marked seen. Admins get a replay
button (all environments). The allowlist is server-side and extensible (Brazil only for now).
```

- [ ] **Step 2: Update REQUIREMENTS.md — API surface**

In the API section (§11), add under the authenticated routes:
```markdown
- `GET    /api/celebrations` — unseen celebrated-team wins for the caller, newest-first:
  `{ "celebrations": [ { "match_id", "team_code", "team_score", "opponent_code",
  "opponent_score", "kickoff_utc" } ] }`. `RequireAuth`, all environments.
- `POST   /api/celebrations/seen` — body `{ "match_ids": [int,…] }` → `200 { "seen": N }`.
  Idempotently records the caller has seen those celebrations. `400` on empty/invalid body.
```

- [ ] **Step 3: Commit the docs**

```bash
git add docs/REQUIREMENTS.md
git commit -m "docs(celebration): document celebrations behavior + endpoints"
```

- [ ] **Step 4: Full backend verification**

Run: `cd backend && go build ./... && go vet ./... && go test ./... -count=1`
Expected: build + vet clean; all packages pass (including `internal/store` `TestCelebrationFor` and `internal/httpapi` celebration tests).

- [ ] **Step 5: Full frontend verification**

Run: `cd frontend && pnpm tsc --noEmit && pnpm vitest run && pnpm build`
Expected: type-check clean; all tests pass; build succeeds (asset `legends-flag.jpg` bundled).

- [ ] **Step 6: Definition of Done (manual, against the local stack)**

With `make up` running and a DB containing at least one FINAL Brazil win:
- [ ] Log in as a fresh user → the celebration plays once on load, shows the correct scorecard (`BRA x – y OPP`), then settles into the app.
- [ ] Reload → it does **not** replay (server-tracked seen).
- [ ] With 2+ unseen Brazil wins, only the latest plays; a second reload shows none (older ones were marked seen).
- [ ] A non-Brazil win never triggers a celebration.
- [ ] As an admin, the "Play victory" button replays the overlay and does **not** affect seen-state (reload still behaves per the rules above).
- [ ] `prefers-reduced-motion` shortens the animations (overlay still appears + is skippable).

- [ ] **Step 7: Finish the branch**

Use **superpowers:finishing-a-development-branch** to open the PR to `main` per CONTRIBUTING (description, "How I tested", Type=Feature, checklist; screenshots of the celebration + scorecard from the author). Note in the PR that this branches off `feat/frontend-v2-design` — confirm the intended merge base with the maintainer (celebration is backend + a self-contained overlay, so it can target `main` directly if V2 isn't merged yet).
