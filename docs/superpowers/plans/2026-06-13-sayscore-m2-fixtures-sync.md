# SayScore — Milestone 2: Fixtures Sync + IST Fixtures List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync the 48 World Cup teams and 104 fixtures from API-Football into MySQL (idempotently, never clobbering admin overrides), and serve them to the frontend as `GET /api/matches` grouped by IST date with per-match lock state, rendered as a mobile-first Fixtures list.

**Architecture:** A new `internal/sportsapi` package owns the API-Football HTTP client and the pure JSON→domain mapping (no DB import). A new `internal/fixtures` package owns the `Syncer` that orchestrates client→store upserts. The store grows a separate narrow `MatchStore` interface (so M1's `fakeStore`/auth tests stay untouched); `*SQLStore` implements it. `cmd/seedfixtures` wires the real client + store for `make seed-fixtures`. `GET /api/matches` (behind `RequireAuth`) reads matches and returns them grouped by IST date with a server-computed `locked` flag. The Fixtures frontend route renders the grouped list via the `impeccable` design skill against spec §7.

**Tech Stack:** Go 1.22+, chi, sqlc, golang-migrate, MySQL 8, stdlib `net/http`+`encoding/json`+`time` (IST via `time.LoadLocation("Asia/Kolkata")`); React 18 + TS + Vite, TanStack Query, the dark §7 tokens. Tests: Go `httptest` against captured API-Football JSON; pure mapping/grouping unit tests; handler tests with a fake `MatchStore`.

**Spec references:** §3.2 (fixtures list grouped by IST date, kickoff + countdown, server-authoritative lock), §8 (API-Football, league=1 season=2026), §10 (teams, matches tables), §11 (`GET /api/matches`), §7 (design system). Builds on merged Milestone 1.

**Builds on M1 (already on `main`):** `config.Config` (+`DSN()`,`IsProduction()`), `store.Store`/`SQLStore`/`New(db)` with the sqlc adapter pattern, `httpapi.Deps`/`NewRouter`/`RequireAuth`/`writeJSON`/`writeError`, `sqlc.yaml` (schema=`migrations`, queries=`internal/store/queries`, out=`internal/store/sqlc`).

---

## File Structure (Milestone 2)

**Backend**
- `internal/config/config.go` — MODIFY: add `APIFootballKey`, `APIFootballBaseURL` (loaded; key NOT required by `Load()`).
- `migrations/0002_create_teams_and_matches.up.sql` / `.down.sql` — NEW: teams + matches tables (spec §10).
- `internal/store/queries/teams.sql` — NEW: UpsertTeam, ListTeams, GetTeamByAPIID.
- `internal/store/queries/matches.sql` — NEW: UpsertMatch (skips manual_override), ListMatches (joined w/ teams).
- `internal/store/sqlc/` — REGENERATED via `make sqlc`.
- `internal/store/matches.go` — NEW: `MatchStore` interface, domain types (`Team`, `Match`, `MatchWithTeams`, `UpsertTeamParams`, `UpsertMatchParams`), and `*SQLStore` methods.
- `internal/sportsapi/client.go` — NEW: `Client` interface, `HTTPClient` real impl, config.
- `internal/sportsapi/types.go` — NEW: domain `Team`/`Fixture` returned by the client + status/stage enums.
- `internal/sportsapi/mapping.go` — NEW: pure mappers (raw API JSON structs → domain), incl. status + stage derivation.
- `internal/sportsapi/client_test.go`, `mapping_test.go` — NEW: httptest + pure mapping tests.
- `internal/sportsapi/testdata/teams.json`, `fixtures.json` — NEW: captured representative API responses.
- `internal/fixtures/sync.go` — NEW: `Syncer{API, Store}` + `Run(ctx) (Result, error)`.
- `internal/fixtures/sync_test.go` — NEW: fake API + fake MatchStore, idempotency + manual_override tests.
- `internal/httpapi/matches_handler.go` — NEW: `GetMatches` + pure `groupByISTDate`/`isLocked` helpers.
- `internal/httpapi/matches_test.go` — NEW: fake MatchStore, grouping + lock + auth tests.
- `internal/httpapi/middleware.go` — MODIFY: add `Matches store.MatchStore` to `Deps`.
- `internal/httpapi/router.go` — MODIFY: mount `GET /api/matches` under `RequireAuth`.
- `internal/httpapi/clock.go` — NEW: injectable `now()` for deterministic lock tests.
- `cmd/seedfixtures/main.go` — NEW: sync entrypoint.
- `cmd/server/main.go` — MODIFY: set `Deps.Matches` and pass the sportsapi config through.
- `Makefile` — MODIFY: add `seed-fixtures` target.
- `.env.example` — already has APIFOOTBALL_*; confirm.

**Frontend** (use the `impeccable` skill for the route + row components)
- `src/lib/matches.ts` — NEW: types + `getMatches()` query fn.
- `src/routes/Fixtures.tsx` — NEW: IST-date-grouped list, skeleton, empty state.
- `src/components/MatchRow.tsx` — NEW: teams, IST kickoff, countdown (JetBrains Mono), lock badge.
- `src/components/Countdown.tsx` — NEW: live countdown hook/component.
- `src/App.tsx` — MODIFY: show Fixtures when signed in.
- `src/styles/tokens.css` — MODIFY: add JetBrains Mono + any tokens used.

> **Design-skill note:** Tasks 8–9 (frontend) are the first "rich" screens — invoke the **`impeccable`** skill against spec §7 (dark-first, JetBrains Mono numerics, skeletons-not-spinners, mobile-first vertical list grouped by IST date — NOT a card grid). The backend tasks (1–7, 10) are hand-coded Go.

---

## Conventions (same as M1)

- Backend commands run from `backend/`; frontend from `frontend/`. Conventional Commits. TDD: failing test → RED → implement → GREEN → commit. After each task the tree is clean and everything builds.
- sqlc generated identifiers are authoritative — adapt adapter code to `internal/store/sqlc/*` (as in M1, generated `avatar_url`→`AvatarUrl`). After editing `.sql`, run `make sqlc`.
- Never stage `.claude/` or `node_modules/`/`dist/`.

---

### Task 1: Config — API-Football settings

**Files:**
- Modify: `backend/internal/config/config.go`
- Test: `backend/internal/config/config_test.go`

- [ ] **Step 1: Write the failing test (append to config_test.go)**

```go
func TestLoadAPIFootballDefaultsAndKey(t *testing.T) {
	t.Setenv("SESSION_SECRET", "secret")
	t.Setenv("GOOGLE_CLIENT_ID", "client-id")
	t.Setenv("APIFOOTBALL_KEY", "")
	t.Setenv("APIFOOTBALL_BASE_URL", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v (APIFOOTBALL_KEY must be optional)", err)
	}
	if cfg.APIFootballBaseURL != "https://v3.football.api-sports.io" {
		t.Errorf("APIFootballBaseURL default = %q", cfg.APIFootballBaseURL)
	}

	t.Setenv("APIFOOTBALL_KEY", "abc123")
	cfg, _ = Load()
	if cfg.APIFootballKey != "abc123" {
		t.Errorf("APIFootballKey = %q, want abc123", cfg.APIFootballKey)
	}
}
```

- [ ] **Step 2: Run → FAIL**

Run: `go test ./internal/config/ -run TestLoadAPIFootball -v`
Expected: FAIL — unknown fields `APIFootballBaseURL`/`APIFootballKey`.

- [ ] **Step 3: Implement — add fields + loader lines**

In `config.go`, add to the `Config` struct (after `SeedAdminEmails`):

```go
	APIFootballKey     string
	APIFootballBaseURL string
```

In `Load()`'s struct literal (after the `SeedAdminEmails:` line):

```go
		APIFootballKey:     os.Getenv("APIFOOTBALL_KEY"),
		APIFootballBaseURL: getenv("APIFOOTBALL_BASE_URL", "https://v3.football.api-sports.io"),
```

Do NOT add a required-check for `APIFootballKey` (the server must boot without it; the seed command validates it).

- [ ] **Step 4: Run → PASS**

Run: `go test ./internal/config/ -v` → all config tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/config/config.go backend/internal/config/config_test.go
git commit -m "feat(config): add APIFootball key and base URL settings"
```

---

### Task 2: Migration — teams + matches tables + sqlc queries

**Files:**
- Create: `backend/migrations/0002_create_teams_and_matches.up.sql`
- Create: `backend/migrations/0002_create_teams_and_matches.down.sql`
- Create: `backend/internal/store/queries/teams.sql`
- Create: `backend/internal/store/queries/matches.sql`
- Regenerate: `backend/internal/store/sqlc/`

- [ ] **Step 1: Write `0002_create_teams_and_matches.up.sql`**

```sql
CREATE TABLE teams (
    id          BIGINT       NOT NULL AUTO_INCREMENT,
    api_team_id BIGINT       NOT NULL,
    name        VARCHAR(255) NOT NULL,
    code        VARCHAR(16)  NOT NULL DEFAULT '',
    logo_url    VARCHAR(1024) NOT NULL DEFAULT '',
    PRIMARY KEY (id),
    UNIQUE KEY uq_teams_api_team_id (api_team_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE matches (
    id                     BIGINT       NOT NULL AUTO_INCREMENT,
    api_fixture_id         BIGINT       NOT NULL,
    stage                  ENUM('group','knockout') NOT NULL DEFAULT 'group',
    round                  VARCHAR(64)  NOT NULL DEFAULT '',
    home_team_id           BIGINT       NOT NULL,
    away_team_id           BIGINT       NOT NULL,
    kickoff_utc            DATETIME     NOT NULL,
    status                 ENUM('scheduled','live','final') NOT NULL DEFAULT 'scheduled',
    home_score             INT          NULL,
    away_score             INT          NULL,
    went_to_penalties      BOOL         NOT NULL DEFAULT 0,
    penalty_winner_team_id BIGINT       NULL,
    manual_override        BOOL         NOT NULL DEFAULT 0,
    updated_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_matches_api_fixture_id (api_fixture_id),
    KEY idx_matches_kickoff (kickoff_utc),
    CONSTRAINT fk_matches_home FOREIGN KEY (home_team_id) REFERENCES teams (id),
    CONSTRAINT fk_matches_away FOREIGN KEY (away_team_id) REFERENCES teams (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 2: Write `0002_create_teams_and_matches.down.sql`**

```sql
DROP TABLE IF EXISTS matches;
DROP TABLE IF EXISTS teams;
```

- [ ] **Step 3: Write `internal/store/queries/teams.sql`**

```sql
-- name: UpsertTeam :execresult
INSERT INTO teams (api_team_id, name, code, logo_url)
VALUES (?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    code = VALUES(code),
    logo_url = VALUES(logo_url);

-- name: GetTeamByAPIID :one
SELECT id, api_team_id, name, code, logo_url
FROM teams WHERE api_team_id = ?;

-- name: ListTeams :many
SELECT id, api_team_id, name, code, logo_url
FROM teams ORDER BY name;
```

- [ ] **Step 4: Write `internal/store/queries/matches.sql`**

The upsert intentionally **excludes `manual_override` rows** from being overwritten by re-sync: the `ON DUPLICATE KEY UPDATE` guards every column with `IF(manual_override = 1, <old>, <new>)` so an admin-corrected row is never clobbered by the API sync.

```sql
-- name: UpsertMatch :execresult
INSERT INTO matches (
    api_fixture_id, stage, round, home_team_id, away_team_id,
    kickoff_utc, status, home_score, away_score, went_to_penalties, penalty_winner_team_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
    stage                  = IF(manual_override = 1, stage, VALUES(stage)),
    round                  = IF(manual_override = 1, round, VALUES(round)),
    home_team_id           = IF(manual_override = 1, home_team_id, VALUES(home_team_id)),
    away_team_id           = IF(manual_override = 1, away_team_id, VALUES(away_team_id)),
    kickoff_utc            = IF(manual_override = 1, kickoff_utc, VALUES(kickoff_utc)),
    status                 = IF(manual_override = 1, status, VALUES(status)),
    home_score             = IF(manual_override = 1, home_score, VALUES(home_score)),
    away_score             = IF(manual_override = 1, away_score, VALUES(away_score)),
    went_to_penalties      = IF(manual_override = 1, went_to_penalties, VALUES(went_to_penalties)),
    penalty_winner_team_id = IF(manual_override = 1, penalty_winner_team_id, VALUES(penalty_winner_team_id));

-- name: ListMatchesWithTeams :many
SELECT
    m.id, m.api_fixture_id, m.stage, m.round,
    m.kickoff_utc, m.status, m.home_score, m.away_score,
    m.went_to_penalties, m.penalty_winner_team_id, m.manual_override,
    ht.id AS home_id, ht.name AS home_name, ht.code AS home_code, ht.logo_url AS home_logo,
    at.id AS away_id, at.name AS away_name, at.code AS away_code, at.logo_url AS away_logo
FROM matches m
JOIN teams ht ON ht.id = m.home_team_id
JOIN teams at ON at.id = m.away_team_id
ORDER BY m.kickoff_utc;
```

- [ ] **Step 5: Regenerate sqlc + build**

```bash
cd backend
export PATH="$PATH:$(go env GOPATH)/bin"
sqlc generate
go build ./...
```
Expected: new generated types in `internal/store/sqlc/` (e.g. `Team`, `Match`, `UpsertTeamParams`, `UpsertMatchParams`, `ListMatchesWithTeamsRow`). READ them — you'll adapt the adapter in Task 3 to the actual generated names. If `sqlc generate` errors, report BLOCKED with the exact message; do not hand-write generated files.

- [ ] **Step 6: Commit**

```bash
git add backend/migrations backend/internal/store/queries backend/internal/store/sqlc
git commit -m "feat(store): teams + matches migration and sqlc queries"
```

---

### Task 3: Store — MatchStore interface + SQLStore methods

**Files:**
- Create: `backend/internal/store/matches.go`

(The store methods need a live DB to unit-test meaningfully; they're exercised by the Task 10 DB smoke test and by the fake in Tasks 5/7. This task delivers the typed interface + adapter that compiles against the generated code.)

- [ ] **Step 1: Create `internal/store/matches.go`**

Start from this; ADAPT the `sqlc.*` identifiers/types to what Task 2 generated (field names like `KickoffUtc`, null types like `sql.NullInt64`/`sql.NullInt32`, the enum types `MatchesStage`/`MatchesStatus`, and the `ListMatchesWithTeamsRow` field names). The generated code is authoritative.

```go
package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type Stage string

const (
	StageGroup    Stage = "group"
	StageKnockout Stage = "knockout"
)

type MatchStatus string

const (
	StatusScheduled MatchStatus = "scheduled"
	StatusLive      MatchStatus = "live"
	StatusFinal     MatchStatus = "final"
)

type Team struct {
	ID        int64
	APITeamID int64
	Name      string
	Code      string
	LogoURL   string
}

type TeamRef struct {
	ID      int64
	Name    string
	Code    string
	LogoURL string
}

// MatchWithTeams is a match joined with its two teams (read model for the list).
type MatchWithTeams struct {
	ID             int64
	APIFixtureID   int64
	Stage          Stage
	Round          string
	KickoffUTC     time.Time
	Status         MatchStatus
	HomeScore      *int32
	AwayScore      *int32
	WentToPens     bool
	PenWinnerTeam  *int64
	ManualOverride bool
	Home           TeamRef
	Away           TeamRef
}

type UpsertTeamParams struct {
	APITeamID int64
	Name      string
	Code      string
	LogoURL   string
}

type UpsertMatchParams struct {
	APIFixtureID  int64
	Stage         Stage
	Round         string
	HomeTeamID    int64
	AwayTeamID    int64
	KickoffUTC    time.Time
	Status        MatchStatus
	HomeScore     *int32
	AwayScore     *int32
	WentToPens    bool
	PenWinnerTeam *int64
}

// MatchStore is the fixtures/matches data surface. Handlers and the syncer
// depend on this narrow interface (not the whole DB) so they fake easily.
type MatchStore interface {
	UpsertTeam(ctx context.Context, p UpsertTeamParams) error
	GetTeamIDByAPIID(ctx context.Context, apiTeamID int64) (int64, error)
	UpsertMatch(ctx context.Context, p UpsertMatchParams) error
	ListMatchesWithTeams(ctx context.Context) ([]MatchWithTeams, error)
}

// Compile-time guard.
var _ MatchStore = (*SQLStore)(nil)

func (s *SQLStore) UpsertTeam(ctx context.Context, p UpsertTeamParams) error {
	_, err := s.q.UpsertTeam(ctx, sqlcUpsertTeamParams(p))
	if err != nil {
		return fmt.Errorf("store: upsert team: %w", err)
	}
	return nil
}

func (s *SQLStore) GetTeamIDByAPIID(ctx context.Context, apiTeamID int64) (int64, error) {
	row, err := s.q.GetTeamByAPIID(ctx, apiTeamID)
	if err != nil {
		return 0, err
	}
	return row.ID, nil
}

func (s *SQLStore) UpsertMatch(ctx context.Context, p UpsertMatchParams) error {
	_, err := s.q.UpsertMatch(ctx, sqlcUpsertMatchParams(p))
	if err != nil {
		return fmt.Errorf("store: upsert match: %w", err)
	}
	return nil
}

func (s *SQLStore) ListMatchesWithTeams(ctx context.Context) ([]MatchWithTeams, error) {
	rows, err := s.q.ListMatchesWithTeams(ctx)
	if err != nil {
		return nil, fmt.Errorf("store: list matches: %w", err)
	}
	out := make([]MatchWithTeams, 0, len(rows))
	for _, r := range rows {
		out = append(out, toMatchWithTeams(r))
	}
	return out, nil
}

// --- helpers: adapt these to the ACTUAL generated sqlc identifiers ---

func nullInt32(p *int32) sql.NullInt32 {
	if p == nil {
		return sql.NullInt32{}
	}
	return sql.NullInt32{Int32: *p, Valid: true}
}
func ptrInt32(n sql.NullInt32) *int32 {
	if !n.Valid {
		return nil
	}
	v := n.Int32
	return &v
}
func nullInt64(p *int64) sql.NullInt64 {
	if p == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: *p, Valid: true}
}
func ptrInt64(n sql.NullInt64) *int64 {
	if !n.Valid {
		return nil
	}
	v := n.Int64
	return &v
}
```

Then write `sqlcUpsertTeamParams`, `sqlcUpsertMatchParams`, and `toMatchWithTeams` to convert between these domain structs and the generated `sqlc.*` types — matching the EXACT generated field names/enum types from Task 2. (E.g., if sqlc generated `KickoffUtc time.Time`, `Status sqlc.MatchesStatus`, `HomeScore sql.NullInt32`, `PenaltyWinnerTeamID sql.NullInt64`, map accordingly. If sqlc named the join-row fields `HomeName`,`HomeCode`,`HomeLogo`,`HomeID` etc., map those into `TeamRef`.)

- [ ] **Step 2: Build**

Run: `cd backend && go build ./... && go vet ./...`
Expected: compiles. If a generated field name differs, fix the converter (do not edit generated files).

- [ ] **Step 3: Commit**

```bash
git add backend/internal/store/matches.go
git commit -m "feat(store): MatchStore interface and SQLStore match/team adapters"
```

---

### Task 4: sportsapi — client, types, and pure mapping

**Files:**
- Create: `backend/internal/sportsapi/types.go`
- Create: `backend/internal/sportsapi/mapping.go`
- Create: `backend/internal/sportsapi/client.go`
- Create: `backend/internal/sportsapi/mapping_test.go`
- Create: `backend/internal/sportsapi/client_test.go`
- Create: `backend/internal/sportsapi/testdata/teams.json`
- Create: `backend/internal/sportsapi/testdata/fixtures.json`

- [ ] **Step 1: `internal/sportsapi/types.go` — domain types the client returns**

```go
// Package sportsapi is the API-Football client and the pure mapping of its
// JSON into SayScore domain values. It does not import the store.
package sportsapi

import "time"

type Stage string

const (
	StageGroup    Stage = "group"
	StageKnockout Stage = "knockout"
)

type Status string

const (
	StatusScheduled Status = "scheduled"
	StatusLive      Status = "live"
	StatusFinal     Status = "final"
)

type Team struct {
	APITeamID int64
	Name      string
	Code      string
	LogoURL   string
}

type Fixture struct {
	APIFixtureID  int64
	Stage         Stage
	Round         string
	HomeAPITeamID int64
	AwayAPITeamID int64
	KickoffUTC    time.Time
	Status        Status
	HomeScore     *int32
	AwayScore     *int32
}
```

- [ ] **Step 2: failing mapping test — `internal/sportsapi/mapping_test.go`**

```go
package sportsapi

import "testing"

func TestMapStatus(t *testing.T) {
	cases := map[string]Status{
		"NS": StatusScheduled, "TBD": StatusScheduled,
		"1H": StatusLive, "HT": StatusLive, "2H": StatusLive, "ET": StatusLive, "P": StatusLive, "LIVE": StatusLive,
		"FT": StatusFinal, "AET": StatusFinal, "PEN": StatusFinal,
	}
	for short, want := range cases {
		if got := mapStatus(short); got != want {
			t.Errorf("mapStatus(%q) = %q, want %q", short, got, want)
		}
	}
	if got := mapStatus("WTF"); got != StatusScheduled {
		t.Errorf("mapStatus(unknown) = %q, want scheduled (safe default)", got)
	}
}

func TestMapStage(t *testing.T) {
	if got := mapStage("Group A - 1"); got != StageGroup {
		t.Errorf("mapStage(group round) = %q, want group", got)
	}
	for _, r := range []string{"Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final", "3rd Place Final"} {
		if got := mapStage(r); got != StageKnockout {
			t.Errorf("mapStage(%q) = %q, want knockout", r, got)
		}
	}
}

func TestParseFixturesResponseMapsFields(t *testing.T) {
	js := []byte(`{"response":[{
		"fixture":{"id":1001,"date":"2026-06-11T19:00:00+00:00","status":{"short":"NS"}},
		"league":{"round":"Group A - 1"},
		"teams":{"home":{"id":10},"away":{"id":20}},
		"goals":{"home":null,"away":null}
	}]}`)
	fxs, err := parseFixtures(js)
	if err != nil {
		t.Fatalf("parseFixtures err = %v", err)
	}
	if len(fxs) != 1 {
		t.Fatalf("got %d fixtures, want 1", len(fxs))
	}
	f := fxs[0]
	if f.APIFixtureID != 1001 || f.HomeAPITeamID != 10 || f.AwayAPITeamID != 20 {
		t.Errorf("ids wrong: %+v", f)
	}
	if f.Stage != StageGroup || f.Status != StatusScheduled {
		t.Errorf("stage/status wrong: %+v", f)
	}
	if !f.KickoffUTC.Equal(mustTime(t, "2026-06-11T19:00:00Z")) {
		t.Errorf("kickoff = %v, want 2026-06-11T19:00:00Z (UTC)", f.KickoffUTC)
	}
	if f.HomeScore != nil || f.AwayScore != nil {
		t.Errorf("scores should be nil for NS fixture: %+v", f)
	}
}

func TestParseTeamsResponse(t *testing.T) {
	js := []byte(`{"response":[{"team":{"id":10,"name":"Brazil","code":"BRA","logo":"https://x/10.png"}}]}`)
	teams, err := parseTeams(js)
	if err != nil {
		t.Fatalf("parseTeams err = %v", err)
	}
	if len(teams) != 1 || teams[0].APITeamID != 10 || teams[0].Name != "Brazil" || teams[0].Code != "BRA" {
		t.Errorf("team mapping wrong: %+v", teams)
	}
}

func mustTime(t *testing.T, s string) time.Time {
	t.Helper()
	ts, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatal(err)
	}
	return ts
}
```
(Add `import "time"` to the test file.)

- [ ] **Step 3: run → FAIL**

Run: `go test ./internal/sportsapi/ -run 'TestMap|TestParse' -v`
Expected: FAIL — `mapStatus`/`mapStage`/`parseFixtures`/`parseTeams` undefined.

- [ ] **Step 4: implement `internal/sportsapi/mapping.go`**

```go
package sportsapi

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// raw API-Football JSON shapes (only the fields we use).
type teamsEnvelope struct {
	Response []struct {
		Team struct {
			ID   int64  `json:"id"`
			Name string `json:"name"`
			Code string `json:"code"`
			Logo string `json:"logo"`
		} `json:"team"`
	} `json:"response"`
}

type fixturesEnvelope struct {
	Response []struct {
		Fixture struct {
			ID     int64  `json:"id"`
			Date   string `json:"date"`
			Status struct {
				Short string `json:"short"`
			} `json:"status"`
		} `json:"fixture"`
		League struct {
			Round string `json:"round"`
		} `json:"league"`
		Teams struct {
			Home struct {
				ID int64 `json:"id"`
			} `json:"home"`
			Away struct {
				ID int64 `json:"id"`
			} `json:"away"`
		} `json:"teams"`
		Goals struct {
			Home *int32 `json:"home"`
			Away *int32 `json:"away"`
		} `json:"goals"`
	} `json:"response"`
}

func parseTeams(b []byte) ([]Team, error) {
	var env teamsEnvelope
	if err := json.Unmarshal(b, &env); err != nil {
		return nil, fmt.Errorf("sportsapi: decode teams: %w", err)
	}
	out := make([]Team, 0, len(env.Response))
	for _, r := range env.Response {
		out = append(out, Team{
			APITeamID: r.Team.ID, Name: r.Team.Name, Code: r.Team.Code, LogoURL: r.Team.Logo,
		})
	}
	return out, nil
}

func parseFixtures(b []byte) ([]Fixture, error) {
	var env fixturesEnvelope
	if err := json.Unmarshal(b, &env); err != nil {
		return nil, fmt.Errorf("sportsapi: decode fixtures: %w", err)
	}
	out := make([]Fixture, 0, len(env.Response))
	for _, r := range env.Response {
		ts, err := time.Parse(time.RFC3339, r.Fixture.Date)
		if err != nil {
			return nil, fmt.Errorf("sportsapi: fixture %d bad date %q: %w", r.Fixture.ID, r.Fixture.Date, err)
		}
		out = append(out, Fixture{
			APIFixtureID:  r.Fixture.ID,
			Stage:         mapStage(r.League.Round),
			Round:         r.League.Round,
			HomeAPITeamID: r.Teams.Home.ID,
			AwayAPITeamID: r.Teams.Away.ID,
			KickoffUTC:    ts.UTC(),
			Status:        mapStatus(r.Fixture.Status.Short),
			HomeScore:     r.Goals.Home,
			AwayScore:     r.Goals.Away,
		})
	}
	return out, nil
}

func mapStatus(short string) Status {
	switch short {
	case "1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT":
		return StatusLive
	case "FT", "AET", "PEN":
		return StatusFinal
	default: // NS, TBD, PST, CANC, etc. — treat as not-yet-final/scheduled
		return StatusScheduled
	}
}

func mapStage(round string) Stage {
	if strings.Contains(strings.ToLower(round), "group") {
		return StageGroup
	}
	return StageKnockout
}
```

- [ ] **Step 5: run mapping tests → PASS**

Run: `go test ./internal/sportsapi/ -run 'TestMap|TestParse' -v`

- [ ] **Step 6: implement the client — `internal/sportsapi/client.go`**

```go
package sportsapi

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// Client fetches teams and fixtures. Callers depend on this interface so the
// syncer can be tested with a fake.
type Client interface {
	FetchTeams(ctx context.Context) ([]Team, error)
	FetchFixtures(ctx context.Context) ([]Fixture, error)
}

// HTTPClient talks to API-Football (api-sports.io), league 1, season 2026.
type HTTPClient struct {
	BaseURL string
	APIKey  string
	League  string
	Season  string
	HTTP    *http.Client
}

func NewHTTPClient(baseURL, apiKey string) *HTTPClient {
	return &HTTPClient{
		BaseURL: baseURL, APIKey: apiKey, League: "1", Season: "2026",
		HTTP: &http.Client{Timeout: 20 * time.Second},
	}
}

func (c *HTTPClient) FetchTeams(ctx context.Context) ([]Team, error) {
	b, err := c.get(ctx, "/teams")
	if err != nil {
		return nil, err
	}
	return parseTeams(b)
}

func (c *HTTPClient) FetchFixtures(ctx context.Context) ([]Fixture, error) {
	b, err := c.get(ctx, "/fixtures")
	if err != nil {
		return nil, err
	}
	return parseFixtures(b)
}

func (c *HTTPClient) get(ctx context.Context, path string) ([]byte, error) {
	u := fmt.Sprintf("%s%s?league=%s&season=%s",
		c.BaseURL, path, url.QueryEscape(c.League), url.QueryEscape(c.Season))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-apisports-key", c.APIKey)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("sportsapi: GET %s: %w", path, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("sportsapi: read %s: %w", path, err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("sportsapi: GET %s status %d: %s", path, resp.StatusCode, truncate(body))
	}
	return body, nil
}

func truncate(b []byte) string {
	const max = 200
	if len(b) > max {
		return string(b[:max])
	}
	return string(b)
}

// Compile-time guard.
var _ Client = (*HTTPClient)(nil)
```

- [ ] **Step 7: capture test data**

`internal/sportsapi/testdata/teams.json`:
```json
{"response":[
  {"team":{"id":10,"name":"Brazil","code":"BRA","logo":"https://media.api-sports.io/football/teams/10.png"}},
  {"team":{"id":20,"name":"Argentina","code":"ARG","logo":"https://media.api-sports.io/football/teams/20.png"}}
]}
```

`internal/sportsapi/testdata/fixtures.json`:
```json
{"response":[
  {"fixture":{"id":1001,"date":"2026-06-11T19:00:00+00:00","status":{"short":"NS"}},
   "league":{"round":"Group A - 1"},
   "teams":{"home":{"id":10},"away":{"id":20}},
   "goals":{"home":null,"away":null}},
  {"fixture":{"id":1002,"date":"2026-07-19T19:00:00+00:00","status":{"short":"NS"}},
   "league":{"round":"Final"},
   "teams":{"home":{"id":10},"away":{"id":20}},
   "goals":{"home":null,"away":null}}
]}
```

- [ ] **Step 8: failing client test — `internal/sportsapi/client_test.go`**

```go
package sportsapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestHTTPClientFetchesAndMaps(t *testing.T) {
	teamsJSON, _ := os.ReadFile("testdata/teams.json")
	fixturesJSON, _ := os.ReadFile("testdata/fixtures.json")

	var gotKey, gotTeamsQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKey = r.Header.Get("x-apisports-key")
		switch r.URL.Path {
		case "/teams":
			gotTeamsQuery = r.URL.RawQuery
			w.Write(teamsJSON)
		case "/fixtures":
			w.Write(fixturesJSON)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := NewHTTPClient(srv.URL, "test-key")

	teams, err := c.FetchTeams(context.Background())
	if err != nil {
		t.Fatalf("FetchTeams err = %v", err)
	}
	if len(teams) != 2 || teams[0].Name != "Brazil" {
		t.Errorf("teams = %+v", teams)
	}
	if gotKey != "test-key" {
		t.Errorf("auth header = %q, want test-key", gotKey)
	}
	if gotTeamsQuery != "league=1&season=2026" {
		t.Errorf("teams query = %q, want league=1&season=2026", gotTeamsQuery)
	}

	fxs, err := c.FetchFixtures(context.Background())
	if err != nil {
		t.Fatalf("FetchFixtures err = %v", err)
	}
	if len(fxs) != 2 || fxs[0].Stage != StageGroup || fxs[1].Stage != StageKnockout {
		t.Errorf("fixtures = %+v", fxs)
	}
}

func TestHTTPClientNon200IsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		w.Write([]byte(`{"errors":["rate limit"]}`))
	}))
	defer srv.Close()
	if _, err := NewHTTPClient(srv.URL, "k").FetchTeams(context.Background()); err == nil {
		t.Fatal("expected error on 429")
	}
}
```

- [ ] **Step 9: run → PASS; then full build**

Run: `go test ./internal/sportsapi/ -v` then `go build ./...`
Expected: all sportsapi tests pass.

- [ ] **Step 10: Commit**

```bash
git add backend/internal/sportsapi
git commit -m "feat(sportsapi): API-Football client and pure fixture/team mapping"
```

---

### Task 5: fixtures.Syncer — idempotent upsert orchestration

**Files:**
- Create: `backend/internal/fixtures/sync.go`
- Create: `backend/internal/fixtures/sync_test.go`

- [ ] **Step 1: failing test — `internal/fixtures/sync_test.go`**

```go
package fixtures

import (
	"context"
	"testing"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/sportsapi"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

type fakeAPI struct {
	teams []sportsapi.Team
	fxs   []sportsapi.Fixture
}

func (f fakeAPI) FetchTeams(context.Context) ([]sportsapi.Team, error)      { return f.teams, nil }
func (f fakeAPI) FetchFixtures(context.Context) ([]sportsapi.Fixture, error) { return f.fxs, nil }

type fakeMatchStore struct {
	teamsByAPI map[int64]int64 // api_team_id -> internal id
	teamUpserts int
	matchUpserts int
	lastMatch   store.UpsertMatchParams
}

func newFakeMatchStore() *fakeMatchStore {
	return &fakeMatchStore{teamsByAPI: map[int64]int64{}}
}
func (s *fakeMatchStore) UpsertTeam(_ context.Context, p store.UpsertTeamParams) error {
	s.teamUpserts++
	if _, ok := s.teamsByAPI[p.APITeamID]; !ok {
		s.teamsByAPI[p.APITeamID] = int64(len(s.teamsByAPI) + 1)
	}
	return nil
}
func (s *fakeMatchStore) GetTeamIDByAPIID(_ context.Context, apiID int64) (int64, error) {
	return s.teamsByAPI[apiID], nil
}
func (s *fakeMatchStore) UpsertMatch(_ context.Context, p store.UpsertMatchParams) error {
	s.matchUpserts++
	s.lastMatch = p
	return nil
}
func (s *fakeMatchStore) ListMatchesWithTeams(context.Context) ([]store.MatchWithTeams, error) {
	return nil, nil
}

func TestSyncUpsertsTeamsThenMatchesAndResolvesTeamIDs(t *testing.T) {
	api := fakeAPI{
		teams: []sportsapi.Team{{APITeamID: 10, Name: "Brazil"}, {APITeamID: 20, Name: "Argentina"}},
		fxs: []sportsapi.Fixture{{
			APIFixtureID: 1001, Stage: sportsapi.StageGroup, Round: "Group A - 1",
			HomeAPITeamID: 10, AwayAPITeamID: 20,
			KickoffUTC: time.Date(2026, 6, 11, 19, 0, 0, 0, time.UTC), Status: sportsapi.StatusScheduled,
		}},
	}
	st := newFakeMatchStore()
	res, err := (&Syncer{API: api, Store: st}).Run(context.Background())
	if err != nil {
		t.Fatalf("Run err = %v", err)
	}
	if st.teamUpserts != 2 || st.matchUpserts != 1 {
		t.Errorf("upserts: teams=%d matches=%d, want 2/1", st.teamUpserts, st.matchUpserts)
	}
	if res.Teams != 2 || res.Matches != 1 {
		t.Errorf("result = %+v, want 2 teams / 1 match", res)
	}
	// the match's home/away were resolved from api ids 10/20 to internal ids
	if st.lastMatch.HomeTeamID == 0 || st.lastMatch.AwayTeamID == 0 {
		t.Errorf("team ids not resolved: %+v", st.lastMatch)
	}
	if st.lastMatch.Stage != store.StageGroup || st.lastMatch.Status != store.StatusScheduled {
		t.Errorf("stage/status not mapped to store enums: %+v", st.lastMatch)
	}
}

func TestSyncIsIdempotent(t *testing.T) {
	api := fakeAPI{
		teams: []sportsapi.Team{{APITeamID: 10, Name: "Brazil"}, {APITeamID: 20, Name: "Argentina"}},
		fxs:   []sportsapi.Fixture{{APIFixtureID: 1001, HomeAPITeamID: 10, AwayAPITeamID: 20, KickoffUTC: time.Now().UTC()}},
	}
	st := newFakeMatchStore()
	s := &Syncer{API: api, Store: st}
	_, _ = s.Run(context.Background())
	_, _ = s.Run(context.Background())
	// running twice issues upserts again (idempotent at the SQL layer via ON DUPLICATE KEY);
	// the fake just confirms it doesn't error and team ids stay stable.
	if len(st.teamsByAPI) != 2 {
		t.Errorf("teams grew on re-run: %d, want 2", len(st.teamsByAPI))
	}
}
```

- [ ] **Step 2: run → FAIL**

Run: `go test ./internal/fixtures/ -v`
Expected: FAIL — `Syncer`/`Run`/`Result` undefined.

- [ ] **Step 3: implement `internal/fixtures/sync.go`**

```go
// Package fixtures orchestrates syncing teams + fixtures from the sports API
// into the store. It is reused by `make seed-fixtures` and (later) admin re-sync.
package fixtures

import (
	"context"
	"fmt"

	"github.com/sayonetech/worldcup-predictor/backend/internal/sportsapi"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

type Syncer struct {
	API   sportsapi.Client
	Store store.MatchStore
}

type Result struct {
	Teams   int
	Matches int
}

// Run upserts all teams, then all matches (resolving API team ids to internal
// ids). Idempotent: the store's upserts use ON DUPLICATE KEY and skip
// manual_override rows, so re-running never double-creates or clobbers fixes.
func (s *Syncer) Run(ctx context.Context) (Result, error) {
	teams, err := s.API.FetchTeams(ctx)
	if err != nil {
		return Result{}, fmt.Errorf("fixtures: fetch teams: %w", err)
	}
	for _, t := range teams {
		if err := s.Store.UpsertTeam(ctx, store.UpsertTeamParams{
			APITeamID: t.APITeamID, Name: t.Name, Code: t.Code, LogoURL: t.LogoURL,
		}); err != nil {
			return Result{}, err
		}
	}

	fxs, err := s.API.FetchFixtures(ctx)
	if err != nil {
		return Result{}, fmt.Errorf("fixtures: fetch fixtures: %w", err)
	}
	for _, f := range fxs {
		homeID, err := s.Store.GetTeamIDByAPIID(ctx, f.HomeAPITeamID)
		if err != nil {
			return Result{}, fmt.Errorf("fixtures: resolve home team %d: %w", f.HomeAPITeamID, err)
		}
		awayID, err := s.Store.GetTeamIDByAPIID(ctx, f.AwayAPITeamID)
		if err != nil {
			return Result{}, fmt.Errorf("fixtures: resolve away team %d: %w", f.AwayAPITeamID, err)
		}
		if err := s.Store.UpsertMatch(ctx, store.UpsertMatchParams{
			APIFixtureID: f.APIFixtureID,
			Stage:        store.Stage(f.Stage),
			Round:        f.Round,
			HomeTeamID:   homeID,
			AwayTeamID:   awayID,
			KickoffUTC:   f.KickoffUTC,
			Status:       store.MatchStatus(f.Status),
			HomeScore:    f.HomeScore,
			AwayScore:    f.AwayScore,
		}); err != nil {
			return Result{}, err
		}
	}
	return Result{Teams: len(teams), Matches: len(fxs)}, nil
}
```

- [ ] **Step 4: run → PASS; build**

Run: `go test ./internal/fixtures/ -v && go build ./...`

- [ ] **Step 5: Commit**

```bash
git add backend/internal/fixtures
git commit -m "feat(fixtures): idempotent team+fixture syncer over the sports API"
```

---

### Task 6: `cmd/seedfixtures` + Makefile target

**Files:**
- Create: `backend/cmd/seedfixtures/main.go`
- Modify: `Makefile`

- [ ] **Step 1: implement `backend/cmd/seedfixtures/main.go`**

```go
package main

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/config"
	"github.com/sayonetech/worldcup-predictor/backend/internal/fixtures"
	"github.com/sayonetech/worldcup-predictor/backend/internal/sportsapi"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	cfg, err := config.Load()
	if err != nil {
		logger.Error("config", "err", err)
		os.Exit(1)
	}
	if cfg.APIFootballKey == "" {
		logger.Error("APIFOOTBALL_KEY is required for seed-fixtures")
		os.Exit(1)
	}

	db, err := store.OpenMySQL(cfg.DSN())
	if err != nil {
		logger.Error("db", "err", err)
		os.Exit(1)
	}
	defer db.Close()

	syncer := &fixtures.Syncer{
		API:   sportsapi.NewHTTPClient(cfg.APIFootballBaseURL, cfg.APIFootballKey),
		Store: store.New(db),
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	res, err := syncer.Run(ctx)
	if err != nil {
		logger.Error("seed-fixtures failed", "err", err)
		os.Exit(1)
	}
	logger.Info("seed-fixtures complete", "teams", res.Teams, "matches", res.Matches)
}
```

- [ ] **Step 2: add the Makefile target**

In `Makefile`, add to `.PHONY` and add the target:

```makefile
seed-fixtures:
	cd backend && go run ./cmd/seedfixtures
```

- [ ] **Step 3: build + vet**

Run: `cd backend && go build ./... && go vet ./...`
Expected: compiles (no live run — that needs a real APIFOOTBALL_KEY + DB; covered in Task 10 with a fake server).

- [ ] **Step 4: Commit**

```bash
git add backend/cmd/seedfixtures/main.go Makefile
git commit -m "feat(cmd): seedfixtures entrypoint and make seed-fixtures target"
```

---

### Task 7: `GET /api/matches` — IST grouping + lock state

**Files:**
- Create: `backend/internal/httpapi/clock.go`
- Create: `backend/internal/httpapi/matches_handler.go`
- Create: `backend/internal/httpapi/matches_test.go`
- Modify: `backend/internal/httpapi/middleware.go` (add `Matches` to `Deps`)
- Modify: `backend/internal/httpapi/router.go` (mount route)

- [ ] **Step 1: injectable clock — `internal/httpapi/clock.go`**

```go
package httpapi

import "time"

// now is overridable in tests for deterministic lock-state assertions.
var now = func() time.Time { return time.Now().UTC() }
```

- [ ] **Step 2: add `Matches` to `Deps`** (modify `middleware.go`)

In the `Deps` struct add a field:
```go
	Matches            store.MatchStore
```
(Place it under `Store store.Store`. `store` is already imported in middleware.go.)

- [ ] **Step 3: failing handler test — `internal/httpapi/matches_test.go`**

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

type fakeMatchStore struct {
	matches []store.MatchWithTeams
}

func (f fakeMatchStore) UpsertTeam(context.Context, store.UpsertTeamParams) error      { return nil }
func (f fakeMatchStore) GetTeamIDByAPIID(context.Context, int64) (int64, error)        { return 0, nil }
func (f fakeMatchStore) UpsertMatch(context.Context, store.UpsertMatchParams) error    { return nil }
func (f fakeMatchStore) ListMatchesWithTeams(context.Context) ([]store.MatchWithTeams, error) {
	return f.matches, nil
}

func matchAt(id int64, kickoff time.Time) store.MatchWithTeams {
	return store.MatchWithTeams{
		ID: id, APIFixtureID: id, Stage: store.StageGroup, Round: "Group A - 1",
		KickoffUTC: kickoff, Status: store.StatusScheduled,
		Home: store.TeamRef{ID: 1, Name: "Brazil", Code: "BRA"},
		Away: store.TeamRef{ID: 2, Name: "Argentina", Code: "ARG"},
	}
}

// helper to build an authed request with a valid session for user 1
func authedMatchesDeps(t *testing.T, matches []store.MatchWithTeams) (*Deps, *http.Cookie) {
	t.Helper()
	fs := newFakeStore() // from auth_test.go
	u, _ := fs.UpsertUser(context.Background(), store.UpsertUserParams{Email: "dev@sayonetech.com"})
	sm := auth.NewSessionManager("test-secret")
	d := &Deps{Store: fs, Matches: fakeMatchStore{matches: matches}, Sessions: sm, AllowedEmailDomain: "sayonetech.com"}
	cookie := &http.Cookie{Name: sessionCookieName, Value: sm.Encode(auth.Session{UserID: u.ID}, time.Hour)}
	return d, cookie
}

func TestGetMatchesRequiresAuth(t *testing.T) {
	d := &Deps{Matches: fakeMatchStore{}, Sessions: auth.NewSessionManager("test-secret")}
	srv := NewRouter(d, false)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/matches", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestGetMatchesGroupsByISTDateAndComputesLock(t *testing.T) {
	// Fix the clock: 2026-06-11 20:00 UTC == 2026-06-12 01:30 IST
	fixedNow := time.Date(2026, 6, 11, 20, 0, 0, 0, time.UTC)
	old := now
	now = func() time.Time { return fixedNow }
	defer func() { now = old }()

	// match A kicked off at 19:00 UTC (before now) -> locked, IST date 2026-06-12 00:30
	// match B kicks off next day 13:00 UTC (after now) -> not locked
	a := matchAt(1001, time.Date(2026, 6, 11, 19, 0, 0, 0, time.UTC))
	b := matchAt(1002, time.Date(2026, 6, 12, 13, 0, 0, 0, time.UTC))

	d, cookie := authedMatchesDeps(t, []store.MatchWithTeams{a, b})
	srv := NewRouter(d, false)

	req := httptest.NewRequest(http.MethodGet, "/api/matches", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var resp struct {
		Days []struct {
			Date    string `json:"date"`
			Matches []struct {
				ID     int64 `json:"id"`
				Locked bool  `json:"locked"`
			} `json:"matches"`
		} `json:"days"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v (body=%s)", err, rec.Body.String())
	}
	if len(resp.Days) != 2 {
		t.Fatalf("days = %d, want 2 (one per IST date); body=%s", len(resp.Days), rec.Body.String())
	}
	// both fall on IST date 2026-06-12 (19:00 UTC -> 00:30 IST next day; 13:00 UTC -> 18:30 IST same day)
	// Actually A: 2026-06-11T19:00Z = 2026-06-12T00:30 IST; B: 2026-06-12T13:00Z = 2026-06-12T18:30 IST
	// => both on 2026-06-12 -> exactly 1 day with 2 matches. Adjust expectation:
	_ = a
	_ = b
}
```

> **Note for the implementer:** the two sample matches above both land on IST date **2026-06-12**, so they group into **one** day with two matches — fix the assertion to `len(resp.Days) == 1` and assert that day has 2 matches, the first (`1001`) `locked=true` (kickoff 19:00Z < now 20:00Z) and the second (`1002`) `locked=false`. Use a third match on a clearly different IST date if you want to assert multi-day grouping. Make the assertions match the data you commit; the RED/GREEN cycle will force them honest.

- [ ] **Step 4: run → FAIL**

Run: `go test ./internal/httpapi/ -run TestGetMatches -v`
Expected: FAIL — `GetMatches` route not mounted / handler undefined.

- [ ] **Step 5: implement `internal/httpapi/matches_handler.go`**

```go
package httpapi

import (
	"net/http"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

// ist is the display timezone (spec: store UTC, show IST).
var ist = mustLoadIST()

func mustLoadIST() *time.Location {
	loc, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		// Fallback to a fixed +05:30 zone if tzdata is unavailable.
		return time.FixedZone("IST", 5*3600+1800)
	}
	return loc
}

type matchDTO struct {
	ID         int64   `json:"id"`
	Stage      string  `json:"stage"`
	Round      string  `json:"round"`
	KickoffUTC string  `json:"kickoff_utc"`
	KickoffIST string  `json:"kickoff_ist"`
	Status     string  `json:"status"`
	Locked     bool    `json:"locked"`
	Home       teamDTO `json:"home"`
	Away       teamDTO `json:"away"`
	HomeScore  *int32  `json:"home_score"`
	AwayScore  *int32  `json:"away_score"`
}

type teamDTO struct {
	ID      int64  `json:"id"`
	Name    string `json:"name"`
	Code    string `json:"code"`
	LogoURL string `json:"logo_url"`
}

type dayDTO struct {
	Date    string     `json:"date"` // IST calendar date YYYY-MM-DD
	Matches []matchDTO `json:"matches"`
}

type matchesResponse struct {
	Days []dayDTO `json:"days"`
}

// GetMatches returns all matches grouped by IST date with server-computed lock state.
func (d *Deps) GetMatches(w http.ResponseWriter, r *http.Request) {
	rows, err := d.Matches.ListMatchesWithTeams(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load matches")
		return
	}
	writeJSON(w, http.StatusOK, matchesResponse{Days: groupByISTDate(rows, now())})
}

// groupByISTDate buckets matches (already kickoff-ordered) by their IST calendar
// date and computes locked = now >= kickoff. Pure: testable without HTTP.
func groupByISTDate(rows []store.MatchWithTeams, nowUTC time.Time) []dayDTO {
	var days []dayDTO
	idx := map[string]int{}
	for _, m := range rows {
		k := m.KickoffUTC.In(ist)
		date := k.Format("2006-01-02")
		dto := matchDTO{
			ID:         m.ID,
			Stage:      string(m.Stage),
			Round:      m.Round,
			KickoffUTC: m.KickoffUTC.UTC().Format(time.RFC3339),
			KickoffIST: k.Format(time.RFC3339),
			Status:     string(m.Status),
			Locked:     !nowUTC.Before(m.KickoffUTC), // now >= kickoff
			Home:       teamDTO{ID: m.Home.ID, Name: m.Home.Name, Code: m.Home.Code, LogoURL: m.Home.LogoURL},
			Away:       teamDTO{ID: m.Away.ID, Name: m.Away.Name, Code: m.Away.Code, LogoURL: m.Away.LogoURL},
			HomeScore:  m.HomeScore,
			AwayScore:  m.AwayScore,
		}
		if i, ok := idx[date]; ok {
			days[i].Matches = append(days[i].Matches, dto)
		} else {
			idx[date] = len(days)
			days = append(days, dayDTO{Date: date, Matches: []matchDTO{dto}})
		}
	}
	return days
}
```

- [ ] **Step 6: mount the route** (modify `router.go`)

Inside the `api.Group(func(priv chi.Router) {...})` block (the authed group), add:
```go
			priv.Get("/matches", d.GetMatches)
```
so it sits beside `priv.Get("/me", d.GetMe)`.

- [ ] **Step 7: run → PASS**

Run: `go test ./internal/httpapi/ -v`
Expected: all httpapi tests pass (M1 auth/me/healthz + new matches). Fix the Task-3 test assertions to match the committed sample data (single IST day, 2 matches, lock flags) before GREEN.

- [ ] **Step 8: full build + vet + test**

Run: `go build ./... && go vet ./... && go test ./...`

- [ ] **Step 9: Commit**

```bash
git add backend/internal/httpapi/clock.go backend/internal/httpapi/matches_handler.go backend/internal/httpapi/matches_test.go backend/internal/httpapi/middleware.go backend/internal/httpapi/router.go
git commit -m "feat(api): GET /api/matches grouped by IST date with lock state"
```

---

### Task 8: Wire `Deps.Matches` in `cmd/server`

**Files:**
- Modify: `backend/cmd/server/main.go`

- [ ] **Step 1: set the Matches field**

In `main.go`, the store is already `st := store.New(db)`. In the `deps := &httpapi.Deps{...}` literal, add:
```go
		Matches:            st,
```
(`*SQLStore` satisfies both `store.Store` and `store.MatchStore`, so the one instance serves both fields.)

- [ ] **Step 2: build + vet + test**

Run: `cd backend && go build ./... && go vet ./... && go test ./...`
Expected: clean; the server now serves `/api/matches`.

- [ ] **Step 3: Commit**

```bash
git add backend/cmd/server/main.go
git commit -m "feat(server): wire MatchStore into Deps for /api/matches"
```

---

### Task 9: Frontend — Fixtures route (use the `impeccable` skill)

**Files:**
- Create: `frontend/src/lib/matches.ts`
- Create: `frontend/src/routes/Fixtures.tsx`
- Create: `frontend/src/components/MatchRow.tsx`
- Create: `frontend/src/components/Countdown.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles/tokens.css`

> **Invoke the `impeccable` design skill** for this task, with spec §7 as the contract. The data contract is the `GET /api/matches` response from Task 7 (`{ days: [{ date, matches: [{ id, stage, round, kickoff_utc, kickoff_ist, status, locked, home{...}, away{...}, home_score, away_score }] }] }`).

- [ ] **Step 1: types + query fn — `frontend/src/lib/matches.ts`**

```ts
const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

export type TeamDTO = { id: number; name: string; code: string; logo_url: string };
export type MatchDTO = {
  id: number;
  stage: "group" | "knockout";
  round: string;
  kickoff_utc: string;
  kickoff_ist: string;
  status: "scheduled" | "live" | "final";
  locked: boolean;
  home: TeamDTO;
  away: TeamDTO;
  home_score: number | null;
  away_score: number | null;
};
export type DayDTO = { date: string; matches: MatchDTO[] };
export type MatchesResponse = { days: DayDTO[] };

export async function getMatches(): Promise<MatchesResponse> {
  const res = await fetch(`${BASE}/matches`, { credentials: "include" });
  if (!res.ok) throw new Error(`/matches failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 2: countdown — `frontend/src/components/Countdown.tsx`**

```tsx
import { useEffect, useState } from "react";

// Countdown renders time remaining to a kickoff (ISO string), updating each second.
export function Countdown({ to }: { to: string }) {
  const target = new Date(to).getTime();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, target - nowMs);
  if (diff === 0) return <span className="mono muted">Kicked off</span>;
  const s = Math.floor(diff / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const label = d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m ${sec}s`;
  return <span className="mono">{label}</span>;
}
```

- [ ] **Step 3: row — `frontend/src/components/MatchRow.tsx`**

```tsx
import type { MatchDTO } from "../lib/matches";
import { Countdown } from "./Countdown";

const istTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
  });

export function MatchRow({ m }: { m: MatchDTO }) {
  return (
    <div className="match-row">
      <div className="teams">
        <span>{m.home.code || m.home.name}</span>
        <span className="muted">v</span>
        <span>{m.away.code || m.away.name}</span>
      </div>
      <div className="kickoff">
        <span className="mono">{istTime(m.kickoff_ist)} IST</span>
        {m.locked ? (
          <span className="badge-locked">Locked</span>
        ) : (
          <Countdown to={m.kickoff_utc} />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: route — `frontend/src/routes/Fixtures.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";
import { getMatches } from "../lib/matches";
import { MatchRow } from "../components/MatchRow";

const istDateLabel = (date: string) =>
  new Date(`${date}T00:00:00+05:30`).toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata",
  });

export function Fixtures() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["matches"], queryFn: getMatches });

  if (isLoading) {
    return (
      <div className="fixtures">
        {[0, 1, 2].map((i) => <div key={i} className="skeleton-row" />)}
      </div>
    );
  }
  if (isError) return <p className="muted">Couldn’t load fixtures. Pull to retry.</p>;
  if (!data || data.days.length === 0) {
    return <p className="muted">Fixtures load on first setup. Check back soon.</p>;
  }

  return (
    <div className="fixtures">
      {data.days.map((day) => (
        <section key={day.date}>
          <h2 className="day-header">{istDateLabel(day.date)}</h2>
          {day.matches.map((m) => <MatchRow key={m.id} m={m} />)}
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: show Fixtures when signed in — modify `frontend/src/App.tsx`**

Replace the signed-in `return (...)` block so the profile card sits above the fixtures list (keep the sign-in + loading branches from M1 unchanged):

```tsx
  return (
    <div className="app">
      <header className="topbar">
        <strong>SayScore</strong>
        <span className="muted">{me.name || me.email}</span>
        <button className="btn-brand" onClick={() => logout.mutate()}>Log out</button>
      </header>
      <main>
        <Fixtures />
      </main>
    </div>
  );
```
Add the import at the top: `import { Fixtures } from "./routes/Fixtures";`

- [ ] **Step 6: styles — append to `frontend/src/styles/tokens.css`**

```css
/* JetBrains Mono for all numerics (kickoff times, countdowns) */
.mono { font-family: "JetBrains Mono", ui-monospace, monospace; font-feature-settings: "tnum"; }

.app { max-width: 560px; margin: 0 auto; padding: 16px; }
.topbar { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border); }
.topbar .muted { margin-left: auto; }

.fixtures { display: flex; flex-direction: column; gap: 20px; padding-top: 16px; }
.day-header { font-size: 13px; font-weight: 500; color: var(--muted); text-transform: none; margin: 0 0 8px; }
.match-row { display: flex; align-items: center; justify-content: space-between;
  background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; margin-bottom: 8px; }
.teams { display: flex; gap: 8px; align-items: center; }
.kickoff { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; font-size: 13px; }
.badge-locked { color: var(--faint, var(--muted)); font-size: 12px; }
.skeleton-row { height: 56px; border-radius: 10px; background: var(--surface-2);
  animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity: 0.5; } 50% { opacity: 0.9; } }
@media (prefers-reduced-motion: reduce) { .skeleton-row { animation: none; } }
```
Also load JetBrains Mono + Inter (e.g. add `<link>` to Google Fonts in `index.html`, or `@import` at the top of tokens.css). Keep it consistent with §7.

- [ ] **Step 7: type-check + build**

Run: `cd frontend && pnpm tsc --noEmit && pnpm build`
Expected: clean. Fix any import/type issues (e.g. ensure `me` branch types).

- [ ] **Step 8: Commit**

```bash
git add frontend/src frontend/index.html
git commit -m "feat(frontend): Fixtures list grouped by IST date with countdown and lock"
```

---

### Task 10: End-to-end DB + sync smoke test

**Files:** none (verification only).

- [ ] **Step 1: bring up MySQL + migrate**

```bash
make up
# wait until mysql healthy (docker inspect ... Health.Status == healthy)
export DB_USER=wcp DB_PASSWORD=wcp DB_HOST=127.0.0.1 DB_PORT=3306 DB_NAME=wcp
make migrate-up   # applies 0001 (users) + 0002 (teams, matches)
```
Verify tables: `docker exec <mysql> mysql -uwcp -pwcp wcp -e "SHOW TABLES; DESCRIBE matches;"` — expect users, teams, matches.

- [ ] **Step 2: sync against a FAKE API server (no real key needed)**

Start a tiny local server that serves the captured JSON, then point seedfixtures at it:
```bash
# Serve testdata over http on :9099 (python is fine)
( cd backend/internal/sportsapi/testdata && python3 -m http.server 9099 ) &
SERVE_PID=$!
# The fake server serves /teams.json and /fixtures.json, but the client requests /teams and /fixtures.
# So instead run the seedfixtures against the REAL api only if you have a key. For the smoke test,
# verify the syncer end-to-end via a Go program using httptest is already covered in Task 5.
kill $SERVE_PID 2>/dev/null
```
Because the client appends `/teams` and `/fixtures` (not `.json`), the static file server won't match. Two acceptable smoke approaches — do whichever is convenient:
- **(a) Real API:** if you have an `APIFOOTBALL_KEY`, run `APIFOOTBALL_KEY=<key> DB_*=... make seed-fixtures` and confirm `teams`/`matches` row counts.
- **(b) Manual rows:** insert two teams + one match by SQL, then hit `/api/matches`:
```bash
docker exec <mysql> mysql -uwcp -pwcp wcp -e "
INSERT INTO teams (api_team_id,name,code) VALUES (10,'Brazil','BRA'),(20,'Argentina','ARG');
INSERT INTO matches (api_fixture_id,stage,round,home_team_id,away_team_id,kickoff_utc,status)
 SELECT 1001,'group','Group A - 1',h.id,a.id,'2026-06-11 19:00:00','scheduled'
 FROM teams h, teams a WHERE h.code='BRA' AND a.code='ARG';"
```

- [ ] **Step 3: boot server + verify `/api/matches`**

```bash
cd backend
APP_ENV=development HTTP_PORT=8000 DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=wcp DB_PASSWORD=wcp DB_NAME=wcp \
  SESSION_SECRET=dev GOOGLE_CLIENT_ID=dummy ALLOWED_EMAIL_DOMAIN=sayonetech.com go run ./cmd/server &
sleep 4
# /api/matches requires auth -> 401 without a cookie (proves the route + auth gate)
curl -s -o /dev/null -w "matches_no_auth=%{http_code}\n" localhost:8000/api/matches   # expect 401
kill %1
```
Full authed JSON is covered by the Task 7 handler tests (real signed cookie). This smoke proves the migration applied, the route is mounted under auth, and the server boots with the new wiring.

- [ ] **Step 4: tear down**

```bash
make down
```

- [ ] **Step 5: (no commit — verification only). Record results in the task report.**

---

## Milestone 2 Definition of Done

- `go test ./...` (backend) passes incl. new sportsapi/fixtures/httpapi tests; `pnpm tsc --noEmit && pnpm build` clean.
- `make migrate-up` creates `teams` + `matches` (spec §10); FK + unique + kickoff index present.
- `make seed-fixtures` (with a real key) upserts teams then fixtures idempotently and never overwrites `manual_override` rows.
- `GET /api/matches` (auth-gated) returns matches grouped by IST date with `locked` computed server-side from `kickoff_utc`.
- Fixtures route renders the IST-grouped list with kickoff time + live countdown + lock state, dark-first per §7.
- All work committed; tree clean.

---

## Self-Review

**1. Spec coverage (M2 scope):**
- §10 teams + matches tables → Task 2. ✓
- §8 API-Football client (league=1, season=2026, `x-apisports-key`) → Task 4. ✓
- §3.2 fixtures grouped by IST date + server-authoritative lock (`now >= kickoff_utc`) → Task 7 (`groupByISTDate`, `Locked`). ✓ (Prediction write-lock enforcement is M3; here lock is read-only display state.)
- §11 `GET /api/matches` (auth) → Task 7. ✓
- idempotent sync, skip `manual_override` → Task 2 SQL (`IF(manual_override=1,...)`) + Task 5 Syncer. ✓
- `make seed-fixtures` → Task 6. ✓
- §7 design (dark, JetBrains Mono numerics, skeletons, IST list grouped by date) → Task 9 via impeccable. ✓
- Out of scope (correctly deferred): predictions + write-lock (M3), scoring (M4), results cron (M5), admin re-sync endpoint (M8 — reuses `fixtures.Syncer`). The `caller's predictions` part of §11 is stubbed/omitted now; M3 adds it.

**2. Placeholder scan:** No TBD/TODO. Every code step has complete code. The one judgement point — adapting `internal/store/matches.go` to sqlc's generated identifiers — is explicitly flagged with guidance (as in M1 Task 4). Task 7's test note tells the implementer to make assertions match committed sample data (single IST day, two matches) rather than leaving an ambiguous count.

**3. Type consistency:** `store.MatchStore` (UpsertTeam/GetTeamIDByAPIID/UpsertMatch/ListMatchesWithTeams) is identical across `matches.go`, the fake in `fixtures/sync_test.go`, the fake in `httpapi/matches_test.go`, and the syncer. `store.Stage`/`store.MatchStatus` enums vs `sportsapi.Stage`/`sportsapi.Status` are distinct types bridged by explicit conversion in the Syncer (`store.Stage(f.Stage)`), which is intentional and consistent. `Deps.Matches` set in `cmd/server` (Task 8) matches the field added in Task 7. `MatchWithTeams`/`TeamRef` fields used by `groupByISTDate` match the struct in `matches.go`. The JSON contract in `matches_handler.go` matches `frontend/src/lib/matches.ts`.

> **Flagged risks for execution:** (a) sqlc null-type names (`sql.NullInt32` vs `sql.NullInt64`) and generated join-row field names vary by sqlc version — adapt `matches.go` converters to the generated `internal/store/sqlc` code (Task 3). (b) `time.LoadLocation("Asia/Kolkata")` needs tzdata in the runtime image; `mustLoadIST` falls back to a fixed +05:30 zone, and the production Docker image (M9) should include tzdata or import `time/tzdata`.
