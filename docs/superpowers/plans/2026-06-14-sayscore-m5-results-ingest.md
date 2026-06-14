# SayScore — Milestone 5: Results Ingestion + Points Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scheduled (and debug-triggerable) `results-ingest` pipeline that pulls FINISHED World Cup matches from football-data.org, aligns each to its seeded match via a stable team-id alias map, updates the stored result (skipping `manual_override`), and recomputes `predictions.points`/`penalty_bonus` through the M4 `scoring.Compute` engine — transactionally and idempotently.

**Architecture:** `internal/sportsapi` is a thin football-data.org v4 client plus a pure `ToResult` translator (tested with `httptest`). `internal/jobs` owns `ResultsIngest.Run`, which depends on small interfaces (`sportsapi`-shaped fetcher + a `store.ResultsStore`) so it is fully table-testable with fakes and the real `scoring.Compute`. Alignment uses a committed `data/fd_team_aliases.csv` (football-data team id → FIFA code) and a new nullable-unique `matches.api_fixture_id` (migration `0004`). The in-process `robfig/cron/v3` scheduler (location IST) runs the job on `RESULTS_CRON`; a `RequireAdmin`-gated, non-production-only `POST /api/admin/jobs/run` triggers it on demand.

**Tech Stack:** Go 1.26 (`net/http`, `database/sql`, `encoding/json`, `encoding/csv`), `go-chi/chi/v5`, sqlc, golang-migrate, MySQL 8, **`robfig/cron/v3` (new dep)**, and `internal/scoring` (M4). No frontend.

**Spec references:** design spec `docs/superpowers/specs/2026-06-14-sayscore-m5-results-ingest-design.md`; REQUIREMENTS.md §6 (cron `0 3,8,13 * * *`), §8 (football-data.org v4, WC, X-Auth-Token, field mapping), §5 (scoring), §3.6 (debug trigger). **Out of scope:** weekly-winner + leaderboards (M6 — trigger returns 400 for that job); admin result-correction UI + match CRUD (M8 — only `RequireAdmin` + the debug trigger are built here).

---

## File Structure

**Create**
- `backend/migrations/0004_add_match_api_fixture_id.{up,down}.sql` — nullable-unique `api_fixture_id`.
- `backend/internal/store/queries/results.sql` — the new ingest queries.
- `backend/internal/store/results.go` — `ResultsStore` interface, domain types, `SQLStore` adapters, `WithTx`.
- `backend/internal/sportsapi/client.go` — football-data.org client + DTOs.
- `backend/internal/sportsapi/translate.go` — pure `ToResult`.
- `backend/internal/sportsapi/sportsapi_test.go` — httptest + translator tests.
- `backend/internal/jobs/results_ingest.go` — `ResultsIngest.Run` + its interfaces + `Summary`.
- `backend/internal/jobs/alias.go` — `LoadAliases` (CSV → `map[int64]string`).
- `backend/internal/jobs/results_ingest_test.go` — fake-driven ingest tests.
- `backend/internal/jobs/alias_test.go` — alias loader tests.
- `data/fd_team_aliases.csv` — committed 48-row map.
- `scripts/gen_fd_aliases.py` — one-time authoring script.
- `backend/internal/httpapi/admin_jobs_handler.go` — `RequireAdmin` + `PostRunJob`.
- `backend/internal/httpapi/admin_jobs_test.go` — gate + dispatch tests.

**Modify**
- `backend/internal/store/queries/matches.sql`, `predictions.sql`, `teams.sql` — add queries (regenerate sqlc).
- `backend/internal/config/config.go` — `FootballDataAPIKey`, `FootballDataBaseURL`, `ResultsCron`.
- `backend/internal/httpapi/middleware.go` — add `JobRunner` to `Deps`.
- `backend/internal/httpapi/router.go` — register the debug trigger.
- `backend/cmd/server/main.go` — cron scheduler + graceful shutdown + wiring.
- `backend/go.mod` / `go.sum` — `robfig/cron/v3`.

---

## Conventions

Backend commands from `backend/`. Lefthook: Conventional Commits; `gofmt` on commit, `go vet`/`go test` on push. TDD: failing test → RED → minimal code → GREEN → commit. **sqlc generated identifiers are authoritative** — after `make sqlc`, read `internal/store/sqlc/*` and adapt adapters to the real names/types (don't hand-edit generated code); scores/columns are `int32`, nullable FKs are `sql.NullInt64`, `kickoff_utc` is `time.Time` field `KickoffUtc`, enums are `MatchesStage`/`MatchesStatus`. Times stored UTC. Don't stage `.claude/`, `node_modules/`, `dist/`, `.playwright-mcp/`, `/tmp`.

---

### Task 1: Migration 0004 + sqlc queries

**Files:**
- Create: `backend/migrations/0004_add_match_api_fixture_id.up.sql`, `.down.sql`
- Create: `backend/internal/store/queries/results.sql`
- Modify: `backend/internal/store/queries/matches.sql`, `predictions.sql`, `teams.sql`
- Regenerate: `backend/internal/store/sqlc/`

- [ ] **Step 1: Write `backend/migrations/0004_add_match_api_fixture_id.up.sql`**

```sql
ALTER TABLE matches
    ADD COLUMN api_fixture_id BIGINT NULL AFTER source_id,
    ADD UNIQUE KEY uq_matches_api_fixture_id (api_fixture_id);
```

- [ ] **Step 2: Write `backend/migrations/0004_add_match_api_fixture_id.down.sql`**

```sql
ALTER TABLE matches
    DROP KEY uq_matches_api_fixture_id,
    DROP COLUMN api_fixture_id;
```

- [ ] **Step 3: Create `backend/internal/store/queries/results.sql`**

```sql
-- name: FindMatchByAPIFixtureID :one
SELECT id, stage, home_team_id, away_team_id, kickoff_utc, status, manual_override, api_fixture_id
FROM matches
WHERE api_fixture_id = ?;

-- name: FindMatchByKickoffAndTeams :one
SELECT id, stage, home_team_id, away_team_id, kickoff_utc, status, manual_override, api_fixture_id
FROM matches
WHERE kickoff_utc = ? AND home_team_id = ? AND away_team_id = ?;

-- name: UpdateMatchResult :exec
UPDATE matches
SET status = ?, home_score = ?, away_score = ?, went_to_penalties = ?,
    penalty_winner_team_id = ?, api_fixture_id = ?
WHERE id = ?;

-- name: ListPredictionsForMatch :many
SELECT id, home_score, away_score, penalty_winner_team_id
FROM predictions
WHERE match_id = ?;

-- name: SetPredictionScore :exec
UPDATE predictions SET points = ?, penalty_bonus = ? WHERE id = ?;
```

- [ ] **Step 4: Append `ListTeamsByCode` to `backend/internal/store/queries/teams.sql`**

```sql
-- name: ListTeamsByCode :many
SELECT id, code FROM teams WHERE is_placeholder = 0;
```

- [ ] **Step 5: Regenerate sqlc**

Run: `make sqlc`
Expected: regenerates with `FindMatchByAPIFixtureID`, `FindMatchByKickoffAndTeams`, `FindMatchByKickoffAndTeamsParams`, `UpdateMatchResult`, `UpdateMatchResultParams`, `ListPredictionsForMatch`, `ListPredictionsForMatchRow`, `SetPredictionScore`, `SetPredictionScoreParams`, `ListTeamsByCode`, `ListTeamsByCodeRow`. No errors.

- [ ] **Step 6: Inspect generated names** (don't edit generated code)

Run: `grep -nE 'func \(q \*Queries\) (FindMatchByAPIFixtureID|FindMatchByKickoffAndTeams|UpdateMatchResult|ListPredictionsForMatch|SetPredictionScore|ListTeamsByCode)|type (FindMatchByKickoffAndTeamsParams|UpdateMatchResultParams|FindMatchByAPIFixtureIDRow|ListPredictionsForMatchRow|ListTeamsByCodeRow|SetPredictionScoreParams)' backend/internal/store/sqlc/*.go`
Expected: each present once. Record exact field names/types for Task 2 (e.g. `HomeScore sql.NullInt32`? `PenaltyWinnerTeamID sql.NullInt64`? `WentToPenalties bool`? `ApiFixtureID sql.NullInt64`?).

- [ ] **Step 7: Build**

Run: `cd backend && go build ./...`
Expected: clean (no callers yet).

- [ ] **Step 8: Commit**

```bash
git add backend/migrations/0004_add_match_api_fixture_id.up.sql backend/migrations/0004_add_match_api_fixture_id.down.sql backend/internal/store/queries/ backend/internal/store/sqlc/
git commit -m "feat(db): matches.api_fixture_id (0004) + results-ingest queries (sqlc)"
```

---

### Task 2: Store layer — ResultsStore + WithTx

**Files:**
- Create: `backend/internal/store/results.go`

> Thin sqlc pass-throughs (verified by `go build` + Task 5's fake-driven tests, per the M3/M4 pattern). Adjust `sqlc.*` field names to whatever Task 1 Step 6 reported.

- [ ] **Step 1: Create `backend/internal/store/results.go`**

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

// MatchForResult is the match row the ingest needs to align + guard a result write.
type MatchForResult struct {
	ID             int64
	Stage          Stage
	HomeTeamID     *int64
	AwayTeamID     *int64
	KickoffUTC     time.Time
	Status         MatchStatus
	ManualOverride bool
	APIFixtureID   *int64
}

// UpdateMatchResultParams writes a settled result + stamps the API fixture id.
type UpdateMatchResultParams struct {
	ID                  int64
	Status              MatchStatus
	HomeScore           int32
	AwayScore           int32
	WentToPenalties     bool
	PenaltyWinnerTeamID *int64
	APIFixtureID        *int64
}

// PredictionToScore is one prediction the ingest will recompute.
type PredictionToScore struct {
	ID                  int64
	HomeScore           int32
	AwayScore           int32
	PenaltyWinnerTeamID *int64
}

// ResultsStore is the results-ingest read/write surface. WithTx runs the closure
// against a transaction-bound store (commit on nil error, else rollback).
type ResultsStore interface {
	FindMatchByAPIFixtureID(ctx context.Context, apiFixtureID int64) (MatchForResult, error)
	FindMatchByKickoffAndTeams(ctx context.Context, kickoffUTC time.Time, homeID, awayID int64) (MatchForResult, error)
	ListTeamsByCode(ctx context.Context) (map[string]int64, error)
	UpdateMatchResult(ctx context.Context, p UpdateMatchResultParams) error
	ListPredictionsForMatch(ctx context.Context, matchID int64) ([]PredictionToScore, error)
	SetPredictionScore(ctx context.Context, predictionID int64, points, penaltyBonus int32) error
	WithTx(ctx context.Context, fn func(ResultsStore) error) error
}

var _ ResultsStore = (*SQLStore)(nil)

func matchForResult(id int64, stage sqlc.MatchesStage, home, away sql.NullInt64,
	kickoff time.Time, status sqlc.MatchesStatus, override bool, apiID sql.NullInt64) MatchForResult {
	return MatchForResult{
		ID: id, Stage: Stage(stage), HomeTeamID: ptrI64(home), AwayTeamID: ptrI64(away),
		KickoffUTC: kickoff, Status: MatchStatus(status), ManualOverride: override, APIFixtureID: ptrI64(apiID),
	}
}

func (s *SQLStore) FindMatchByAPIFixtureID(ctx context.Context, apiFixtureID int64) (MatchForResult, error) {
	r, err := s.q.FindMatchByAPIFixtureID(ctx, sql.NullInt64{Int64: apiFixtureID, Valid: true})
	if errors.Is(err, sql.ErrNoRows) {
		return MatchForResult{}, ErrNotFound
	}
	if err != nil {
		return MatchForResult{}, fmt.Errorf("store: find match by api id: %w", err)
	}
	return matchForResult(r.ID, r.Stage, r.HomeTeamID, r.AwayTeamID, r.KickoffUtc, r.Status, r.ManualOverride, r.ApiFixtureID), nil
}

func (s *SQLStore) FindMatchByKickoffAndTeams(ctx context.Context, kickoffUTC time.Time, homeID, awayID int64) (MatchForResult, error) {
	r, err := s.q.FindMatchByKickoffAndTeams(ctx, sqlc.FindMatchByKickoffAndTeamsParams{
		KickoffUtc: kickoffUTC,
		HomeTeamID: sql.NullInt64{Int64: homeID, Valid: true},
		AwayTeamID: sql.NullInt64{Int64: awayID, Valid: true},
	})
	if errors.Is(err, sql.ErrNoRows) {
		return MatchForResult{}, ErrNotFound
	}
	if err != nil {
		return MatchForResult{}, fmt.Errorf("store: find match by kickoff/teams: %w", err)
	}
	return matchForResult(r.ID, r.Stage, r.HomeTeamID, r.AwayTeamID, r.KickoffUtc, r.Status, r.ManualOverride, r.ApiFixtureID), nil
}

func (s *SQLStore) ListTeamsByCode(ctx context.Context) (map[string]int64, error) {
	rows, err := s.q.ListTeamsByCode(ctx)
	if err != nil {
		return nil, fmt.Errorf("store: list teams by code: %w", err)
	}
	out := make(map[string]int64, len(rows))
	for _, r := range rows {
		out[r.Code] = r.ID
	}
	return out, nil
}

func (s *SQLStore) UpdateMatchResult(ctx context.Context, p UpdateMatchResultParams) error {
	if err := s.q.UpdateMatchResult(ctx, sqlc.UpdateMatchResultParams{
		Status:              sqlc.MatchesStatus(p.Status),
		HomeScore:           sql.NullInt32{Int32: p.HomeScore, Valid: true},
		AwayScore:           sql.NullInt32{Int32: p.AwayScore, Valid: true},
		WentToPenalties:     p.WentToPenalties,
		PenaltyWinnerTeamID: nullI64(p.PenaltyWinnerTeamID),
		ApiFixtureID:        nullI64(p.APIFixtureID),
		ID:                  p.ID,
	}); err != nil {
		return fmt.Errorf("store: update match result: %w", err)
	}
	return nil
}

func (s *SQLStore) ListPredictionsForMatch(ctx context.Context, matchID int64) ([]PredictionToScore, error) {
	rows, err := s.q.ListPredictionsForMatch(ctx, matchID)
	if err != nil {
		return nil, fmt.Errorf("store: list predictions for match: %w", err)
	}
	out := make([]PredictionToScore, 0, len(rows))
	for _, r := range rows {
		out = append(out, PredictionToScore{
			ID: r.ID, HomeScore: r.HomeScore, AwayScore: r.AwayScore,
			PenaltyWinnerTeamID: ptrI64(r.PenaltyWinnerTeamID),
		})
	}
	return out, nil
}

func (s *SQLStore) SetPredictionScore(ctx context.Context, predictionID int64, points, penaltyBonus int32) error {
	if err := s.q.SetPredictionScore(ctx, sqlc.SetPredictionScoreParams{
		Points:       sql.NullInt32{Int32: points, Valid: true},
		PenaltyBonus: sql.NullInt32{Int32: penaltyBonus, Valid: true},
		ID:           predictionID,
	}); err != nil {
		return fmt.Errorf("store: set prediction score: %w", err)
	}
	return nil
}

// WithTx runs fn against a transaction-bound store; commits on success, else rolls back.
func (s *SQLStore) WithTx(ctx context.Context, fn func(ResultsStore) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: begin tx: %w", err)
	}
	txStore := &SQLStore{db: s.db, q: s.q.WithTx(tx)}
	if err := fn(txStore); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}
```

- [ ] **Step 2: Build**

Run: `cd backend && go build ./... && go test ./...`
Expected: builds; existing tests still pass. Fix any sqlc field-name mismatches against Step 6 of Task 1 (e.g. if the generated row field is `ApiFixtureID` vs `APIFixtureID`).

- [ ] **Step 3: Commit**

```bash
git add backend/internal/store/results.go
git commit -m "feat(store): ResultsStore (find/update/recompute) + WithTx closure"
```

---

### Task 3: football-data.org client + pure translator (TDD)

**Files:**
- Create: `backend/internal/sportsapi/client.go`, `backend/internal/sportsapi/translate.go`
- Create: `backend/internal/sportsapi/sportsapi_test.go`

- [ ] **Step 1: Write the failing test `backend/internal/sportsapi/sportsapi_test.go`**

```go
package sportsapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

const sampleJSON = `{"matches":[
  {"id":1001,"utcDate":"2026-06-13T16:00:00Z","status":"FINISHED","stage":"GROUP_STAGE",
   "homeTeam":{"id":759},"awayTeam":{"id":760},
   "score":{"winner":"HOME_TEAM","duration":"REGULAR","fullTime":{"home":4,"away":1}}},
  {"id":1002,"utcDate":"2026-07-04T18:00:00Z","status":"FINISHED","stage":"LAST_16",
   "homeTeam":{"id":770},"awayTeam":{"id":771},
   "score":{"winner":"AWAY_TEAM","duration":"PENALTY_SHOOTOUT","fullTime":{"home":1,"away":1}}}
]}`

func TestListFinishedMatchesParsesAndSendsAuthHeader(t *testing.T) {
	var gotPath, gotToken string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path + "?" + r.URL.RawQuery
		gotToken = r.Header.Get("X-Auth-Token")
		_, _ = w.Write([]byte(sampleJSON))
	}))
	defer srv.Close()

	c := New(srv.URL, "secret-key")
	matches, err := c.ListFinishedMatches(context.Background(), "2026-06-12", "2026-06-13")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if gotToken != "secret-key" {
		t.Errorf("X-Auth-Token = %q, want secret-key", gotToken)
	}
	if gotPath != "/competitions/WC/matches?dateFrom=2026-06-12&dateTo=2026-06-13&status=FINISHED" {
		t.Errorf("path = %q", gotPath)
	}
	if len(matches) != 2 || matches[0].ID != 1001 || matches[0].HomeTeam.ID != 759 {
		t.Fatalf("matches = %+v", matches)
	}
}

func TestListFinishedMatchesNon2xxIsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()
	if _, err := New(srv.URL, "k").ListFinishedMatches(context.Background(), "a", "b"); err == nil {
		t.Fatal("expected error on 403")
	}
}

func intp(v int) *int { return &v }

func TestToResult(t *testing.T) {
	cases := []struct {
		name string
		in   Match
		want Result
	}{
		{"group final", Match{ID: 1, Status: "FINISHED", Stage: "GROUP_STAGE",
			Score: Score{Winner: "HOME_TEAM", Duration: "REGULAR", FullTime: FullTime{Home: intp(4), Away: intp(1)}}},
			Result{Final: true, Knockout: false, Home: 4, Away: 1, WentToPenalties: false, WinnerSide: "HOME_TEAM"}},
		{"knockout shootout", Match{ID: 2, Status: "FINISHED", Stage: "LAST_16",
			Score: Score{Winner: "AWAY_TEAM", Duration: "PENALTY_SHOOTOUT", FullTime: FullTime{Home: intp(1), Away: intp(1)}}},
			Result{Final: true, Knockout: true, Home: 1, Away: 1, WentToPenalties: true, WinnerSide: "AWAY_TEAM"}},
		{"knockout extra-time no shootout", Match{ID: 3, Status: "FINISHED", Stage: "QUARTER_FINALS",
			Score: Score{Winner: "HOME_TEAM", Duration: "EXTRA_TIME", FullTime: FullTime{Home: intp(2), Away: intp(1)}}},
			Result{Final: true, Knockout: true, Home: 2, Away: 1, WentToPenalties: false, WinnerSide: "HOME_TEAM"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got, ok := ToResult(tc.in); !ok || got != tc.want {
				t.Errorf("ToResult(%+v) = %+v, %v; want %+v", tc.in, got, ok, tc.want)
			}
		})
	}
}

func TestToResultSkipsIncomplete(t *testing.T) {
	// FINISHED but no scoreline → not scoreable.
	if _, ok := ToResult(Match{ID: 9, Status: "FINISHED", Stage: "GROUP_STAGE", Score: Score{FullTime: FullTime{}}}); ok {
		t.Fatal("expected ok=false for missing scoreline")
	}
}
```

- [ ] **Step 2: Run — confirm RED**

Run: `cd backend && go test ./internal/sportsapi/`
Expected: FAIL — package/types/functions undefined.

- [ ] **Step 3: Create `backend/internal/sportsapi/client.go`**

```go
// Package sportsapi is a thin football-data.org v4 client for World Cup results.
package sportsapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

// Match mirrors the football-data.org match object (only the fields we use).
type Match struct {
	ID       int64  `json:"id"`
	UtcDate  string `json:"utcDate"`
	Status   string `json:"status"`
	Stage    string `json:"stage"`
	HomeTeam Team   `json:"homeTeam"`
	AwayTeam Team   `json:"awayTeam"`
	Score    Score  `json:"score"`
}

type Team struct {
	ID int64 `json:"id"`
}

type Score struct {
	Winner   string   `json:"winner"`   // HOME_TEAM | AWAY_TEAM | DRAW
	Duration string   `json:"duration"` // REGULAR | EXTRA_TIME | PENALTY_SHOOTOUT
	FullTime FullTime `json:"fullTime"`
}

type FullTime struct {
	Home *int `json:"home"`
	Away *int `json:"away"`
}

// Client calls football-data.org v4.
type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

func New(baseURL, apiKey string) *Client {
	return &Client{baseURL: baseURL, apiKey: apiKey, http: &http.Client{Timeout: 15 * time.Second}}
}

// ListFinishedMatches returns the WC matches with status=FINISHED in [dateFrom, dateTo] (UTC dates).
func (c *Client) ListFinishedMatches(ctx context.Context, dateFrom, dateTo string) ([]Match, error) {
	q := url.Values{}
	q.Set("dateFrom", dateFrom)
	q.Set("dateTo", dateTo)
	q.Set("status", "FINISHED")
	u := c.baseURL + "/competitions/WC/matches?" + q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, fmt.Errorf("sportsapi: build request: %w", err)
	}
	req.Header.Set("X-Auth-Token", c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("sportsapi: do request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("sportsapi: unexpected status %d", resp.StatusCode)
	}

	var body struct {
		Matches []Match `json:"matches"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("sportsapi: decode: %w", err)
	}
	return body.Matches, nil
}
```

- [ ] **Step 4: Create `backend/internal/sportsapi/translate.go`**

```go
package sportsapi

// Result is the source-agnostic outcome the ingest consumes. WinnerSide is the
// raw side (HOME_TEAM/AWAY_TEAM/DRAW); the job resolves it to a concrete team id
// only when WentToPenalties.
type Result struct {
	Final           bool
	Knockout        bool
	Home, Away      int
	WentToPenalties bool
	WinnerSide      string
}

// ToResult translates a football-data.org match to a Result. ok is false when the
// match is not FINISHED or has no full-time scoreline (not scoreable yet).
func ToResult(m Match) (Result, bool) {
	if m.Status != "FINISHED" || m.Score.FullTime.Home == nil || m.Score.FullTime.Away == nil {
		return Result{}, false
	}
	return Result{
		Final:           true,
		Knockout:        m.Stage != "GROUP_STAGE",
		Home:            *m.Score.FullTime.Home,
		Away:            *m.Score.FullTime.Away,
		WentToPenalties: m.Score.Duration == "PENALTY_SHOOTOUT",
		WinnerSide:      m.Score.Winner,
	}, true
}
```

- [ ] **Step 5: Run — GREEN**

Run: `cd backend && go test ./internal/sportsapi/ -v`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/sportsapi/
git commit -m "feat(sportsapi): football-data.org client + pure ToResult translator"
```

---

### Task 4: Team-id alias map (data + script + loader, TDD)

**Files:**
- Create: `scripts/gen_fd_aliases.py`, `data/fd_team_aliases.csv`
- Create: `backend/internal/jobs/alias.go`, `backend/internal/jobs/alias_test.go`

- [ ] **Step 1: Create the authoring script `scripts/gen_fd_aliases.py`**

```python
#!/usr/bin/env python3
"""Author data/fd_team_aliases.csv: football-data.org team id -> our FIFA code.

One-time / re-runnable. Needs FOOTBALL_DATA_API_KEY in the env. Fetches the WC
squad list and maps each football-data team name to our FIFA code via NAME_TO_CODE
(kept in sync with scripts/gen_fixtures.py). Run: FOOTBALL_DATA_API_KEY=... \
  python3 scripts/gen_fd_aliases.py
"""
import csv
import json
import os
import urllib.request

# football-data.org team name -> our FIFA code. Extend if the API renames a team.
NAME_TO_CODE = {
    "Mexico": "MEX", "South Africa": "RSA", "Korea Republic": "KOR", "Czechia": "CZE",
    "Bosnia and Herzegovina": "BIH", "Canada": "CAN", "Qatar": "QAT", "Switzerland": "SUI",
    "Brazil": "BRA", "Haiti": "HAI", "Morocco": "MAR", "Scotland": "SCO",
    "Australia": "AUS", "Paraguay": "PAR", "Türkiye": "TUR", "United States": "USA",
    "Curaçao": "CUW", "Ecuador": "ECU", "Germany": "GER", "Côte d'Ivoire": "CIV",
    "Japan": "JPN", "Netherlands": "NED", "Sweden": "SWE", "Tunisia": "TUN",
    "Belgium": "BEL", "Egypt": "EGY", "Iran": "IRN", "New Zealand": "NZL",
    "Cape Verde": "CPV", "Saudi Arabia": "KSA", "Spain": "ESP", "Uruguay": "URU",
    "France": "FRA", "Iraq": "IRQ", "Norway": "NOR", "Senegal": "SEN",
    "Algeria": "ALG", "Argentina": "ARG", "Austria": "AUT", "Jordan": "JOR",
    "Colombia": "COL", "DR Congo": "COD", "Portugal": "POR", "Uzbekistan": "UZB",
    "Croatia": "CRO", "England": "ENG", "Ghana": "GHA", "Panama": "PAN",
}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY = os.environ["FOOTBALL_DATA_API_KEY"]


def main():
    req = urllib.request.Request(
        "https://api.football-data.org/v4/competitions/WC/teams",
        headers={"X-Auth-Token": KEY},
    )
    teams = json.load(urllib.request.urlopen(req))["teams"]
    rows, unmapped = [], []
    for t in teams:
        code = NAME_TO_CODE.get(t["name"])
        if not code:
            unmapped.append(t["name"])
            continue
        rows.append([t["id"], code])
    if unmapped:
        raise SystemExit(f"unmapped football-data team names (add to NAME_TO_CODE): {unmapped}")
    rows.sort(key=lambda r: r[1])
    with open(os.path.join(ROOT, "data", "fd_team_aliases.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["fd_team_id", "fifa_code"])
        w.writerows(rows)
    print(f"wrote {len(rows)} aliases")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Author `data/fd_team_aliases.csv`** (run the script if a key is available, else write the file from the data)

If you have `FOOTBALL_DATA_API_KEY`: `FOOTBALL_DATA_API_KEY=... python3 scripts/gen_fd_aliases.py` and verify 48 rows. If no key is available at implementation time, create `data/fd_team_aliases.csv` with the header `fd_team_id,fifa_code` and the 48 rows once the ids are known (the loader + ingest are testable without it via fakes). The file MUST exist for the live run; mark this step DONE_WITH_CONCERNS if the key is unavailable and note it.

```
fd_team_id,fifa_code
<id>,ALG
<id>,ARG
... (48 rows, fifa_code one of the NAME_TO_CODE values)
```

- [ ] **Step 3: Write the failing loader test `backend/internal/jobs/alias_test.go`**

```go
package jobs

import (
	"strings"
	"testing"
)

func TestLoadAliases(t *testing.T) {
	csv := "fd_team_id,fifa_code\n759,KOR\n805,CZE\n"
	m, err := LoadAliases(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if m[759] != "KOR" || m[805] != "CZE" || len(m) != 2 {
		t.Fatalf("aliases = %+v", m)
	}
}

func TestLoadAliasesRejectsBadRow(t *testing.T) {
	if _, err := LoadAliases(strings.NewReader("fd_team_id,fifa_code\nnotanumber,KOR\n")); err == nil {
		t.Fatal("expected error on non-numeric id")
	}
}
```

- [ ] **Step 4: Run — confirm RED**

Run: `cd backend && go test ./internal/jobs/ -run TestLoadAliases`
Expected: FAIL — `LoadAliases` undefined.

- [ ] **Step 5: Create `backend/internal/jobs/alias.go`**

```go
package jobs

import (
	"encoding/csv"
	"fmt"
	"io"
	"strconv"
)

// LoadAliases parses a football-data-team-id -> FIFA-code CSV (header row required)
// into a map. Used to align football-data matches with seeded teams.
func LoadAliases(r io.Reader) (map[int64]string, error) {
	rows, err := csv.NewReader(r).ReadAll()
	if err != nil {
		return nil, fmt.Errorf("jobs: read aliases: %w", err)
	}
	out := make(map[int64]string, len(rows))
	for i, row := range rows {
		if i == 0 {
			continue // header
		}
		if len(row) != 2 {
			return nil, fmt.Errorf("jobs: alias row %d: want 2 columns, got %d", i, len(row))
		}
		id, err := strconv.ParseInt(row[0], 10, 64)
		if err != nil {
			return nil, fmt.Errorf("jobs: alias row %d: bad fd_team_id %q: %w", i, row[0], err)
		}
		out[id] = row[1]
	}
	return out, nil
}
```

- [ ] **Step 6: Run — GREEN**

Run: `cd backend && go test ./internal/jobs/ -run TestLoadAliases -v`
Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/gen_fd_aliases.py data/fd_team_aliases.csv backend/internal/jobs/alias.go backend/internal/jobs/alias_test.go
git commit -m "feat(jobs): fd-team-id alias map (data + authoring script + loader)"
```

---

### Task 5: ResultsIngest job (align → update → recompute, TDD)

**Files:**
- Create: `backend/internal/jobs/results_ingest.go`, `backend/internal/jobs/results_ingest_test.go`

- [ ] **Step 1: Write the failing test `backend/internal/jobs/results_ingest_test.go`**

```go
package jobs

import (
	"context"
	"testing"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/sportsapi"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

func i64(v int64) *int64 { return &v }

// fakeAPI returns canned matches.
type fakeAPI struct{ matches []sportsapi.Match }

func (f fakeAPI) ListFinishedMatches(context.Context, string, string) ([]sportsapi.Match, error) {
	return f.matches, nil
}

// fakeStore implements store.ResultsStore in memory.
type fakeStore struct {
	match     store.MatchForResult
	teams     map[string]int64
	preds     []store.PredictionToScore
	updated   []store.UpdateMatchResultParams
	scored    map[int64][2]int32 // predictionID -> {points, bonus}
}

func newFakeStore(m store.MatchForResult, teams map[string]int64, preds []store.PredictionToScore) *fakeStore {
	return &fakeStore{match: m, teams: teams, preds: preds, scored: map[int64][2]int32{}}
}
func (f *fakeStore) FindMatchByAPIFixtureID(context.Context, int64) (store.MatchForResult, error) {
	if f.match.APIFixtureID != nil {
		return f.match, nil
	}
	return store.MatchForResult{}, store.ErrNotFound
}
func (f *fakeStore) FindMatchByKickoffAndTeams(_ context.Context, _ time.Time, home, away int64) (store.MatchForResult, error) {
	if f.match.HomeTeamID != nil && *f.match.HomeTeamID == home && f.match.AwayTeamID != nil && *f.match.AwayTeamID == away {
		return f.match, nil
	}
	return store.MatchForResult{}, store.ErrNotFound
}
func (f *fakeStore) ListTeamsByCode(context.Context) (map[string]int64, error) { return f.teams, nil }
func (f *fakeStore) UpdateMatchResult(_ context.Context, p store.UpdateMatchResultParams) error {
	f.updated = append(f.updated, p)
	return nil
}
func (f *fakeStore) ListPredictionsForMatch(context.Context, int64) ([]store.PredictionToScore, error) {
	return f.preds, nil
}
func (f *fakeStore) SetPredictionScore(_ context.Context, id int64, points, bonus int32) error {
	f.scored[id] = [2]int32{points, bonus}
	return nil
}
func (f *fakeStore) WithTx(ctx context.Context, fn func(store.ResultsStore) error) error {
	return fn(f) // tests run the closure directly (no real tx)
}

func fixedClock(t time.Time) func() time.Time { return func() time.Time { return t } }

// A seeded group match: teams 1 (home) & 2 (away), kicked off 2026-06-13 16:00 UTC.
func seededGroup() store.MatchForResult {
	return store.MatchForResult{
		ID: 50, Stage: store.StageGroup, HomeTeamID: i64(1), AwayTeamID: i64(2),
		KickoffUTC: time.Date(2026, 6, 13, 16, 0, 0, 0, time.UTC), Status: store.StatusScheduled,
		ManualOverride: false, APIFixtureID: nil,
	}
}

// alias: fd team 759 -> our team 1 (code KOR), fd 760 -> our team 2 (code RSA).
func aliasAndTeams() (map[int64]string, map[string]int64) {
	return map[int64]string{759: "KOR", 760: "RSA"}, map[string]int64{"KOR": 1, "RSA": 2}
}

func apiGroup4x1() sportsapi.Match {
	h, a := 4, 1
	return sportsapi.Match{ID: 1001, UtcDate: "2026-06-13T16:00:00Z", Status: "FINISHED", Stage: "GROUP_STAGE",
		HomeTeam: sportsapi.Team{ID: 759}, AwayTeam: sportsapi.Team{ID: 760},
		Score: sportsapi.Score{Winner: "HOME_TEAM", Duration: "REGULAR", FullTime: sportsapi.FullTime{Home: &h, Away: &a}}}
}

func TestRunUpdatesResultAndScoresExact(t *testing.T) {
	alias, teams := aliasAndTeams()
	// Prediction 10 = exact 4-1 (5 pts); prediction 11 = 2-1 correct result (3 pts); 12 = 0-2 wrong (0).
	preds := []store.PredictionToScore{
		{ID: 10, HomeScore: 4, AwayScore: 1}, {ID: 11, HomeScore: 2, AwayScore: 1}, {ID: 12, HomeScore: 0, AwayScore: 2},
	}
	fs := newFakeStore(seededGroup(), teams, preds)
	job := ResultsIngest{API: fakeAPI{matches: []sportsapi.Match{apiGroup4x1()}}, Store: fs, Now: fixedClock(time.Date(2026, 6, 14, 6, 0, 0, 0, time.UTC)), Alias: alias}

	sum, err := job.Run(context.Background())
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if len(fs.updated) != 1 || fs.updated[0].ID != 50 || fs.updated[0].HomeScore != 4 || fs.updated[0].AwayScore != 1 ||
		fs.updated[0].Status != store.StatusFinal || fs.updated[0].WentToPenalties || fs.updated[0].APIFixtureID == nil || *fs.updated[0].APIFixtureID != 1001 {
		t.Fatalf("update = %+v", fs.updated)
	}
	if fs.scored[10] != [2]int32{5, 0} || fs.scored[11] != [2]int32{3, 0} || fs.scored[12] != [2]int32{0, 0} {
		t.Fatalf("scored = %+v", fs.scored)
	}
	if sum.Updated != 1 || sum.PredictionsScored != 3 {
		t.Fatalf("summary = %+v", sum)
	}
}

func TestRunSkipsManualOverride(t *testing.T) {
	alias, teams := aliasAndTeams()
	m := seededGroup()
	m.ManualOverride = true
	fs := newFakeStore(m, teams, []store.PredictionToScore{{ID: 10, HomeScore: 4, AwayScore: 1}})
	job := ResultsIngest{API: fakeAPI{matches: []sportsapi.Match{apiGroup4x1()}}, Store: fs, Now: fixedClock(time.Now().UTC()), Alias: alias}

	sum, _ := job.Run(context.Background())
	if len(fs.updated) != 0 || len(fs.scored) != 0 {
		t.Fatalf("manual_override must be skipped: updated=%+v scored=%+v", fs.updated, fs.scored)
	}
	if sum.Skipped != 1 || sum.Updated != 0 {
		t.Fatalf("summary = %+v", sum)
	}
}

func TestRunIdempotent(t *testing.T) {
	alias, teams := aliasAndTeams()
	fs := newFakeStore(seededGroup(), teams, []store.PredictionToScore{{ID: 10, HomeScore: 4, AwayScore: 1}})
	job := ResultsIngest{API: fakeAPI{matches: []sportsapi.Match{apiGroup4x1()}}, Store: fs, Now: fixedClock(time.Now().UTC()), Alias: alias}

	_, _ = job.Run(context.Background())
	first := fs.scored[10]
	_, _ = job.Run(context.Background())
	if fs.scored[10] != first || first != [2]int32{5, 0} {
		t.Fatalf("not idempotent: %+v then %+v", first, fs.scored[10])
	}
}

func TestRunScoresKnockoutPenaltyBonus(t *testing.T) {
	// Knockout 1-1 shootout, away (team 2) wins the shootout. Prediction 20 = 1-1 draw
	// picking team 2 -> exact 5 + bonus 1.
	alias := map[int64]string{759: "KOR", 760: "RSA"}
	teams := map[string]int64{"KOR": 1, "RSA": 2}
	m := store.MatchForResult{ID: 60, Stage: store.StageKnockout, HomeTeamID: i64(1), AwayTeamID: i64(2),
		KickoffUTC: time.Date(2026, 7, 4, 18, 0, 0, 0, time.UTC), Status: store.StatusScheduled}
	fs := newFakeStore(m, teams, []store.PredictionToScore{{ID: 20, HomeScore: 1, AwayScore: 1, PenaltyWinnerTeamID: i64(2)}})
	h, a := 1, 1
	ko := sportsapi.Match{ID: 2002, UtcDate: "2026-07-04T18:00:00Z", Status: "FINISHED", Stage: "LAST_16",
		HomeTeam: sportsapi.Team{ID: 759}, AwayTeam: sportsapi.Team{ID: 760},
		Score: sportsapi.Score{Winner: "AWAY_TEAM", Duration: "PENALTY_SHOOTOUT", FullTime: sportsapi.FullTime{Home: &h, Away: &a}}}
	job := ResultsIngest{API: fakeAPI{matches: []sportsapi.Match{ko}}, Store: fs, Now: fixedClock(time.Now().UTC()), Alias: alias}

	_, _ = job.Run(context.Background())
	if fs.updated[0].WentToPenalties != true || fs.updated[0].PenaltyWinnerTeamID == nil || *fs.updated[0].PenaltyWinnerTeamID != 2 {
		t.Fatalf("knockout update = %+v", fs.updated[0])
	}
	if fs.scored[20] != [2]int32{5, 1} {
		t.Fatalf("expected exact+bonus {5,1}, got %+v", fs.scored[20])
	}
}
```

- [ ] **Step 2: Run — confirm RED**

Run: `cd backend && go test ./internal/jobs/ -run TestRun`
Expected: FAIL — `ResultsIngest` / `Summary` undefined.

- [ ] **Step 3: Create `backend/internal/jobs/results_ingest.go`**

```go
// Package jobs hosts the scheduled background jobs. results_ingest pulls FINISHED
// matches from the results API and recomputes points idempotently.
package jobs

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/scoring"
	"github.com/sayonetech/worldcup-predictor/backend/internal/sportsapi"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

// Fetcher is the slice of the football-data client the job needs (for fakes).
type Fetcher interface {
	ListFinishedMatches(ctx context.Context, dateFrom, dateTo string) ([]sportsapi.Match, error)
}

// ResultsIngest fetches finished matches, aligns them to seeded matches, updates
// results, and recomputes affected predictions' points.
type ResultsIngest struct {
	API   Fetcher
	Store store.ResultsStore
	Now   func() time.Time
	Alias map[int64]string // football-data team id -> FIFA code
}

// Summary is a run report (logged).
type Summary struct {
	Fetched           int
	Updated           int
	Skipped           int
	PredictionsScored int
}

// Run executes one ingest pass. API errors abort the run (the next cron retries);
// per-match alignment failures and manual_override matches are skipped, not fatal.
func (j ResultsIngest) Run(ctx context.Context) (Summary, error) {
	now := j.Now().UTC()
	from := now.AddDate(0, 0, -2).Format("2006-01-02")
	to := now.Format("2006-01-02")

	matches, err := j.API.ListFinishedMatches(ctx, from, to)
	if err != nil {
		return Summary{}, fmt.Errorf("jobs: list finished: %w", err)
	}
	teamsByCode, err := j.Store.ListTeamsByCode(ctx)
	if err != nil {
		return Summary{}, fmt.Errorf("jobs: teams by code: %w", err)
	}

	sum := Summary{Fetched: len(matches)}
	for _, m := range matches {
		res, ok := sportsapi.ToResult(m)
		if !ok {
			continue
		}
		homeID, ok1 := j.resolveTeam(m.HomeTeam.ID, teamsByCode)
		awayID, ok2 := j.resolveTeam(m.AwayTeam.ID, teamsByCode)
		if !ok1 || !ok2 {
			slog.Warn("ingest: unaligned teams", "fd_match", m.ID)
			sum.Skipped++
			continue
		}
		seeded, err := j.findSeeded(ctx, m.ID, m.UtcDate, homeID, awayID)
		if errors.Is(err, store.ErrNotFound) {
			slog.Warn("ingest: no seeded match", "fd_match", m.ID)
			sum.Skipped++
			continue
		}
		if err != nil {
			return sum, fmt.Errorf("jobs: find seeded: %w", err)
		}
		if seeded.ManualOverride {
			sum.Skipped++
			continue
		}

		penWinner := penaltyWinnerID(res, homeID, awayID)
		apiID := m.ID
		scored := 0
		if err := j.Store.WithTx(ctx, func(tx store.ResultsStore) error {
			if err := tx.UpdateMatchResult(ctx, store.UpdateMatchResultParams{
				ID: seeded.ID, Status: store.StatusFinal,
				HomeScore: int32(res.Home), AwayScore: int32(res.Away),
				WentToPenalties: res.WentToPenalties, PenaltyWinnerTeamID: penWinner, APIFixtureID: &apiID,
			}); err != nil {
				return err
			}
			preds, err := tx.ListPredictionsForMatch(ctx, seeded.ID)
			if err != nil {
				return err
			}
			for _, p := range preds {
				sc := scoring.Compute(
					scoring.Prediction{Home: int(p.HomeScore), Away: int(p.AwayScore), PenaltyWinner: p.PenaltyWinnerTeamID},
					scoring.Result{Final: true, Knockout: res.Knockout, Home: res.Home, Away: res.Away,
						WentToPenalties: res.WentToPenalties, PenaltyWinner: penWinner},
				)
				if err := tx.SetPredictionScore(ctx, p.ID, int32(sc.Points), int32(sc.PenaltyBonus)); err != nil {
					return err
				}
				scored++
			}
			return nil
		}); err != nil {
			return sum, fmt.Errorf("jobs: tx for match %d: %w", seeded.ID, err)
		}
		sum.Updated++
		sum.PredictionsScored += scored
	}
	slog.Info("results-ingest complete", "fetched", sum.Fetched, "updated", sum.Updated, "skipped", sum.Skipped, "scored", sum.PredictionsScored)
	return sum, nil
}

func (j ResultsIngest) resolveTeam(fdTeamID int64, byCode map[string]int64) (int64, bool) {
	code, ok := j.Alias[fdTeamID]
	if !ok {
		return 0, false
	}
	id, ok := byCode[code]
	return id, ok
}

func (j ResultsIngest) findSeeded(ctx context.Context, fdMatchID int64, utcDate string, homeID, awayID int64) (store.MatchForResult, error) {
	if m, err := j.Store.FindMatchByAPIFixtureID(ctx, fdMatchID); err == nil {
		return m, nil
	} else if !errors.Is(err, store.ErrNotFound) {
		return store.MatchForResult{}, err
	}
	kickoff, err := time.Parse(time.RFC3339, utcDate)
	if err != nil {
		return store.MatchForResult{}, store.ErrNotFound
	}
	return j.Store.FindMatchByKickoffAndTeams(ctx, kickoff.UTC(), homeID, awayID)
}

// penaltyWinnerID resolves the shootout winner to a concrete seeded team id, or nil.
func penaltyWinnerID(res sportsapi.Result, homeID, awayID int64) *int64 {
	if !res.WentToPenalties {
		return nil
	}
	switch res.WinnerSide {
	case "HOME_TEAM":
		return &homeID
	case "AWAY_TEAM":
		return &awayID
	default:
		return nil
	}
}
```

- [ ] **Step 4: Run — GREEN**

Run: `cd backend && go test ./internal/jobs/ -v`
Expected: all `TestRun*` + `TestLoadAliases*` pass.

- [ ] **Step 5: Build whole module + vet**

Run: `cd backend && go vet ./... && go build ./...`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/jobs/results_ingest.go backend/internal/jobs/results_ingest_test.go
git commit -m "feat(jobs): results-ingest — align, update, idempotent recompute via scoring"
```

---

### Task 6: Config + cron scheduler + graceful shutdown

**Files:**
- Modify: `backend/internal/config/config.go`
- Modify: `backend/cmd/server/main.go`
- Modify: `backend/go.mod`, `backend/go.sum`

- [ ] **Step 1: Add `robfig/cron/v3`**

Run: `cd backend && go get github.com/robfig/cron/v3@v3.0.1`
Expected: added to `go.mod`/`go.sum`.

- [ ] **Step 2: Add config fields in `config.go`**

Add to the `Config` struct (after `SeedDataDir`):

```go
	FootballDataAPIKey  string
	FootballDataBaseURL string
	ResultsCron         string
```

Add to the `Load()` literal (after `SeedDataDir: ...`):

```go
		FootballDataAPIKey:  os.Getenv("FOOTBALL_DATA_API_KEY"),
		FootballDataBaseURL: getenv("FOOTBALL_DATA_BASE_URL", "https://api.football-data.org/v4"),
		ResultsCron:         getenv("RESULTS_CRON", "0 3,8,13 * * *"),
```

- [ ] **Step 3: Wire the scheduler + graceful shutdown in `cmd/server/main.go`**

Add imports: `"os/signal"`, `"syscall"`, `"github.com/robfig/cron/v3"`, `"github.com/sayonetech/worldcup-predictor/backend/internal/jobs"`, `"github.com/sayonetech/worldcup-predictor/backend/internal/sportsapi"`. Replace the server-run block (from `srv := &http.Server{...}` to the end of `main`) with:

```go
	srv := &http.Server{
		Addr:              ":" + cfg.HTTPPort,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// Results-ingest scheduler (in-process). Only runs when an API key is set;
	// local dev without a key still boots.
	scheduler := startResultsCron(cfg, st, logger)
	if scheduler != nil {
		defer scheduler.Stop()
	}

	go func() {
		logger.Info("listening", "port", cfg.HTTPPort, "env", cfg.AppEnv)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	logger.Info("shutting down")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("shutdown", "err", err)
	}
}

// startResultsCron builds the results-ingest job and schedules it on RESULTS_CRON
// (IST). Returns nil (and logs) when no API key is configured.
func startResultsCron(cfg config.Config, st *store.SQLStore, logger *slog.Logger) *cron.Cron {
	if cfg.FootballDataAPIKey == "" {
		logger.Info("results-ingest disabled (no FOOTBALL_DATA_API_KEY)")
		return nil
	}
	aliasFile := cfg.SeedDataDir + "/fd_team_aliases.csv"
	f, err := os.Open(aliasFile)
	if err != nil {
		logger.Error("results-ingest disabled: open alias file", "path", aliasFile, "err", err)
		return nil
	}
	defer f.Close()
	alias, err := jobs.LoadAliases(f)
	if err != nil {
		logger.Error("results-ingest disabled: parse aliases", "err", err)
		return nil
	}
	job := jobs.ResultsIngest{
		API:   sportsapi.New(cfg.FootballDataBaseURL, cfg.FootballDataAPIKey),
		Store: st,
		Now:   func() time.Time { return time.Now().UTC() },
		Alias: alias,
	}
	loc, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		loc = time.FixedZone("IST", 5*3600+1800)
	}
	c := cron.New(cron.WithLocation(loc))
	if _, err := c.AddFunc(cfg.ResultsCron, func() {
		if _, err := job.Run(context.Background()); err != nil {
			logger.Error("results-ingest run", "err", err)
		}
	}); err != nil {
		logger.Error("results-ingest disabled: bad RESULTS_CRON", "spec", cfg.ResultsCron, "err", err)
		return nil
	}
	c.Start()
	logger.Info("results-ingest scheduled", "cron", cfg.ResultsCron, "tz", loc.String())
	return c
}
```

> Note: `cfg.SeedDataDir` defaults to `./data`; in Docker the seed data is mounted/copied there. The alias file rides alongside the CSVs.

- [ ] **Step 4: Build + run the full suite**

Run: `cd backend && go vet ./... && go build ./... && go test ./...`
Expected: builds; all green. (No new unit test here — the scheduler wiring is covered by the live e2e in Task 8; `startResultsCron` is glue.)

- [ ] **Step 5: Commit**

```bash
git add backend/go.mod backend/go.sum backend/internal/config/config.go backend/cmd/server/main.go
git commit -m "feat(server): football-data config + robfig/cron results scheduler (IST) + graceful shutdown"
```

---

### Task 7: RequireAdmin + debug-only job trigger (TDD)

**Files:**
- Modify: `backend/internal/httpapi/middleware.go` (add `JobRunner` to `Deps` + `RequireAdmin`)
- Create: `backend/internal/httpapi/admin_jobs_handler.go`
- Create: `backend/internal/httpapi/admin_jobs_test.go`
- Modify: `backend/internal/httpapi/router.go`
- Modify: `backend/cmd/server/main.go` (wire `JobRunner`)

- [ ] **Step 1: Add `RequireAdmin` + `JobRunner` field in `middleware.go`**

Add to the `Deps` struct (after `Predictions`):

```go
	JobRunner          JobRunner
```

Add the interface + middleware (anywhere in `middleware.go`):

```go
// JobRunner runs a named background job on demand (debug trigger). nil in prod.
type JobRunner interface {
	RunResultsIngest(ctx context.Context) (any, error)
}

// RequireAdmin must follow RequireAuth; it 403s non-admin users.
func (d *Deps) RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, ok := userFromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "not authenticated")
			return
		}
		if u.Role != store.RoleAdmin {
			writeError(w, http.StatusForbidden, "admin only")
			return
		}
		next.ServeHTTP(w, r.WithContext(r.Context()))
	})
}
```

- [ ] **Step 2: Write the failing test `backend/internal/httpapi/admin_jobs_test.go`**

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

type fakeJobRunner struct{ called int }

func (f *fakeJobRunner) RunResultsIngest(context.Context) (any, error) {
	f.called++
	return map[string]int{"updated": 1}, nil
}

func adminJobsDeps(t *testing.T, role store.Role) (*Deps, *http.Cookie, *fakeJobRunner) {
	t.Helper()
	fs := newFakeStore()
	u, _ := fs.UpsertUser(context.Background(), store.UpsertUserParams{Email: "a@sayonetech.com", Role: role})
	if role == store.RoleAdmin { // newFakeStore may default to user; force the role
		_ = fs.SetUserRole(context.Background(), u.ID, store.RoleAdmin)
	}
	sm := auth.NewSessionManager("test-secret")
	jr := &fakeJobRunner{}
	d := &Deps{Store: fs, Sessions: sm, JobRunner: jr}
	return d, &http.Cookie{Name: sessionCookieName, Value: sm.Encode(auth.Session{UserID: u.ID}, time.Hour)}, jr
}

func postJob(t *testing.T, d *Deps, debug bool, cookie *http.Cookie, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/admin/jobs/run", strings.NewReader(body))
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	NewRouter(d, debug).ServeHTTP(rec, req)
	return rec
}

func TestRunJobAdminTriggersIngest(t *testing.T) {
	d, cookie, jr := adminJobsDeps(t, store.RoleAdmin)
	rec := postJob(t, d, true, cookie, `{"job":"results-ingest"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if jr.called != 1 {
		t.Fatalf("ingest called %d times, want 1", jr.called)
	}
}

func TestRunJobNonAdminForbidden(t *testing.T) {
	d, cookie, jr := adminJobsDeps(t, store.RoleUser)
	rec := postJob(t, d, true, cookie, `{"job":"results-ingest"}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if jr.called != 0 {
		t.Fatal("non-admin must not run the job")
	}
}

func TestRunJobUnknownJob400(t *testing.T) {
	d, cookie, _ := adminJobsDeps(t, store.RoleAdmin)
	for _, body := range []string{`{"job":"weekly-winner"}`, `{"job":"nope"}`} {
		rec := postJob(t, d, true, cookie, body)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("body %s: status = %d, want 400", body, rec.Code)
		}
	}
}

func TestRunJobAbsentInProduction(t *testing.T) {
	d, cookie, _ := adminJobsDeps(t, store.RoleAdmin)
	rec := postJob(t, d, false, cookie, `{"job":"results-ingest"}`) // debug=false → route not registered
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (route absent in prod)", rec.Code)
	}
}
```

- [ ] **Step 3: Run — confirm RED**

Run: `cd backend && go test ./internal/httpapi/ -run TestRunJob`
Expected: FAIL — `PostRunJob`/route undefined.

- [ ] **Step 4: Create `backend/internal/httpapi/admin_jobs_handler.go`**

```go
package httpapi

import (
	"encoding/json"
	"net/http"
)

type runJobRequest struct {
	Job string `json:"job"`
}

// PostRunJob is the debug-only manual job trigger (registered only when debug).
// Admin-gated. Currently supports "results-ingest"; "weekly-winner" arrives in M6.
func (d *Deps) PostRunJob(w http.ResponseWriter, r *http.Request) {
	var req runJobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	switch req.Job {
	case "results-ingest":
		summary, err := d.JobRunner.RunResultsIngest(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "job failed: "+err.Error())
			return
		}
		writeJSON(w, http.StatusOK, summary)
	default:
		writeError(w, http.StatusBadRequest, "unknown job")
	}
}
```

- [ ] **Step 5: Register the route (debug only) in `router.go`**

Inside the `priv` group, after the prediction route, add:

```go
			if debug {
				priv.With(d.RequireAdmin).Post("/admin/jobs/run", d.PostRunJob)
			}
```

- [ ] **Step 6: Run — GREEN**

Run: `cd backend && go test ./internal/httpapi/ -run TestRunJob -v && go test ./internal/httpapi/`
Expected: the four `TestRunJob*` pass; whole package green.

- [ ] **Step 7: Wire `JobRunner` in `cmd/server/main.go`**

Add an adapter so the job satisfies `httpapi.JobRunner`, and pass it to `Deps` only in non-production (mirrors the debug-route gating). After `st := store.New(db)` and before building `deps`, build the optional runner:

```go
	var jobRunner httpapi.JobRunner
	if !cfg.IsProduction() && cfg.FootballDataAPIKey != "" {
		if alias, err := loadAliasFile(cfg.SeedDataDir + "/fd_team_aliases.csv"); err == nil {
			ingest := jobs.ResultsIngest{
				API:   sportsapi.New(cfg.FootballDataBaseURL, cfg.FootballDataAPIKey),
				Store: st,
				Now:   func() time.Time { return time.Now().UTC() },
				Alias: alias,
			}
			jobRunner = ingestRunner{ingest}
		} else {
			logger.Warn("job trigger disabled: alias load", "err", err)
		}
	}
```

Add `JobRunner: jobRunner,` to the `deps` literal. Add these helpers to `main.go`:

```go
// ingestRunner adapts jobs.ResultsIngest to httpapi.JobRunner.
type ingestRunner struct{ ingest jobs.ResultsIngest }

func (r ingestRunner) RunResultsIngest(ctx context.Context) (any, error) {
	return r.ingest.Run(ctx)
}

func loadAliasFile(path string) (map[int64]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return jobs.LoadAliases(f)
}
```

Refactor `startResultsCron` (Task 6) to reuse `loadAliasFile` instead of inlining the open/parse (DRY): replace its alias-loading lines with `alias, err := loadAliasFile(cfg.SeedDataDir + "/fd_team_aliases.csv")` and handle the error as before.

- [ ] **Step 8: Build + full suite**

Run: `cd backend && go vet ./... && go build ./... && go test ./...`
Expected: clean + green.

- [ ] **Step 9: Commit**

```bash
git add backend/internal/httpapi/middleware.go backend/internal/httpapi/admin_jobs_handler.go backend/internal/httpapi/admin_jobs_test.go backend/internal/httpapi/router.go backend/cmd/server/main.go
git commit -m "feat(api): RequireAdmin + debug-only POST /api/admin/jobs/run (results-ingest)"
```

---

### Task 8: End-to-end verification + Definition of Done

**Files:** none (verification only).

- [ ] **Step 1: Apply migration 0004**

Run: `make migrate-up` (or `make up-d` to rebuild the stack).
Expected: `0004` applies; `docker exec sayscore-mysql-1 mysql -uwcp -pwcp wcp -e "SHOW COLUMNS FROM matches LIKE 'api_fixture_id';"` shows the column.

- [ ] **Step 2: Author the alias file (if not already)**

Run: `FOOTBALL_DATA_API_KEY=<key> python3 scripts/gen_fd_aliases.py` → `data/fd_team_aliases.csv` has 48 rows. Commit it if it changed.

- [ ] **Step 3: Backend vet + full tests**

Run: `cd backend && go vet ./... && go test ./... -count=1`
Expected: all green (incl. `sportsapi`, `jobs`, `httpapi`).

- [ ] **Step 4: Live ingest via the debug trigger**

With `FOOTBALL_DATA_API_KEY` set in `backend/.env` and the stack running (`make up-d`), seed a prediction or two for an already-FINISHED match, then trigger (use an admin session cookie, as in earlier milestones' e2e):

```bash
curl -i -X POST http://localhost:8000/api/admin/jobs/run \
  -H 'Content-Type: application/json' -b 'sayscore_session=<admin-cookie>' \
  -d '{"job":"results-ingest"}'
```
Expected: `200` with a summary `{fetched, updated, skipped, predictionsScored}`. Then:
```bash
docker exec sayscore-mysql-1 mysql -uwcp -pwcp wcp -e \
  "SELECT m.api_fixture_id, m.status, m.home_score, m.away_score, p.points, p.penalty_bonus FROM matches m JOIN predictions p ON p.match_id=m.id WHERE m.status='final' LIMIT 5;"
```
Expected: the FINISHED matches have `status=final`, real scores, `api_fixture_id` set, and predictions show correct `points`/`penalty_bonus`.

- [ ] **Step 5: Idempotency + guards**

Re-run the same curl → the DB values are unchanged (idempotent). Flip a match's `manual_override=1`, change its score by hand, re-trigger → that match's result is NOT overwritten. A non-admin session → `403`; in a production build (`APP_ENV=production`) the route returns `404`.

- [ ] **Step 6: No-key boot**

Unset `FOOTBALL_DATA_API_KEY`, restart the backend → it boots and logs `results-ingest disabled (no FOOTBALL_DATA_API_KEY)`; no crash.

- [ ] **Step 7: Definition of Done** (tick each)

- [ ] `0004` applied; `matches.api_fixture_id` exists (nullable, unique).
- [ ] `go vet` + `go test ./...` green incl. `sportsapi` + `jobs`.
- [ ] Debug trigger ingests FINISHED WC matches; affected predictions show correct `points`/`penalty_bonus`; re-trigger is a no-op (idempotent).
- [ ] `manual_override` matches are never overwritten; non-admin → 403; route absent in production.
- [ ] No-key boot logs the job disabled and runs normally.

- [ ] **Step 8: Optionally run `sayscore-verifier`** for an independent DoD check, then open the M5 PR to `main`.

---

## Self-Review

**Spec coverage:**
- football-data.org client + X-Auth-Token + endpoint → Task 3.
- Field mapping (status/fullTime/duration→pens/stage→knockout/winner) → Task 3 `ToResult` + Task 5 `penaltyWinnerID`.
- Team-id alias alignment + `api_fixture_id` stamping → Tasks 1 (migration/queries), 4 (alias), 5 (`findSeeded`).
- Update non-override + recompute via `scoring.Compute` in a tx, idempotent → Tasks 2 (`WithTx`), 5 (`Run`, tests incl. idempotency + manual_override + penalty bonus).
- Cron `0 3,8,13` IST, runs only with key, graceful stop → Task 6.
- `RequireAdmin` + debug-only `POST /api/admin/jobs/run`, weekly-winner→400, absent in prod → Task 7.
- Config env vars → Task 6.
- DoD / live verification → Task 8.
- Out of scope (weekly-winner job, leaderboards, admin UI) → not built; trigger 400s weekly-winner.

**Placeholder scan:** none — full code in every code step. Task 4 Step 2 is the one data-authoring step that may be DONE_WITH_CONCERNS if no API key is on hand at implementation time (the loader + ingest are fully testable without it via fakes; the file is required only for the live run in Task 8).

**Type consistency:** `store.MatchForResult`, `store.UpdateMatchResultParams`, `store.PredictionToScore`, `store.ResultsStore` (+ `WithTx(func(ResultsStore) error)`) defined in Task 2, consumed in Task 5. `sportsapi.Match/Score/FullTime/Team/Result` + `New`/`ListFinishedMatches`/`ToResult` defined in Task 3, consumed in Tasks 5 + main (Task 6/7). `jobs.ResultsIngest{API Fetcher, Store store.ResultsStore, Now func() time.Time, Alias map[int64]string}`, `Summary`, `LoadAliases` defined in Tasks 4/5, consumed in Task 6/7. `httpapi.JobRunner` + `RequireAdmin` + `PostRunJob` defined in Task 7. `scoring.Compute(scoring.Prediction{Home,Away int,PenaltyWinner *int64}, scoring.Result{Final,Knockout bool,Home,Away int,WentToPenalties bool,PenaltyWinner *int64}) scoring.Score{Points,PenaltyBonus int}` used in Task 5 matches the real M4 API. `cfg.FootballDataAPIKey/FootballDataBaseURL/ResultsCron` defined in Task 6, used in Tasks 6/7.
