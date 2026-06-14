# SayScore — Milestone 6: Leaderboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Weekly and overall leaderboards served as plain SUMs over `predictions.points`/`penalty_bonus` (ranked, paginated, with the caller's own rank), a weekly-winner cron/trigger job that records official co-winners in `weekly_results`, and the leaderboard surfaced on the landing screen (desktop two-column, mobile in-page toggle) — no new route.

**Architecture:** SQL stays a simple `GROUP BY ... ORDER BY` (weekly window filtered by `kickoff_utc`; overall ordered by the §5.1 cascade). A pure `internal/leaderboard` package owns ranking (competition ties for weekly; cascade for overall), pagination, and locating the caller — the high-value test surface. The handler maps store rows → ranked DTO rows + `me`. The weekly-winner job (`internal/jobs`) computes the previous IST week, upserts `weekly_results` idempotently, and marks co-winners. The frontend folds a `LeaderboardPanel` into the landing screen.

**Tech Stack:** Go 1.26 (stdlib `time`, chi, sqlc, golang-migrate, MySQL 8, `robfig/cron/v3`); React 18 + TS + Vite, TanStack Query, Vitest, dark §7 tokens. No new backend deps.

**Spec references:** design spec `docs/superpowers/specs/2026-06-14-sayscore-m6-leaderboards-design.md`; REQUIREMENTS.md §3.5, §5/§5.1, §6, §10, §11. **Out of scope:** tournament bonus (M7 — overall sums match points + penalty_bonus only; the §5.1 bonus tier is 0); admin tools (M8, reuses the M5 debug trigger). IST = `Asia/Kolkata`; week boundaries are computed in IST then converted to UTC for the `kickoff_utc` filter.

---

## File Structure

**Backend — new**
- `backend/migrations/0005_create_weekly_results.{up,down}.sql`
- `backend/internal/store/queries/leaderboard.sql` — leaderboard SUMs + weekly_results upsert/list.
- `backend/internal/store/leaderboard.go` — `LeaderboardStore`, domain types, `SQLStore` adapters.
- `backend/internal/leaderboard/rank.go` — pure ranking/pagination/find.
- `backend/internal/leaderboard/rank_test.go`
- `backend/internal/httpapi/leaderboard_handler.go` + `leaderboard_test.go`
- `backend/internal/jobs/weekly_winner.go` + `weekly_winner_test.go`
- `frontend/src/lib/leaderboard.ts` — types + client + `useLeaderboard`.
- `frontend/src/components/LeaderboardPanel.tsx` + `LeaderboardPanel.test.tsx`
- `frontend/src/routes/Home.tsx` — landing layout (fixtures + leaderboard, responsive).

**Backend — changed**
- `backend/internal/store/sqlc/` — regenerated.
- `backend/internal/config/config.go` — `WeeklyCron`.
- `backend/internal/httpapi/middleware.go` — extend `JobRunner` with `RunWeeklyWinner`.
- `backend/internal/httpapi/admin_jobs_handler.go` — `weekly-winner` case.
- `backend/internal/httpapi/router.go` — register `GET /api/leaderboard`.
- `backend/cmd/server/main.go` — weekly cron + a `serverJobs` runner implementing both jobs.

**Frontend — changed**
- `frontend/src/App.tsx` — render `<Home/>`.
- `frontend/src/styles/tokens.css` — landing two-column + panel styles (impeccable).
- `.env.example`, `backend/.env` — `WEEKLY_CRON`.

---

## Conventions

Backend cmds from `backend/`; frontend from `frontend/`. Lefthook: Conventional Commits; `gofmt`/`go vet` (vet at pre-push), `vitest`/`tsc` at pre-push. TDD: failing test → RED → minimal code → GREEN → commit. **sqlc generated identifiers are authoritative** — after `make sqlc`, read `internal/store/sqlc/*` and adapt adapters (SUM/CAST columns come back as `int64`; `week_start` DATE is `time.Time`). Times stored UTC, shown IST. Don't stage `.claude/`, `node_modules/`, `dist/`, `.playwright-mcp/`.

---

### Task 1: Migration 0005 + sqlc queries

**Files:**
- Create: `backend/migrations/0005_create_weekly_results.up.sql`, `.down.sql`
- Create: `backend/internal/store/queries/leaderboard.sql`
- Regenerate: `backend/internal/store/sqlc/`

- [ ] **Step 1: `0005_create_weekly_results.up.sql`**

```sql
CREATE TABLE weekly_results (
    id         BIGINT    NOT NULL AUTO_INCREMENT,
    user_id    BIGINT    NOT NULL,
    week_start DATE      NOT NULL,
    points     INT       NOT NULL,
    is_winner  BOOL      NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_weekly_user_week (user_id, week_start),
    KEY idx_weekly_week (week_start),
    CONSTRAINT fk_weekly_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 2: `0005_create_weekly_results.down.sql`**

```sql
DROP TABLE IF EXISTS weekly_results;
```

- [ ] **Step 3: Create `backend/internal/store/queries/leaderboard.sql`**

```sql
-- name: WeeklyLeaderboard :many
SELECT u.id AS user_id, u.name, u.avatar_url,
       CAST(COALESCE(SUM(COALESCE(p.points,0) + COALESCE(p.penalty_bonus,0)), 0) AS SIGNED) AS points,
       CAST(COALESCE(SUM(CASE WHEN p.points = 5 THEN 1 ELSE 0 END), 0) AS SIGNED) AS exact_count,
       CAST(COALESCE(SUM(CASE WHEN p.points = 3 THEN 1 ELSE 0 END), 0) AS SIGNED) AS correct_count
FROM predictions p
JOIN users u ON u.id = p.user_id
JOIN matches m ON m.id = p.match_id
WHERE m.kickoff_utc >= ? AND m.kickoff_utc < ?
GROUP BY u.id, u.name, u.avatar_url
ORDER BY points DESC, exact_count DESC, correct_count DESC, u.id ASC;

-- name: OverallLeaderboard :many
SELECT u.id AS user_id, u.name, u.avatar_url,
       CAST(COALESCE(SUM(COALESCE(p.points,0) + COALESCE(p.penalty_bonus,0)), 0) AS SIGNED) AS points,
       CAST(COALESCE(SUM(CASE WHEN p.points = 5 THEN 1 ELSE 0 END), 0) AS SIGNED) AS exact_count,
       CAST(COALESCE(SUM(CASE WHEN p.points = 3 THEN 1 ELSE 0 END), 0) AS SIGNED) AS correct_count
FROM predictions p
JOIN users u ON u.id = p.user_id
GROUP BY u.id, u.name, u.avatar_url
ORDER BY points DESC, exact_count DESC, correct_count DESC, u.id ASC;

-- name: UpsertWeeklyResult :exec
INSERT INTO weekly_results (user_id, week_start, points, is_winner)
VALUES (?, ?, ?, ?)
ON DUPLICATE KEY UPDATE points = VALUES(points), is_winner = VALUES(is_winner);

-- name: ListWeeklyResults :many
SELECT user_id, points, is_winner
FROM weekly_results
WHERE week_start = ?;
```

- [ ] **Step 4: Regenerate sqlc**

Run: `make sqlc`
Expected: generates `WeeklyLeaderboard`, `WeeklyLeaderboardRow`, `WeeklyLeaderboardParams`, `OverallLeaderboard`, `OverallLeaderboardRow`, `UpsertWeeklyResult`, `UpsertWeeklyResultParams`, `ListWeeklyResults`, `ListWeeklyResultsRow`. No errors.

- [ ] **Step 5: Inspect generated names** (don't edit generated code)

Run: `grep -nE 'type (WeeklyLeaderboardRow|WeeklyLeaderboardParams|OverallLeaderboardRow|UpsertWeeklyResultParams|ListWeeklyResultsRow)|func \(q \*Queries\) (WeeklyLeaderboard|OverallLeaderboard|UpsertWeeklyResult|ListWeeklyResults)' backend/internal/store/sqlc/*.go`
Expected: each present once. Record exact field names/types for Task 2 (e.g. `Points int64`, `ExactCount int64`, `WeekStart time.Time`, `IsWinner bool`, `AvatarUrl string`; `WeeklyLeaderboardParams{KickoffUtc time.Time; KickoffUtc_2 time.Time}` — sqlc names the two `?` params for the same column `KickoffUtc`/`KickoffUtc_2`).

- [ ] **Step 6: Build**

Run: `cd backend && go build ./...`
Expected: clean (no callers yet).

- [ ] **Step 7: Commit**

```bash
git add backend/migrations/0005_create_weekly_results.up.sql backend/migrations/0005_create_weekly_results.down.sql backend/internal/store/queries/leaderboard.sql backend/internal/store/sqlc/
git commit -m "feat(db): weekly_results (0005) + leaderboard SUM queries (sqlc)"
```

---

### Task 2: Store layer — LeaderboardStore

**Files:**
- Create: `backend/internal/store/leaderboard.go`

> Thin sqlc pass-throughs (verified by build + Tasks 4/5 fake-driven tests). Adjust `sqlc.*` names to Task 1 Step 5. If the two weekly params are named `KickoffUtc`/`KickoffUtc_2`, map `from`→`KickoffUtc`, `to`→`KickoffUtc_2`.

- [ ] **Step 1: Create `backend/internal/store/leaderboard.go`**

```go
package store

import (
	"context"
	"fmt"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store/sqlc"
)

// LeaderboardRow is one user's summed standing (ordered by the query).
type LeaderboardRow struct {
	UserID    int64
	Name      string
	AvatarURL string
	Points    int64
	Exact     int64
	Correct   int64
}

// WeeklyResult is a stored weekly_results row (for surfacing is_winner).
type WeeklyResult struct {
	UserID   int64
	Points   int32
	IsWinner bool
}

// UpsertWeeklyResultParams writes one user's weekly standing + winner flag.
type UpsertWeeklyResultParams struct {
	UserID    int64
	WeekStart time.Time
	Points    int32
	IsWinner  bool
}

// LeaderboardStore is the read surface for leaderboards + the weekly-winner write.
type LeaderboardStore interface {
	WeeklyLeaderboard(ctx context.Context, from, to time.Time) ([]LeaderboardRow, error)
	OverallLeaderboard(ctx context.Context) ([]LeaderboardRow, error)
	ListWeeklyResults(ctx context.Context, weekStart time.Time) ([]WeeklyResult, error)
	UpsertWeeklyResult(ctx context.Context, p UpsertWeeklyResultParams) error
}

var _ LeaderboardStore = (*SQLStore)(nil)

func (s *SQLStore) WeeklyLeaderboard(ctx context.Context, from, to time.Time) ([]LeaderboardRow, error) {
	rows, err := s.q.WeeklyLeaderboard(ctx, sqlc.WeeklyLeaderboardParams{KickoffUtc: from, KickoffUtc_2: to})
	if err != nil {
		return nil, fmt.Errorf("store: weekly leaderboard: %w", err)
	}
	out := make([]LeaderboardRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, LeaderboardRow{UserID: r.UserID, Name: r.Name, AvatarURL: r.AvatarUrl, Points: r.Points, Exact: r.ExactCount, Correct: r.CorrectCount})
	}
	return out, nil
}

func (s *SQLStore) OverallLeaderboard(ctx context.Context) ([]LeaderboardRow, error) {
	rows, err := s.q.OverallLeaderboard(ctx)
	if err != nil {
		return nil, fmt.Errorf("store: overall leaderboard: %w", err)
	}
	out := make([]LeaderboardRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, LeaderboardRow{UserID: r.UserID, Name: r.Name, AvatarURL: r.AvatarUrl, Points: r.Points, Exact: r.ExactCount, Correct: r.CorrectCount})
	}
	return out, nil
}

func (s *SQLStore) ListWeeklyResults(ctx context.Context, weekStart time.Time) ([]WeeklyResult, error) {
	rows, err := s.q.ListWeeklyResults(ctx, weekStart)
	if err != nil {
		return nil, fmt.Errorf("store: list weekly results: %w", err)
	}
	out := make([]WeeklyResult, 0, len(rows))
	for _, r := range rows {
		out = append(out, WeeklyResult{UserID: r.UserID, Points: r.Points, IsWinner: r.IsWinner})
	}
	return out, nil
}

func (s *SQLStore) UpsertWeeklyResult(ctx context.Context, p UpsertWeeklyResultParams) error {
	if err := s.q.UpsertWeeklyResult(ctx, sqlc.UpsertWeeklyResultParams{
		UserID: p.UserID, WeekStart: p.WeekStart, Points: p.Points, IsWinner: p.IsWinner,
	}); err != nil {
		return fmt.Errorf("store: upsert weekly result: %w", err)
	}
	return nil
}
```

- [ ] **Step 2: Build + existing tests**

Run: `cd backend && go build ./... && go test ./...`
Expected: builds; all green. Fix any sqlc field-name mismatches from Task 1 Step 5.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/store/leaderboard.go
git commit -m "feat(store): LeaderboardStore (weekly/overall SUMs + weekly_results)"
```

---

### Task 3: Pure ranking package (TDD)

**Files:**
- Create: `backend/internal/leaderboard/rank.go`, `backend/internal/leaderboard/rank_test.go`

- [ ] **Step 1: Write the failing test `backend/internal/leaderboard/rank_test.go`**

```go
package leaderboard

import "testing"

func rows(points ...int64) []Row {
	out := make([]Row, len(points))
	for i, p := range points {
		out[i] = Row{UserID: int64(i + 1), Points: p}
	}
	return out
}

func TestRankWeeklyTiesShareRank(t *testing.T) {
	// pre-ordered by points desc; equal points = co-winners share rank.
	r := Rank(rows(10, 10, 7, 5, 5), WeeklySameRank)
	want := []int{1, 1, 3, 4, 4}
	for i := range r {
		if r[i].Rank != want[i] {
			t.Errorf("row %d rank = %d, want %d", i, r[i].Rank, want[i])
		}
	}
}

func TestRankOverallCascadeBreaksTotalTie(t *testing.T) {
	// equal points, different exact counts → distinct ranks (no shared rank).
	in := []Row{
		{UserID: 1, Points: 10, Exact: 2, Correct: 0},
		{UserID: 2, Points: 10, Exact: 1, Correct: 1},
		{UserID: 3, Points: 10, Exact: 1, Correct: 1}, // fully tied with #2 → shares its rank
	}
	r := Rank(in, OverallSameRank)
	if r[0].Rank != 1 || r[1].Rank != 2 || r[2].Rank != 2 {
		t.Fatalf("ranks = %d,%d,%d; want 1,2,2", r[0].Rank, r[1].Rank, r[2].Rank)
	}
}

func TestPage(t *testing.T) {
	r := Rank(rows(9, 8, 7, 6, 5), WeeklySameRank) // 5 rows
	pg, total := Page(r, 2, 2)
	if total != 5 || len(pg) != 2 || pg[0].Rank != 3 || pg[1].Rank != 4 {
		t.Fatalf("page = %+v total=%d", pg, total)
	}
	// out-of-range page → empty slice, real total.
	pg2, total2 := Page(r, 9, 2)
	if total2 != 5 || len(pg2) != 0 {
		t.Fatalf("oob page = %+v total=%d", pg2, total2)
	}
}

func TestFind(t *testing.T) {
	r := Rank(rows(9, 8, 7), WeeklySameRank) // user ids 1,2,3
	got, ok := Find(r, 3)
	if !ok || got.Rank != 3 || got.Points != 7 {
		t.Fatalf("find = %+v ok=%v", got, ok)
	}
	if _, ok := Find(r, 99); ok {
		t.Fatal("expected not found for unknown user")
	}
}
```

- [ ] **Step 2: Run — confirm RED**

Run: `cd backend && go test ./internal/leaderboard/`
Expected: FAIL — package/types/functions undefined.

- [ ] **Step 3: Create `backend/internal/leaderboard/rank.go`**

```go
// Package leaderboard holds pure ranking + pagination for the leaderboards.
// It has no I/O; the handler maps store rows in and DTOs out.
package leaderboard

// Row is one user's standing (pre-ordered by the SQL query: the §5.1 cascade).
type Row struct {
	UserID    int64
	Name      string
	AvatarURL string
	Points    int64
	Exact     int64
	Correct   int64
	IsWinner  bool
}

// Ranked is a Row with its computed 1-based rank.
type Ranked struct {
	Row
	Rank int
}

// WeeklySameRank: co-winners share a rank on equal total points (§3.5).
func WeeklySameRank(a, b Row) bool { return a.Points == b.Points }

// OverallSameRank: §5.1 — same rank only when total, exact, and correct all tie
// (the bonus tier is 0 until M7).
func OverallSameRank(a, b Row) bool {
	return a.Points == b.Points && a.Exact == b.Exact && a.Correct == b.Correct
}

// Rank assigns 1-based competition ranks to PRE-ORDERED rows (e.g. 1,1,3).
func Rank(rows []Row, sameRank func(a, b Row) bool) []Ranked {
	out := make([]Ranked, len(rows))
	rank := 0
	for i, r := range rows {
		if i == 0 || !sameRank(rows[i-1], r) {
			rank = i + 1
		}
		out[i] = Ranked{Row: r, Rank: rank}
	}
	return out
}

// Page returns the 1-based page slice of size pageSize, plus the total count.
func Page(rows []Ranked, page, pageSize int) ([]Ranked, int) {
	total := len(rows)
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	start := (page - 1) * pageSize
	if start >= total {
		return []Ranked{}, total
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	return rows[start:end], total
}

// Find returns the ranked row for userID (and true) if present.
func Find(rows []Ranked, userID int64) (Ranked, bool) {
	for _, r := range rows {
		if r.UserID == userID {
			return r, true
		}
	}
	return Ranked{}, false
}
```

- [ ] **Step 4: Run — GREEN**

Run: `cd backend && go test ./internal/leaderboard/ -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/leaderboard/
git commit -m "feat(leaderboard): pure ranking, pagination, find (weekly + §5.1 overall)"
```

---

### Task 4: GET /api/leaderboard handler (TDD)

**Files:**
- Create: `backend/internal/httpapi/leaderboard_handler.go`, `backend/internal/httpapi/leaderboard_test.go`
- Modify: `backend/internal/httpapi/middleware.go` (add `Leaderboard` to `Deps`)
- Modify: `backend/internal/httpapi/router.go` (register the route)

- [ ] **Step 1: Add `Leaderboard` to `Deps` in `middleware.go`** (after `Predictions`)

```go
	Leaderboard        store.LeaderboardStore
```

- [ ] **Step 2: Write the failing test `backend/internal/httpapi/leaderboard_test.go`**

```go
package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/auth"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

type fakeLeaderboardStore struct {
	weekly      []store.LeaderboardRow
	overall     []store.LeaderboardRow
	weeklyRes   []store.WeeklyResult
	gotFrom     time.Time
	gotTo       time.Time
}

func (f *fakeLeaderboardStore) WeeklyLeaderboard(_ context.Context, from, to time.Time) ([]store.LeaderboardRow, error) {
	f.gotFrom, f.gotTo = from, to
	return f.weekly, nil
}
func (f *fakeLeaderboardStore) OverallLeaderboard(context.Context) ([]store.LeaderboardRow, error) {
	return f.overall, nil
}
func (f *fakeLeaderboardStore) ListWeeklyResults(context.Context, time.Time) ([]store.WeeklyResult, error) {
	return f.weeklyRes, nil
}
func (f *fakeLeaderboardStore) UpsertWeeklyResult(context.Context, store.UpsertWeeklyResultParams) error {
	return nil
}

func lbDeps(t *testing.T, ls store.LeaderboardStore) (*Deps, *http.Cookie, int64) {
	t.Helper()
	fs := newFakeStore()
	u, _ := fs.UpsertUser(context.Background(), store.UpsertUserParams{Email: "dev@sayonetech.com"})
	sm := auth.NewSessionManager("test-secret")
	d := &Deps{Store: fs, Sessions: sm, Leaderboard: ls}
	return d, &http.Cookie{Name: sessionCookieName, Value: sm.Encode(auth.Session{UserID: u.ID}, time.Hour)}, u.ID
}

func getLB(t *testing.T, d *Deps, cookie *http.Cookie, query string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/leaderboard"+query, nil)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	NewRouter(d, false).ServeHTTP(rec, req)
	return rec
}

func TestLeaderboardRequiresAuth(t *testing.T) {
	d, _, _ := lbDeps(t, &fakeLeaderboardStore{})
	if rec := getLB(t, d, nil, "?period=overall"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestLeaderboardOverallRanksAndMarksMe(t *testing.T) {
	ls := &fakeLeaderboardStore{overall: []store.LeaderboardRow{
		{UserID: 5, Name: "Aaa", Points: 18, Exact: 3, Correct: 1},
		{UserID: 1, Name: "Dev", Points: 18, Exact: 2, Correct: 2}, // same total, fewer exact → rank 2
		{UserID: 9, Name: "Bbb", Points: 7, Exact: 1, Correct: 0},
	}}
	d, cookie, myID := lbDeps(t, ls) // myID == 1
	rec := getLB(t, d, cookie, "?period=overall")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
	var resp leaderboardResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Period != "overall" || resp.Total != 3 {
		t.Fatalf("resp = %+v", resp)
	}
	if resp.Rows[0].Rank != 1 || resp.Rows[0].UserID != 5 || resp.Rows[1].Rank != 2 || resp.Rows[1].UserID != 1 {
		t.Fatalf("ranks = %+v", resp.Rows)
	}
	if !resp.Rows[1].IsMe || resp.Me == nil || resp.Me.Rank != 2 || resp.Me.Points != 18 {
		t.Fatalf("me handling = row %+v me %+v", resp.Rows[1], resp.Me)
	}
	_ = myID
}

func TestLeaderboardWeeklyWindowAndWinner(t *testing.T) {
	// week=2026-06-15 (a Monday). Window must be [Mon 00:00 IST, next Mon 00:00 IST) in UTC,
	// i.e. 2026-06-14T18:30:00Z .. 2026-06-21T18:30:00Z.
	ls := &fakeLeaderboardStore{
		weekly:    []store.LeaderboardRow{{UserID: 1, Name: "Dev", Points: 8, Exact: 1, Correct: 1}},
		weeklyRes: []store.WeeklyResult{{UserID: 1, Points: 8, IsWinner: true}},
	}
	d, cookie, _ := lbDeps(t, ls)
	rec := getLB(t, d, cookie, "?period=week&week=2026-06-15")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
	wantFrom := time.Date(2026, 6, 14, 18, 30, 0, 0, time.UTC)
	wantTo := time.Date(2026, 6, 21, 18, 30, 0, 0, time.UTC)
	if !ls.gotFrom.Equal(wantFrom) || !ls.gotTo.Equal(wantTo) {
		t.Fatalf("window = [%s, %s); want [%s, %s)", ls.gotFrom, ls.gotTo, wantFrom, wantTo)
	}
	var resp leaderboardResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Week != "2026-06-15" || len(resp.Rows) != 1 || !resp.Rows[0].IsWinner {
		t.Fatalf("weekly resp = %+v", resp)
	}
}

func TestLeaderboardBadParams(t *testing.T) {
	d, cookie, _ := lbDeps(t, &fakeLeaderboardStore{})
	for _, q := range []string{"?period=nope", "?period=week&week=bad-date"} {
		if rec := getLB(t, d, cookie, q); rec.Code != http.StatusBadRequest {
			t.Fatalf("query %s: status = %d, want 400", q, rec.Code)
		}
	}
}
```

- [ ] **Step 3: Run — confirm RED**

Run: `cd backend && go test ./internal/httpapi/ -run TestLeaderboard`
Expected: FAIL — `leaderboardResponse`/handler undefined.

- [ ] **Step 4: Create `backend/internal/httpapi/leaderboard_handler.go`**

```go
package httpapi

import (
	"net/http"
	"strconv"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/leaderboard"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

const leaderboardPageSize = 20

type leaderboardRowDTO struct {
	Rank      int    `json:"rank"`
	UserID    int64  `json:"user_id"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	Points    int64  `json:"points"`
	Exact     int64  `json:"exact"`
	Correct   int64  `json:"correct"`
	IsWinner  bool   `json:"is_winner"`
	IsMe      bool   `json:"is_me"`
}

type meRankDTO struct {
	Rank   int   `json:"rank"`
	Points int64 `json:"points"`
}

type leaderboardResponse struct {
	Period   string              `json:"period"`
	Week     string              `json:"week,omitempty"`
	Page     int                 `json:"page"`
	PageSize int                 `json:"page_size"`
	Total    int                 `json:"total"`
	Rows     []leaderboardRowDTO `json:"rows"`
	Me       *meRankDTO          `json:"me"`
}

// istMonday returns the 00:00-IST Monday of the IST week containing the given
// IST instant (an IST-zoned time.Time).
func istMonday(istTime time.Time) time.Time {
	y, m, d := istTime.Date()
	day := time.Date(y, m, d, 0, 0, 0, 0, ist) // midnight IST of that calendar day
	// Go: Monday=1 … Sunday=7 via ((Weekday()+6)%7)
	offset := (int(day.Weekday()) + 6) % 7
	return day.AddDate(0, 0, -offset)
}

// weekStartKey is the IST-Monday CALENDAR date as a midnight-UTC time, used as the
// weekly_results.week_start DATE key. (NOT istMon.UTC(), which is the prior UTC day
// at 18:30 and would store/compare against the wrong DATE.)
func weekStartKey(istMon time.Time) time.Time {
	y, m, d := istMon.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// GetLeaderboard serves the weekly or overall leaderboard (auth required).
func (d *Deps) GetLeaderboard(w http.ResponseWriter, r *http.Request) {
	u, ok := userFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	period := r.URL.Query().Get("period")
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}

	var (
		rows     []store.LeaderboardRow
		sameRank func(a, b leaderboard.Row) bool
		weekLbl  string
		winners  map[int64]bool
		err      error
	)

	switch period {
	case "overall":
		rows, err = d.Leaderboard.OverallLeaderboard(r.Context())
		sameRank = leaderboard.OverallSameRank
	case "week":
		var weekMonIST time.Time
		if wp := r.URL.Query().Get("week"); wp != "" {
			parsed, perr := time.ParseInLocation("2006-01-02", wp, ist)
			if perr != nil {
				writeError(w, http.StatusBadRequest, "week must be YYYY-MM-DD")
				return
			}
			weekMonIST = istMonday(parsed)
		} else {
			weekMonIST = istMonday(now().In(ist))
		}
		from := weekMonIST.UTC()
		to := weekMonIST.AddDate(0, 0, 7).UTC()
		weekLbl = weekMonIST.Format("2006-01-02")
		rows, err = d.Leaderboard.WeeklyLeaderboard(r.Context(), from, to)
		sameRank = leaderboard.WeeklySameRank
		if err == nil {
			wr, werr := d.Leaderboard.ListWeeklyResults(r.Context(), weekStartKey(weekMonIST))
			if werr != nil {
				writeError(w, http.StatusInternalServerError, "could not load weekly winners")
				return
			}
			winners = make(map[int64]bool, len(wr))
			for _, x := range wr {
				if x.IsWinner {
					winners[x.UserID] = true
				}
			}
		}
	default:
		writeError(w, http.StatusBadRequest, "period must be week or overall")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load leaderboard")
		return
	}

	lrows := make([]leaderboard.Row, len(rows))
	for i, r := range rows {
		lrows[i] = leaderboard.Row{
			UserID: r.UserID, Name: r.Name, AvatarURL: r.AvatarURL,
			Points: r.Points, Exact: r.Exact, Correct: r.Correct,
			IsWinner: winners[r.UserID],
		}
	}
	ranked := leaderboard.Rank(lrows, sameRank)
	mine, hasMe := leaderboard.Find(ranked, u.ID)
	pageRows, total := leaderboard.Page(ranked, page, leaderboardPageSize)

	dto := leaderboardResponse{
		Period: period, Week: weekLbl, Page: page, PageSize: leaderboardPageSize, Total: total,
		Rows: make([]leaderboardRowDTO, 0, len(pageRows)),
	}
	for _, rr := range pageRows {
		dto.Rows = append(dto.Rows, leaderboardRowDTO{
			Rank: rr.Rank, UserID: rr.UserID, Name: rr.Name, AvatarURL: rr.AvatarURL,
			Points: rr.Points, Exact: rr.Exact, Correct: rr.Correct,
			IsWinner: rr.IsWinner, IsMe: rr.UserID == u.ID,
		})
	}
	if hasMe {
		dto.Me = &meRankDTO{Rank: mine.Rank, Points: mine.Points}
	}
	writeJSON(w, http.StatusOK, dto)
}
```

- [ ] **Step 5: Register the route in `router.go`** (inside the `priv` group, after `/matches`)

```go
			priv.Get("/leaderboard", d.GetLeaderboard)
```

- [ ] **Step 6: Run — GREEN**

Run: `cd backend && go test ./internal/httpapi/ -run TestLeaderboard -v && go test ./internal/httpapi/`
Expected: all `TestLeaderboard*` pass; whole package green. (The window test pins IST = UTC+5:30: Mon 2026-06-15 00:00 IST = 2026-06-14 18:30 UTC.)

- [ ] **Step 7: Commit**

```bash
git add backend/internal/httpapi/leaderboard_handler.go backend/internal/httpapi/leaderboard_test.go backend/internal/httpapi/middleware.go backend/internal/httpapi/router.go
git commit -m "feat(api): GET /api/leaderboard (weekly window + overall §5.1, paginated + me)"
```

---

### Task 5: weekly-winner job (TDD)

**Files:**
- Create: `backend/internal/jobs/weekly_winner.go`, `backend/internal/jobs/weekly_winner_test.go`

- [ ] **Step 1: Write the failing test `backend/internal/jobs/weekly_winner_test.go`**

```go
package jobs

import (
	"context"
	"testing"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

type fakeWeeklyStore struct {
	weekly  []store.LeaderboardRow
	gotFrom time.Time
	gotTo   time.Time
	upserts []store.UpsertWeeklyResultParams
}

func (f *fakeWeeklyStore) WeeklyLeaderboard(_ context.Context, from, to time.Time) ([]store.LeaderboardRow, error) {
	f.gotFrom, f.gotTo = from, to
	return f.weekly, nil
}
func (f *fakeWeeklyStore) OverallLeaderboard(context.Context) ([]store.LeaderboardRow, error) {
	return nil, nil
}
func (f *fakeWeeklyStore) ListWeeklyResults(context.Context, time.Time) ([]store.WeeklyResult, error) {
	return nil, nil
}
func (f *fakeWeeklyStore) UpsertWeeklyResult(_ context.Context, p store.UpsertWeeklyResultParams) error {
	f.upserts = append(f.upserts, p)
	return nil
}

func TestWeeklyWinnerComputesPreviousWeekAndCoWinners(t *testing.T) {
	// now = Mon 2026-06-22 13:30 IST → previous week starts Mon 2026-06-15 00:00 IST.
	now := time.Date(2026, 6, 22, 8, 0, 0, 0, time.UTC) // 13:30 IST
	fs := &fakeWeeklyStore{weekly: []store.LeaderboardRow{
		{UserID: 1, Points: 12}, {UserID: 2, Points: 12}, {UserID: 3, Points: 5},
	}}
	job := WeeklyWinner{Store: fs, Now: func() time.Time { return now }}

	sum, err := job.Run(context.Background())
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	// window = [2026-06-15 00:00 IST, 2026-06-22 00:00 IST) = UTC 06-14T18:30 .. 06-21T18:30
	if !fs.gotFrom.Equal(time.Date(2026, 6, 14, 18, 30, 0, 0, time.UTC)) ||
		!fs.gotTo.Equal(time.Date(2026, 6, 21, 18, 30, 0, 0, time.UTC)) {
		t.Fatalf("window = [%s, %s)", fs.gotFrom, fs.gotTo)
	}
	// week_start stored as the IST Monday CALENDAR date at midnight UTC (the DATE key).
	wantWeek := time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC)
	winners := map[int64]bool{}
	for _, u := range fs.upserts {
		if !u.WeekStart.Equal(wantWeek) {
			t.Fatalf("week_start = %s, want %s", u.WeekStart, wantWeek)
		}
		winners[u.UserID] = u.IsWinner
	}
	if len(fs.upserts) != 3 || !winners[1] || !winners[2] || winners[3] {
		t.Fatalf("co-winners wrong: %+v", winners)
	}
	if sum.WeekStart != "2026-06-15" || sum.Winners != 2 || sum.Participants != 3 {
		t.Fatalf("summary = %+v", sum)
	}
}

func TestWeeklyWinnerNoWinnerWhenAllZero(t *testing.T) {
	now := time.Date(2026, 6, 22, 8, 0, 0, 0, time.UTC)
	fs := &fakeWeeklyStore{weekly: []store.LeaderboardRow{{UserID: 1, Points: 0}, {UserID: 2, Points: 0}}}
	job := WeeklyWinner{Store: fs, Now: func() time.Time { return now }}
	sum, _ := job.Run(context.Background())
	for _, u := range fs.upserts {
		if u.IsWinner {
			t.Fatalf("no winner expected when top total is 0: %+v", u)
		}
	}
	if sum.Winners != 0 {
		t.Fatalf("winners = %d, want 0", sum.Winners)
	}
}

func TestWeeklyWinnerIdempotent(t *testing.T) {
	now := time.Date(2026, 6, 22, 8, 0, 0, 0, time.UTC)
	mk := func() *fakeWeeklyStore {
		return &fakeWeeklyStore{weekly: []store.LeaderboardRow{{UserID: 1, Points: 9}, {UserID: 2, Points: 4}}}
	}
	fs := mk()
	job := WeeklyWinner{Store: fs, Now: func() time.Time { return now }}
	_, _ = job.Run(context.Background())
	first := append([]store.UpsertWeeklyResultParams(nil), fs.upserts...)
	fs.upserts = nil
	_, _ = job.Run(context.Background())
	if len(fs.upserts) != len(first) {
		t.Fatalf("upsert count changed: %d vs %d", len(fs.upserts), len(first))
	}
	for i := range first {
		if fs.upserts[i] != first[i] {
			t.Fatalf("not idempotent at %d: %+v vs %+v", i, fs.upserts[i], first[i])
		}
	}
}
```

- [ ] **Step 2: Run — confirm RED**

Run: `cd backend && go test ./internal/jobs/ -run TestWeeklyWinner`
Expected: FAIL — `WeeklyWinner` undefined.

- [ ] **Step 3: Create `backend/internal/jobs/weekly_winner.go`**

```go
package jobs

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

var istLoc = mustIST()

func mustIST() *time.Location {
	loc, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		return time.FixedZone("IST", 5*3600+1800)
	}
	return loc
}

// WeeklyWinner materializes the previous completed IST week into weekly_results
// and marks co-winners. Idempotent: it SETs each row (never increments).
type WeeklyWinner struct {
	Store store.LeaderboardStore
	Now   func() time.Time
}

// Summary is the run report (logged).
type WeeklySummary struct {
	WeekStart    string
	Participants int
	Winners      int
}

// Run computes the previous IST week's standings and upserts weekly_results.
func (j WeeklyWinner) Run(ctx context.Context) (WeeklySummary, error) {
	nowIST := j.Now().In(istLoc)
	y, m, d := nowIST.Date()
	today := time.Date(y, m, d, 0, 0, 0, 0, istLoc)
	offset := (int(today.Weekday()) + 6) % 7 // Monday=0
	thisMonday := today.AddDate(0, 0, -offset)
	weekStart := thisMonday.AddDate(0, 0, -7) // previous week's Monday (IST)

	from := weekStart.UTC()      // window start instant (IST Mon 00:00 → e.g. …18:30Z)
	to := thisMonday.UTC()       // window end instant (exclusive)
	wy, wm, wd := weekStart.Date()
	weekStartDate := time.Date(wy, wm, wd, 0, 0, 0, 0, time.UTC) // IST calendar Monday as the DATE key
	rows, err := j.Store.WeeklyLeaderboard(ctx, from, to)
	if err != nil {
		return WeeklySummary{}, fmt.Errorf("jobs: weekly leaderboard: %w", err)
	}

	var top int64
	for _, r := range rows {
		if r.Points > top {
			top = r.Points
		}
	}

	winners := 0
	for _, r := range rows {
		isWinner := top > 0 && r.Points == top
		if isWinner {
			winners++
		}
		if err := j.Store.UpsertWeeklyResult(ctx, store.UpsertWeeklyResultParams{
			UserID: r.UserID, WeekStart: weekStartDate, Points: int32(r.Points), IsWinner: isWinner,
		}); err != nil {
			return WeeklySummary{}, fmt.Errorf("jobs: upsert weekly result: %w", err)
		}
	}

	sum := WeeklySummary{WeekStart: weekStart.Format("2006-01-02"), Participants: len(rows), Winners: winners}
	slog.Info("weekly-winner complete", "week_start", sum.WeekStart, "participants", sum.Participants, "winners", sum.Winners)
	return sum, nil
}
```

> Note: two distinct values are derived from the IST Monday. The **window** (`from`/`to`) uses the
> IST-midnight *instants* in UTC (e.g. `…18:30Z`) to filter `kickoff_utc`. The **`week_start` DATE key**
> uses the IST calendar date at midnight UTC (`weekStartDate` = `2026-06-15 00:00 UTC` → DATE
> `2026-06-15`). The handler computes the identical key via `weekStartKey(weekMonIST)`, so
> `ListWeeklyResults` matches exactly what the job wrote (DATE = DATE). Do NOT use `weekStart.UTC()`
> as the key — its date is the prior UTC day.

- [ ] **Step 4: Run — GREEN**

Run: `cd backend && go test ./internal/jobs/ -run TestWeeklyWinner -v && go test ./internal/jobs/`
Expected: all pass (incl. the existing results-ingest tests).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/jobs/weekly_winner.go backend/internal/jobs/weekly_winner_test.go
git commit -m "feat(jobs): weekly-winner — previous IST week, co-winners, idempotent"
```

---

### Task 6: Config + scheduler + trigger wiring

**Files:**
- Modify: `backend/internal/config/config.go` (add `WeeklyCron`)
- Modify: `backend/internal/httpapi/middleware.go` (extend `JobRunner`)
- Modify: `backend/internal/httpapi/admin_jobs_handler.go` (`weekly-winner` case)
- Modify: `backend/cmd/server/main.go` (weekly cron + `serverJobs` runner + wire `Leaderboard`)
- Modify: `.env.example`, `backend/.env`

- [ ] **Step 1: Add `WeeklyCron` to `config.go`**

In the `Config` struct (after `ResultsCron`):

```go
	WeeklyCron          string
```

In `Load()` (after the `ResultsCron:` line):

```go
		WeeklyCron:          getenv("WEEKLY_CRON", "30 13 * * 1"),
```

- [ ] **Step 2: Extend the `JobRunner` interface in `middleware.go`**

```go
type JobRunner interface {
	RunResultsIngest(ctx context.Context) (any, error)
	RunWeeklyWinner(ctx context.Context) (any, error)
}
```

- [ ] **Step 3: Add the `weekly-winner` case in `admin_jobs_handler.go`**

After the `results-ingest` case, before `default`:

```go
	case "weekly-winner":
		if d.JobRunner == nil {
			writeError(w, http.StatusServiceUnavailable, "job runner not configured")
			return
		}
		summary, err := d.JobRunner.RunWeeklyWinner(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "job failed: "+err.Error())
			return
		}
		writeJSON(w, http.StatusOK, summary)
```

Update the handler doc comment to drop "weekly-winner arrives in M6".

- [ ] **Step 4: Update `cmd/server/main.go` — `serverJobs` runner + weekly cron + wire Leaderboard**

Replace the existing `ingestRunner` type + its method with a `serverJobs` that implements both `JobRunner` methods:

```go
// serverJobs adapts the background jobs to httpapi.JobRunner. ingest is nil when
// no results API key is configured; weekly-winner always works (no external API).
type serverJobs struct {
	ingest *jobs.ResultsIngest
	weekly jobs.WeeklyWinner
}

func (s serverJobs) RunResultsIngest(ctx context.Context) (any, error) {
	if s.ingest == nil {
		return nil, errors.New("results ingest not configured (no FOOTBALL_DATA_API_KEY)")
	}
	return s.ingest.Run(ctx)
}

func (s serverJobs) RunWeeklyWinner(ctx context.Context) (any, error) {
	return s.weekly.Run(ctx)
}
```

Replace the `var jobRunner httpapi.JobRunner` block with construction of `serverJobs` (weekly always; ingest if key) and wire it + `Leaderboard`:

```go
	weekly := jobs.WeeklyWinner{Store: st, Now: func() time.Time { return time.Now().UTC() }}
	sj := serverJobs{weekly: weekly}
	if cfg.FootballDataAPIKey != "" {
		if alias, err := loadAliasFile(cfg.SeedDataDir + "/fd_team_aliases.csv"); err == nil {
			ingest := jobs.ResultsIngest{
				API:   sportsapi.New(cfg.FootballDataBaseURL, cfg.FootballDataAPIKey),
				Store: st,
				Now:   func() time.Time { return time.Now().UTC() },
				Alias: alias,
			}
			sj.ingest = &ingest
		} else {
			logger.Warn("results ingest trigger disabled: alias load", "err", err)
		}
	}
	var jobRunner httpapi.JobRunner = sj
```

In the `httpapi.Deps{...}` literal add `Leaderboard: st,` (next to `Predictions: st,`). The `JobRunner: jobRunner,` line stays. (`JobRunner` is now always non-nil; in production the trigger route still isn't registered, so this only matters for non-prod debug.)

Add the weekly cron alongside the results cron — after `scheduler := startResultsCron(...)` and its `defer`:

```go
	weeklyScheduler := startWeeklyCron(cfg, weekly, logger)
	if weeklyScheduler != nil {
		defer weeklyScheduler.Stop()
	}
```

Add `startWeeklyCron` near `startResultsCron`:

```go
// startWeeklyCron schedules the weekly-winner job on WEEKLY_CRON (IST). It needs
// no external API, so it always runs.
func startWeeklyCron(cfg config.Config, job jobs.WeeklyWinner, logger *slog.Logger) *cron.Cron {
	loc, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		loc = time.FixedZone("IST", 5*3600+1800)
	}
	c := cron.New(cron.WithLocation(loc))
	if _, err := c.AddFunc(cfg.WeeklyCron, func() {
		if _, err := job.Run(context.Background()); err != nil {
			logger.Error("weekly-winner run", "err", err)
		}
	}); err != nil {
		logger.Error("weekly-winner disabled: bad WEEKLY_CRON", "spec", cfg.WeeklyCron, "err", err)
		return nil
	}
	c.Start()
	logger.Info("weekly-winner scheduled", "cron", cfg.WeeklyCron, "tz", loc.String())
	return c
}
```

Ensure `"errors"` is imported in `main.go` (it already is, from the ListenAndServe check).

- [ ] **Step 5: Add `WEEKLY_CRON` to `.env.example` and `backend/.env`**

In both, under the results vars:

```
WEEKLY_CRON="30 13 * * 1"
```

- [ ] **Step 6: Build + full suite + vet**

Run: `cd backend && go vet ./... && go build ./... && go test ./...`
Expected: builds; all green (the M5 `TestRunJob*` still pass — `weekly-winner` now returns 200 with an admin runner; update that test only if it asserted 400 for weekly-winner — the M5 `TestRunJobUnknownJob400` used `weekly-winner` as an "unknown job": **change that test** to use only `{"job":"nope"}`, since weekly-winner is now valid).

- [ ] **Step 7: Fix the M5 trigger test that treated weekly-winner as unknown**

In `backend/internal/httpapi/admin_jobs_test.go`, `TestRunJobUnknownJob400` iterates `{"job":"weekly-winner"}` and `{"job":"nope"}`. Remove the `weekly-winner` entry (it's now a real job). Add a positive case if desired:

```go
func TestRunJobWeeklyWinner(t *testing.T) {
	d, cookie, jr := adminJobsDeps(t, store.RoleAdmin)
	rec := postJob(t, d, true, cookie, `{"job":"weekly-winner"}`)
	if rec.Code != http.StatusOK || jr.called == 0 {
		t.Fatalf("status=%d called=%d", rec.Code, jr.called)
	}
}
```

And extend `fakeJobRunner` (in that test file) with `RunWeeklyWinner`:

```go
func (f *fakeJobRunner) RunWeeklyWinner(context.Context) (any, error) {
	f.called++
	return map[string]int{"winners": 1}, nil
}
```

Run: `cd backend && go test ./internal/httpapi/ -count=1`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add backend/internal/config/config.go backend/internal/httpapi/middleware.go backend/internal/httpapi/admin_jobs_handler.go backend/internal/httpapi/admin_jobs_test.go backend/cmd/server/main.go .env.example backend/.env
git commit -m "feat(server): weekly-winner cron + trigger; wire leaderboard store"
```

> `backend/.env` is gitignored — it won't actually stage; that's fine (local only).

---

### Task 7: Frontend — leaderboard on the landing screen (impeccable + TDD)

**Files:**
- Create: `frontend/src/lib/leaderboard.ts`, `frontend/src/components/LeaderboardPanel.tsx`, `frontend/src/components/LeaderboardPanel.test.tsx`, `frontend/src/routes/Home.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/styles/tokens.css`

> Use the **`impeccable`** skill for the layout + panel against §7. The code below is a complete, test-passing baseline; impeccable refines visuals without changing the roles/labels the tests assert.

- [ ] **Step 1: Create `frontend/src/lib/leaderboard.ts`**

```ts
import { useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

export type LeaderboardRow = {
  rank: number;
  user_id: number;
  name: string;
  avatar_url: string;
  points: number;
  exact: number;
  correct: number;
  is_winner: boolean;
  is_me: boolean;
};

export type LeaderboardResponse = {
  period: "week" | "overall";
  week?: string;
  page: number;
  page_size: number;
  total: number;
  rows: LeaderboardRow[];
  me: { rank: number; points: number } | null;
};

export async function getLeaderboard(
  period: "week" | "overall",
  page = 1,
): Promise<LeaderboardResponse> {
  const res = await fetch(`${BASE}/leaderboard?period=${period}&page=${page}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`leaderboard failed: ${res.status}`);
  return res.json() as Promise<LeaderboardResponse>;
}

export function useLeaderboard(period: "week" | "overall", page = 1) {
  return useQuery({
    queryKey: ["leaderboard", period, page],
    queryFn: () => getLeaderboard(period, page),
  });
}
```

- [ ] **Step 2: Write the failing test `frontend/src/components/LeaderboardPanel.test.tsx`**

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LeaderboardPanel } from "./LeaderboardPanel";

function renderPanel() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <LeaderboardPanel />
    </QueryClientProvider>,
  );
}

const overall = {
  period: "overall", page: 1, page_size: 20, total: 2,
  rows: [
    { rank: 1, user_id: 5, name: "Aaa", avatar_url: "", points: 18, exact: 3, correct: 1, is_winner: false, is_me: false },
    { rank: 2, user_id: 1, name: "Me", avatar_url: "", points: 12, exact: 1, correct: 3, is_winner: false, is_me: true },
  ],
  me: { rank: 2, points: 12 },
};

afterEach(() => vi.restoreAllMocks());

describe("LeaderboardPanel", () => {
  it("renders ranked rows and highlights the current user", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => overall }));
    renderPanel();
    await screen.findByText("Aaa");
    const meRow = screen.getByText("Me").closest("[data-me]");
    expect(meRow).not.toBeNull();
    expect(screen.getByText("18")).toBeInTheDocument();
  });

  it("switches to Weekly when the toggle is clicked", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => overall });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Aaa");
    await user.click(screen.getByRole("button", { name: /weekly/i }));
    await waitFor(() => {
      const calledWeek = fetchMock.mock.calls.some(([url]) => String(url).includes("period=week"));
      expect(calledWeek).toBe(true);
    });
  });
});
```

- [ ] **Step 3: Run — confirm RED**

Run: `cd frontend && pnpm test src/components/LeaderboardPanel.test.tsx`
Expected: FAIL — `LeaderboardPanel` not found.

- [ ] **Step 4: Create `frontend/src/components/LeaderboardPanel.tsx`**

```tsx
import { useState } from "react";
import { useLeaderboard } from "../lib/leaderboard";

type Period = "week" | "overall";

export function LeaderboardPanel() {
  const [period, setPeriod] = useState<Period>("overall");
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useLeaderboard(period, page);

  const swap = (p: Period) => {
    setPeriod(p);
    setPage(1);
  };

  return (
    <section className="lb" aria-label="Leaderboard">
      <div className="lb__tabs" role="tablist" aria-label="Leaderboard period">
        <button type="button" role="tab" aria-selected={period === "overall"}
          className={`lb__tab ${period === "overall" ? "is-active" : ""}`} onClick={() => swap("overall")}>
          Overall
        </button>
        <button type="button" role="tab" aria-selected={period === "week"}
          className={`lb__tab ${period === "week" ? "is-active" : ""}`} onClick={() => swap("week")}>
          Weekly
        </button>
      </div>

      {isLoading ? (
        <div className="lb__skeleton" aria-hidden="true">
          <div className="skeleton skeleton--text" /><div className="skeleton skeleton--text" /><div className="skeleton skeleton--text" />
        </div>
      ) : isError ? (
        <p className="lb__empty" role="alert">Couldn't load the leaderboard.</p>
      ) : !data || data.rows.length === 0 ? (
        <p className="lb__empty">No ranked players yet — points appear after matches finish.</p>
      ) : (
        <>
          <ol className="lb__list">
            {data.rows.map((r) => (
              <li key={r.user_id} className={`lb__row ${r.is_me ? "is-me" : ""}`} {...(r.is_me ? { "data-me": "" } : {})}>
                <span className="lb__rank mono">{r.rank}</span>
                <span className="lb__name">
                  {r.name}
                  {r.is_winner ? <span className="lb__badge" aria-label="weekly winner">★</span> : null}
                </span>
                <span className="lb__pts mono" aria-label={`${r.points} points`}>{r.points}</span>
              </li>
            ))}
          </ol>
          {data.me ? (
            <p className="lb__me mono">Your rank: {data.me.rank} · {data.me.points} pts</p>
          ) : null}
          {data.total > data.page_size ? (
            <div className="lb__pager">
              <button type="button" className="btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">‹</button>
              <span className="lb__pageinfo mono">{page} / {Math.ceil(data.total / data.page_size)}</span>
              <button type="button" className="btn-ghost" disabled={page >= Math.ceil(data.total / data.page_size)} onClick={() => setPage((p) => p + 1)} aria-label="Next page">›</button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Run — GREEN**

Run: `cd frontend && pnpm test src/components/LeaderboardPanel.test.tsx`
Expected: 2 passed.

- [ ] **Step 6: Create `frontend/src/routes/Home.tsx`** (responsive landing: fixtures + leaderboard)

```tsx
import { useState } from "react";
import { Fixtures } from "./Fixtures";
import { LeaderboardPanel } from "../components/LeaderboardPanel";

export function Home() {
  const [mobileView, setMobileView] = useState<"fixtures" | "ranks">("fixtures");

  return (
    <div className="home">
      {/* Mobile-only segmented toggle (hidden on desktop via CSS). */}
      <div className="home__toggle" role="tablist" aria-label="View">
        <button type="button" role="tab" aria-selected={mobileView === "fixtures"}
          className={`home__toggle-btn ${mobileView === "fixtures" ? "is-active" : ""}`} onClick={() => setMobileView("fixtures")}>
          Fixtures
        </button>
        <button type="button" role="tab" aria-selected={mobileView === "ranks"}
          className={`home__toggle-btn ${mobileView === "ranks" ? "is-active" : ""}`} onClick={() => setMobileView("ranks")}>
          Ranks
        </button>
      </div>

      <div className="home__grid">
        <div className={`home__main ${mobileView === "ranks" ? "is-hidden-mobile" : ""}`}>
          <Fixtures />
        </div>
        <aside className={`home__aside ${mobileView === "fixtures" ? "is-hidden-mobile" : ""}`}>
          <LeaderboardPanel />
        </aside>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Render `<Home/>` from `App.tsx`**

Replace the `import { Fixtures } from "./routes/Fixtures";` with `import { Home } from "./routes/Home";` and change `<Fixtures />` (inside `app-shell`) to `<Home />`.

- [ ] **Step 8: Add layout + panel styles to `tokens.css` (impeccable)**

Use the `impeccable` skill against §7. Required classes the markup/tests rely on: `.home`, `.home__toggle`, `.home__toggle-btn`, `.home__grid`, `.home__main`, `.home__aside`, `.is-hidden-mobile`, `.lb`, `.lb__tabs`, `.lb__tab`, `.lb__list`, `.lb__row`(`.is-me`), `.lb__rank`, `.lb__name`, `.lb__badge`, `.lb__pts`, `.lb__me`, `.lb__pager`, `.lb__pageinfo`, `.lb__empty`, `.lb__skeleton`. Baseline behavior to honor: desktop (≥1024px) `.home__grid` is two columns (main + sticky aside) and `.home__toggle` is hidden; below 1024px it's one column, the toggle shows, and `.is-hidden-mobile` hides the non-selected pane. Mono numerics, current-user highlight, visible focus rings, skeletons, reduced-motion. Baseline:

```css
.home__toggle { display: flex; gap: var(--space-2); padding: var(--space-3); }
.home__toggle-btn { flex: 1; min-height: 40px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-1); color: var(--ink); }
.home__toggle-btn.is-active { background: var(--brand); color: var(--on-brand); }
.home__grid { display: block; }
.home__aside { padding: var(--space-3); }
.lb__tabs { display: flex; gap: var(--space-2); margin-bottom: var(--space-3); }
.lb__tab { flex: 1; min-height: 36px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-1); color: var(--ink); }
.lb__tab.is-active { background: var(--brand); color: var(--on-brand); }
.lb__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.lb__row { display: grid; grid-template-columns: 2.5ch 1fr auto; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-3); border-radius: var(--radius-md); }
.lb__row.is-me { background: var(--surface-2); outline: 1px solid var(--brand); }
.lb__rank { color: var(--muted); text-align: right; }
.lb__badge { color: var(--brand); margin-left: var(--space-2); }
.lb__pts { font-weight: 600; }
.lb__me { margin-top: var(--space-3); color: var(--muted); font-size: 13px; }
.lb__pager { display: flex; align-items: center; justify-content: center; gap: var(--space-3); margin-top: var(--space-3); }
.lb__empty { color: var(--muted); padding: var(--space-4); text-align: center; }
.lb__skeleton { display: flex; flex-direction: column; gap: var(--space-2); }
@media (min-width: 1024px) {
  .home__toggle { display: none; }
  .home__grid { display: grid; grid-template-columns: 1fr 360px; align-items: start; }
  .home__aside { position: sticky; top: var(--space-4); }
  .is-hidden-mobile { display: block; } /* both panes visible on desktop */
}
@media (max-width: 1023px) {
  .is-hidden-mobile { display: none; }
}
```

(If a token like `--surface-2` is absent in `:root`, use the nearest existing surface token.)

- [ ] **Step 9: Type-check + full frontend suite**

Run: `cd frontend && pnpm exec tsc -b && pnpm test`
Expected: clean; all tests pass (LeaderboardPanel + existing MatchRow/matches).

- [ ] **Step 10: Commit**

```bash
git add frontend/src/lib/leaderboard.ts frontend/src/components/LeaderboardPanel.tsx frontend/src/components/LeaderboardPanel.test.tsx frontend/src/routes/Home.tsx frontend/src/App.tsx frontend/src/styles/tokens.css
git commit -m "feat(frontend): leaderboard on the landing screen (desktop split, mobile toggle)"
```

---

### Task 8: End-to-end verification + Definition of Done

**Files:** none (verification only).

- [ ] **Step 1: Apply migration 0005**

Run: `make migrate-up` (or `make up-d` to rebuild). Confirm: `docker exec sayscore-mysql-1 mysql -uwcp -pwcp wcp -e "SHOW TABLES LIKE 'weekly_results';"` lists it.

- [ ] **Step 2: Backend vet + full suite**

Run: `cd backend && go vet ./... && go test ./... -count=1`
Expected: all green incl. `internal/leaderboard`, `internal/jobs`, `internal/httpapi`.

- [ ] **Step 3: Frontend type-check + tests + build**

Run: `cd frontend && pnpm exec tsc -b && pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 4: Live leaderboard against the M5-ingested results**

With the stack running (`make up-d`) and the M5 results already ingested (matches FINAL with points), seed a couple of predictions for finished matches if needed, then (admin cookie as in M5):

```bash
curl -s -b 'sayscore_session=<cookie>' 'http://localhost:8000/api/leaderboard?period=overall' | python3 -m json.tool
curl -s -b 'sayscore_session=<cookie>' 'http://localhost:8000/api/leaderboard?period=week' | python3 -m json.tool
```
Expected: ranked rows (overall ordered by total then exact then correct), `me` populated, weekly window = current IST week.

- [ ] **Step 5: weekly-winner trigger + idempotency**

```bash
curl -s -X POST -b 'sayscore_session=<cookie>' -H 'Content-Type: application/json' -d '{"job":"weekly-winner"}' http://localhost:8000/api/admin/jobs/run | python3 -m json.tool
docker exec sayscore-mysql-1 mysql -uwcp -pwcp wcp -e "SELECT user_id, week_start, points, is_winner FROM weekly_results ORDER BY points DESC LIMIT 5;"
```
Expected: a `{week_start, participants, winners}` summary; `weekly_results` rows with co-winners on the top total (>0). Re-run the curl → rows unchanged (idempotent).

- [ ] **Step 6: Frontend visual check**

Open `http://localhost:8080`, sign in. Desktop: fixtures left + leaderboard right (Overall/Weekly toggle, your row highlighted). Narrow the window (<1024px): the Fixtures | Ranks toggle appears and swaps panes.

- [ ] **Step 7: Definition of Done** (tick each)

- [ ] `0005` applied; `weekly_results` exists.
- [ ] `go vet` + `go test ./...` green incl. leaderboard ranking + weekly-winner.
- [ ] `GET /api/leaderboard` returns correct weekly + overall rankings (live SUMs, §5.1 order, pagination, `me`).
- [ ] weekly-winner writes `weekly_results` with co-winners idempotently, via cron + trigger.
- [ ] Landing screen shows the leaderboard (desktop two-column, mobile toggle), current user highlighted; `tsc` + `vitest` + `pnpm build` green.

- [ ] **Step 8: Optionally run `sayscore-verifier`**, then open the M6 PR to `main`.

---

## Self-Review

**Spec coverage:**
- weekly_results table → Task 1. Leaderboard SUM queries (weekly window by kickoff, overall) → Task 1.
- Plain-SUM reads, never recompute → Tasks 1/2/4 (SUM queries, handler reads only).
- §5.1 overall ordering + weekly co-winner ties → Task 3 (`OverallSameRank`/`WeeklySameRank` + `Rank`) + Task 4.
- Pagination + caller's own rank → Task 3 (`Page`/`Find`) + Task 4 (`me`).
- `GET /api/leaderboard` (week + overall, default week, 400s, auth) → Task 4.
- weekly-winner job (previous IST week, co-winners >0, idempotent) → Task 5; cron (`WEEKLY_CRON`) + trigger → Task 6.
- Frontend landing leaderboard (desktop split, mobile toggle, highlight, badge, pagination, states) → Task 7.
- Config `WEEKLY_CRON` → Task 6. DoD/live → Task 8.
- Out of scope (tournament bonus M7) → overall sums points+penalty_bonus only; `OverallSameRank` has no bonus tier; noted.

**Placeholder scan:** none — full code in each step. Task 7 Step 8 is the one impeccable-refined step but ships a complete baseline + the exact class/role contract the tests need.

**Type consistency:** `store.LeaderboardRow{UserID,Name,AvatarURL,Points,Exact,Correct}`, `store.WeeklyResult{UserID,Points int32,IsWinner}`, `store.UpsertWeeklyResultParams`, `store.LeaderboardStore` (Task 2) consumed in Tasks 4/5/6. `leaderboard.Row`/`Ranked`/`Rank`/`Page`/`Find`/`WeeklySameRank`/`OverallSameRank` (Task 3) consumed in Task 4. `leaderboardResponse`/`leaderboardRowDTO`/`meRankDTO` (Task 4). `jobs.WeeklyWinner`/`WeeklySummary` (Task 5) consumed in Task 6. `httpapi.JobRunner` gains `RunWeeklyWinner` (Task 6), implemented by `serverJobs` (Task 6) + the test `fakeJobRunner` (Task 6 Step 7). Frontend `LeaderboardResponse`/`LeaderboardRow`/`getLeaderboard`/`useLeaderboard` (Task 7). The `week_start` DATE key (IST-Monday calendar date at midnight UTC — `weekStartKey` in Task 4, `weekStartDate` in Task 5) is computed identically on both sides, so `ListWeeklyResults` matches what the job wrote; the window instants (`.UTC()` of IST midnight) are used only for the `kickoff_utc` filter.
