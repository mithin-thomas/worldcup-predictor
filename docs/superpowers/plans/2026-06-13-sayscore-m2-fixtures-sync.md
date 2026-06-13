# SayScore — Milestone 2 (revised): Static Fixtures Seed + IST Fixtures List

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed the 48 teams, 16 venues, 7 stages, and 104 World Cup 2026 matches from a committed static CSV dataset (`data/*.csv`) into MySQL — normalizing venue-local kickoff times to UTC — and serve them via `GET /api/matches` grouped by IST date with group + venue, rendered as a mobile-first Fixtures list.

**Architecture:** A new `internal/importer` package owns pure CSV parsing + the venue-local→UTC normalization + the stage mapping (no DB import). An idempotent `Importer` upserts venues → teams → matches into the store (resolving CSV source ids, leaving knockout-placeholder team refs NULL, never clobbering `manual_override` rows). `cmd/seedfixtures` runs it over a configurable data dir. The live-API path from the earlier M2 attempt (`internal/sportsapi`, `internal/fixtures`, `APIFOOTBALL_*` config) is **removed**. `GET /api/matches` (kept) gains group + venue. The Fixtures frontend route shows group, venue, and placeholder labels.

**Tech Stack:** Go 1.26 (stdlib `encoding/csv`, `time`), chi, sqlc, golang-migrate, MySQL 8; React 18 + TS + Vite, TanStack Query, dark §7 tokens. No external API, no API keys.

**Spec references:** §3.2 (fixtures grouped by IST, server-authoritative lock), §10 (teams, matches; venues are a documented extension), §11 (`GET /api/matches`), §7 (design). Supersedes the API-Football M2 attempt on `feat/m2-fixtures-sync`.

**Why static:** the WC 2026 schedule is fixed; a live API adds a paid plan + rate limits + a runtime dependency for no benefit. Rare corrections go through the admin dashboard (M8) via the `manual_override` flag.

---

## The dataset (`data/`, committed)

- `teams.csv` — `id,team_name,fifa_code,group_letter,is_placeholder` (48; `is_placeholder` `True`/`False`; 6 placeholders).
- `host_cities.csv` — `id,city_name,country,venue_name,region_cluster,airport_code` (16 venues).
- `tournament_stages.csv` — `id,stage_name,stage_order` (7: Group Stage … Final).
- `matches.csv` — `id,match_number,home_team_id,away_team_id,city_id,stage_id,kickoff_at,match_label` (104). Knockout placeholders have **empty** `home_team_id`/`away_team_id` and a label like `W73 vs W75`; group matches label like `Group A`. `kickoff_at` is **venue-local ISO 8601 with offset**, e.g. `2026-06-11 15:00:00-06` (offsets `-04/-05/-06/-07`). Parse with Go layout `2006-01-02 15:04:05-07` then `.UTC()`.

`worldcup2026.db` (binary, redundant) is **not** committed — gitignored.

---

## File Structure (Milestone 2, revised)

**Remove**
- `backend/internal/sportsapi/` (whole package), `backend/internal/fixtures/` (API syncer), and `APIFootball*` from `config.go`/`config_test.go`/`.env.example`/`deploy/docker-compose.yml`.

**Backend — new / changed**
- `data/*.csv` — committed seed; `data/worldcup2026.db` gitignored.
- `backend/migrations/0002_create_teams_and_matches.{up,down}.sql` — REVISED: venues + teams + matches (new shape).
- `backend/internal/store/queries/{venues,teams,matches}.sql` — REVISED queries.
- `backend/internal/store/sqlc/` — regenerated.
- `backend/internal/store/matches.go` — REVISED: domain types + `SeedStore`/`MatchStore` interface + adapters.
- `backend/internal/importer/types.go` — domain rows (`TeamRow`,`VenueRow`,`MatchRow`).
- `backend/internal/importer/parse.go` — pure CSV parse + `parseKickoffUTC` + `stageFromID` + `parseBool`.
- `backend/internal/importer/parse_test.go` — pure-function tests.
- `backend/internal/importer/importer.go` — `Importer{Store}` + `Run(dir)`.
- `backend/internal/importer/importer_test.go` — fake store + tiny-CSV integration.
- `backend/internal/config/config.go` — REMOVE APIFootball*, ADD `SeedDataDir`.
- `backend/cmd/seedfixtures/main.go` — REPOINT to the importer.
- `backend/internal/httpapi/matches_handler.go` + `matches_test.go` — add group + venue to the DTO.
- `backend/internal/httpapi/openapi.yaml` — extend `/api/matches` schema.

**Frontend**
- `frontend/src/lib/matches.ts` — add `group`, `venue` to types.
- `frontend/src/components/MatchRow.tsx` — show group + venue; handle null teams (use `match_label`).
- `frontend/src/routes/Fixtures.tsx` — unchanged structure (uses MatchRow).

> **Design-skill note:** the Fixtures changes (Task 9) use the **`impeccable`** skill against §7. Backend tasks are hand-coded Go.

---

## Conventions

Backend cmds from `backend/`; frontend from `frontend/`. Lefthook hooks are **active** — Conventional Commits required; `gofmt`/`go vet` run on commit. TDD: failing test → RED → implement → GREEN → commit. sqlc generated identifiers are authoritative — adapt adapters to `internal/store/sqlc/*`. Never stage `.claude/`, `node_modules/`, `dist/`, or `data/worldcup2026.db`.

---

### Task 1: Revise schema (venues + teams + matches) + sqlc

**Files:**
- Modify: `backend/migrations/0002_create_teams_and_matches.up.sql`, `.down.sql`
- Create: `backend/internal/store/queries/venues.sql`
- Modify: `backend/internal/store/queries/teams.sql`, `backend/internal/store/queries/matches.sql`
- Regenerate: `backend/internal/store/sqlc/`

- [ ] **Step 1: Rewrite `0002_create_teams_and_matches.up.sql`**

```sql
CREATE TABLE venues (
    id             BIGINT       NOT NULL AUTO_INCREMENT,
    source_id      BIGINT       NOT NULL,
    city_name      VARCHAR(128) NOT NULL,
    country        VARCHAR(64)  NOT NULL DEFAULT '',
    venue_name     VARCHAR(128) NOT NULL DEFAULT '',
    region_cluster VARCHAR(64)  NOT NULL DEFAULT '',
    airport_code   VARCHAR(8)   NOT NULL DEFAULT '',
    PRIMARY KEY (id),
    UNIQUE KEY uq_venues_source_id (source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE teams (
    id             BIGINT       NOT NULL AUTO_INCREMENT,
    source_id      BIGINT       NOT NULL,
    name           VARCHAR(128) NOT NULL,
    code           VARCHAR(8)   NOT NULL DEFAULT '',
    group_letter   VARCHAR(4)   NOT NULL DEFAULT '',
    is_placeholder BOOL         NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_teams_source_id (source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE matches (
    id                     BIGINT       NOT NULL AUTO_INCREMENT,
    source_id              BIGINT       NOT NULL,
    match_number           INT          NOT NULL DEFAULT 0,
    stage                  ENUM('group','knockout') NOT NULL DEFAULT 'group',
    round                  VARCHAR(64)  NOT NULL DEFAULT '',
    group_letter           VARCHAR(4)   NOT NULL DEFAULT '',
    match_label            VARCHAR(64)  NOT NULL DEFAULT '',
    home_team_id           BIGINT       NULL,
    away_team_id           BIGINT       NULL,
    venue_id               BIGINT       NULL,
    kickoff_utc            DATETIME     NOT NULL,
    status                 ENUM('scheduled','live','final') NOT NULL DEFAULT 'scheduled',
    home_score             INT          NULL,
    away_score             INT          NULL,
    went_to_penalties      BOOL         NOT NULL DEFAULT 0,
    penalty_winner_team_id BIGINT       NULL,
    manual_override        BOOL         NOT NULL DEFAULT 0,
    updated_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_matches_source_id (source_id),
    KEY idx_matches_kickoff (kickoff_utc),
    CONSTRAINT fk_matches_home  FOREIGN KEY (home_team_id) REFERENCES teams (id),
    CONSTRAINT fk_matches_away  FOREIGN KEY (away_team_id) REFERENCES teams (id),
    CONSTRAINT fk_matches_venue FOREIGN KEY (venue_id)     REFERENCES venues (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 2: Rewrite `0002_create_teams_and_matches.down.sql`**

```sql
DROP TABLE IF EXISTS matches;
DROP TABLE IF EXISTS teams;
DROP TABLE IF EXISTS venues;
```

- [ ] **Step 3: Write `internal/store/queries/venues.sql`**

```sql
-- name: UpsertVenue :exec
INSERT INTO venues (source_id, city_name, country, venue_name, region_cluster, airport_code)
VALUES (?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
    city_name = VALUES(city_name), country = VALUES(country),
    venue_name = VALUES(venue_name), region_cluster = VALUES(region_cluster),
    airport_code = VALUES(airport_code);

-- name: GetVenueIDBySourceID :one
SELECT id FROM venues WHERE source_id = ?;
```

- [ ] **Step 4: Rewrite `internal/store/queries/teams.sql`**

```sql
-- name: UpsertTeam :exec
INSERT INTO teams (source_id, name, code, group_letter, is_placeholder)
VALUES (?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
    name = VALUES(name), code = VALUES(code),
    group_letter = VALUES(group_letter), is_placeholder = VALUES(is_placeholder);

-- name: GetTeamIDBySourceID :one
SELECT id FROM teams WHERE source_id = ?;
```

- [ ] **Step 5: Rewrite `internal/store/queries/matches.sql`**

The upsert never overwrites `manual_override` rows (guarded with `IF(manual_override=1,…)`).

```sql
-- name: UpsertMatch :exec
INSERT INTO matches (
    source_id, match_number, stage, round, group_letter, match_label,
    home_team_id, away_team_id, venue_id, kickoff_utc, status
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
    match_number = IF(manual_override=1, match_number, VALUES(match_number)),
    stage        = IF(manual_override=1, stage, VALUES(stage)),
    round        = IF(manual_override=1, round, VALUES(round)),
    group_letter = IF(manual_override=1, group_letter, VALUES(group_letter)),
    match_label  = IF(manual_override=1, match_label, VALUES(match_label)),
    home_team_id = IF(manual_override=1, home_team_id, VALUES(home_team_id)),
    away_team_id = IF(manual_override=1, away_team_id, VALUES(away_team_id)),
    venue_id     = IF(manual_override=1, venue_id, VALUES(venue_id)),
    kickoff_utc  = IF(manual_override=1, kickoff_utc, VALUES(kickoff_utc)),
    status       = IF(manual_override=1, status, VALUES(status));

-- name: ListMatchesWithTeams :many
SELECT
    m.id, m.source_id, m.match_number, m.stage, m.round, m.group_letter, m.match_label,
    m.kickoff_utc, m.status, m.home_score, m.away_score,
    m.went_to_penalties, m.penalty_winner_team_id, m.manual_override,
    m.home_team_id, ht.name AS home_name, ht.code AS home_code,
    m.away_team_id, at.name AS away_name, at.code AS away_code,
    m.venue_id, v.venue_name AS venue_name, v.city_name AS venue_city, v.country AS venue_country
FROM matches m
LEFT JOIN teams ht ON ht.id = m.home_team_id
LEFT JOIN teams at ON at.id = m.away_team_id
LEFT JOIN venues v ON v.id = m.venue_id
ORDER BY m.kickoff_utc, m.match_number;
```

- [ ] **Step 6: Regenerate sqlc + build**

```bash
cd backend
export PATH="$PATH:$(go env GOPATH)/bin"
sqlc generate
go build ./... 2>&1 | head   # store/matches.go + httpapi will fail to compile until later tasks — expected
```
READ the generated `internal/store/sqlc/models.go` + `*.sql.go` to learn the exact identifiers (e.g. `KickoffUtc`, `MatchesStage`, `sql.NullInt64` for nullable FKs, `ListMatchesWithTeamsRow` field names like `HomeName`/`VenueCity`). You'll adapt the store adapter in Task 3. If `sqlc generate` errors, report BLOCKED with the exact message.

- [ ] **Step 7: Commit** (sqlc-diff hook will pass since generated code is fresh)

```bash
git add backend/migrations backend/internal/store/queries backend/internal/store/sqlc
git commit -m "feat(store): static-dataset schema (venues, teams+group, matches+venue)"
```

---

### Task 2: Importer pure functions (CSV parse, offset→UTC, stage map)

**Files:**
- Create: `backend/internal/importer/types.go`
- Create: `backend/internal/importer/parse.go`
- Create: `backend/internal/importer/parse_test.go`

- [ ] **Step 1: Domain row types — `internal/importer/types.go`**

```go
// Package importer parses the committed World Cup CSV dataset and seeds it into
// the store. Parsing is pure (no DB, no clock); the Importer does the I/O.
package importer

import "time"

type VenueRow struct {
	SourceID                                          int64
	CityName, Country, VenueName, RegionCluster, Code string // Code = airport_code
}

type TeamRow struct {
	SourceID      int64
	Name          string
	FifaCode      string
	GroupLetter   string
	IsPlaceholder bool
}

type Stage string

const (
	StageGroup    Stage = "group"
	StageKnockout Stage = "knockout"
)

type MatchRow struct {
	SourceID     int64
	MatchNumber  int
	HomeTeamID   *int64 // nil for knockout placeholders
	AwayTeamID   *int64
	VenueID      *int64
	StageID      int64
	Stage        Stage
	Round        string // resolved from stages by the Importer
	GroupLetter  string // letter for group matches, else ""
	MatchLabel   string
	KickoffUTC   time.Time
}

type StageRow struct {
	SourceID int64
	Name     string
	Order    int
}
```

- [ ] **Step 2: Failing tests — `internal/importer/parse_test.go`**

```go
package importer

import (
	"strings"
	"testing"
	"time"
)

func TestParseKickoffUTC(t *testing.T) {
	cases := map[string]string{
		"2026-06-11 15:00:00-06": "2026-06-11T21:00:00Z", // -06 -> +6h
		"2026-06-24 15:00:00-07": "2026-06-24T22:00:00Z",
		"2026-07-04 13:00:00-05": "2026-07-04T18:00:00Z",
		"2026-07-19 15:00:00-04": "2026-07-19T19:00:00Z",
	}
	for in, want := range cases {
		got, err := parseKickoffUTC(in)
		if err != nil {
			t.Fatalf("parseKickoffUTC(%q) err = %v", in, err)
		}
		if got.Format(time.RFC3339) != want {
			t.Errorf("parseKickoffUTC(%q) = %s, want %s", in, got.Format(time.RFC3339), want)
		}
		if got.Location() != time.UTC {
			t.Errorf("parseKickoffUTC(%q) not in UTC", in)
		}
	}
	if _, err := parseKickoffUTC("not-a-time"); err == nil {
		t.Error("expected error for bad timestamp")
	}
}

func TestStageFromID(t *testing.T) {
	if stageFromID(1) != StageGroup {
		t.Errorf("stage 1 should be group")
	}
	for _, id := range []int64{2, 3, 4, 5, 6, 7} {
		if stageFromID(id) != StageKnockout {
			t.Errorf("stage %d should be knockout", id)
		}
	}
}

func TestParseBool(t *testing.T) {
	for _, s := range []string{"True", "true", "TRUE", "1"} {
		if !parseBool(s) {
			t.Errorf("parseBool(%q) = false, want true", s)
		}
	}
	for _, s := range []string{"False", "false", "0", ""} {
		if parseBool(s) {
			t.Errorf("parseBool(%q) = true, want false", s)
		}
	}
}

func TestParseTeams(t *testing.T) {
	csv := "id,team_name,fifa_code,group_letter,is_placeholder\n" +
		"1,Mexico,MEX,A,False\n" +
		"47,Playoff Winner,TBD,,True\n"
	teams, err := parseTeams(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("parseTeams err = %v", err)
	}
	if len(teams) != 2 {
		t.Fatalf("got %d teams, want 2", len(teams))
	}
	if teams[0].SourceID != 1 || teams[0].Name != "Mexico" || teams[0].FifaCode != "MEX" || teams[0].GroupLetter != "A" || teams[0].IsPlaceholder {
		t.Errorf("team0 = %+v", teams[0])
	}
	if !teams[1].IsPlaceholder {
		t.Errorf("team1 should be placeholder: %+v", teams[1])
	}
}

func TestParseVenues(t *testing.T) {
	csv := "id,city_name,country,venue_name,region_cluster,airport_code\n" +
		"15,Mexico City,Mexico,Estadio Azteca,Central,MEX\n"
	vs, err := parseVenues(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("parseVenues err = %v", err)
	}
	if len(vs) != 1 || vs[0].SourceID != 15 || vs[0].VenueName != "Estadio Azteca" || vs[0].CityName != "Mexico City" {
		t.Errorf("venues = %+v", vs)
	}
}

func TestParseStages(t *testing.T) {
	csv := "id,stage_name,stage_order\n1,Group Stage,1\n3,Round of 16,3\n"
	st, err := parseStages(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("parseStages err = %v", err)
	}
	if st[1] != "Group Stage" || st[3] != "Round of 16" {
		t.Errorf("stages map = %+v", st)
	}
}

func TestParseMatchesHandlesPlaceholdersAndGroup(t *testing.T) {
	stages := map[int64]string{1: "Group Stage", 3: "Round of 16"}
	csv := "id,match_number,home_team_id,away_team_id,city_id,stage_id,kickoff_at,match_label\n" +
		"1,1,1,2,15,1,2026-06-11 15:00:00-06,Group A\n" +
		"89,89,,,4,3,2026-07-04 13:00:00-05,W73 vs W75\n"
	ms, err := parseMatches(strings.NewReader(csv), stages)
	if err != nil {
		t.Fatalf("parseMatches err = %v", err)
	}
	if len(ms) != 2 {
		t.Fatalf("got %d matches, want 2", len(ms))
	}
	// group match: teams + venue set, stage group, group letter from label, round from stages
	g := ms[0]
	if g.HomeTeamID == nil || *g.HomeTeamID != 1 || g.AwayTeamID == nil || *g.AwayTeamID != 2 {
		t.Errorf("group match teams = %+v", g)
	}
	if g.VenueID == nil || *g.VenueID != 15 || g.Stage != StageGroup || g.Round != "Group Stage" || g.GroupLetter != "A" {
		t.Errorf("group match fields = %+v", g)
	}
	if g.KickoffUTC.Format(time.RFC3339) != "2026-06-11T21:00:00Z" {
		t.Errorf("group kickoff = %s", g.KickoffUTC.Format(time.RFC3339))
	}
	// knockout placeholder: nil teams, knockout stage, no group letter, label kept
	k := ms[1]
	if k.HomeTeamID != nil || k.AwayTeamID != nil {
		t.Errorf("placeholder teams should be nil: %+v", k)
	}
	if k.Stage != StageKnockout || k.GroupLetter != "" || k.MatchLabel != "W73 vs W75" || k.Round != "Round of 16" {
		t.Errorf("knockout fields = %+v", k)
	}
}
```

- [ ] **Step 3: Run → FAIL**

Run: `cd backend && go test ./internal/importer/ -v`
Expected: build failure — functions undefined.

- [ ] **Step 4: Implement `internal/importer/parse.go`**

```go
package importer

import (
	"encoding/csv"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
)

const kickoffLayout = "2006-01-02 15:04:05-07"

func parseKickoffUTC(s string) (time.Time, error) {
	t, err := time.Parse(kickoffLayout, strings.TrimSpace(s))
	if err != nil {
		return time.Time{}, fmt.Errorf("importer: bad kickoff %q: %w", s, err)
	}
	return t.UTC(), nil
}

func stageFromID(stageID int64) Stage {
	if stageID == 1 {
		return StageGroup
	}
	return StageKnockout
}

func parseBool(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "true", "1", "yes":
		return true
	default:
		return false
	}
}

// groupLetterFromLabel extracts "A" from "Group A"; "" for non-group labels.
func groupLetterFromLabel(label string, stage Stage) string {
	if stage != StageGroup {
		return ""
	}
	if f := strings.Fields(strings.TrimSpace(label)); len(f) == 2 && strings.EqualFold(f[0], "group") {
		return f[1]
	}
	return ""
}

// readCSV returns the data rows (header skipped) from r.
func readCSV(r io.Reader) ([][]string, error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1 // tolerate ragged rows (empty trailing fields)
	rows, err := cr.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("importer: read csv: %w", err)
	}
	if len(rows) <= 1 {
		return nil, nil
	}
	return rows[1:], nil
}

func atoi64(s string) int64 { n, _ := strconv.ParseInt(strings.TrimSpace(s), 10, 64); return n }
func atoi(s string) int     { n, _ := strconv.Atoi(strings.TrimSpace(s)); return n }

// optID returns nil for an empty cell, else &id.
func optID(s string) *int64 {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	v := atoi64(s)
	return &v
}

func parseVenues(r io.Reader) ([]VenueRow, error) {
	rows, err := readCSV(r)
	if err != nil {
		return nil, err
	}
	out := make([]VenueRow, 0, len(rows))
	for _, c := range rows { // id,city_name,country,venue_name,region_cluster,airport_code
		out = append(out, VenueRow{
			SourceID: atoi64(c[0]), CityName: c[1], Country: c[2],
			VenueName: c[3], RegionCluster: c[4], Code: c[5],
		})
	}
	return out, nil
}

func parseTeams(r io.Reader) ([]TeamRow, error) {
	rows, err := readCSV(r)
	if err != nil {
		return nil, err
	}
	out := make([]TeamRow, 0, len(rows))
	for _, c := range rows { // id,team_name,fifa_code,group_letter,is_placeholder
		out = append(out, TeamRow{
			SourceID: atoi64(c[0]), Name: c[1], FifaCode: c[2],
			GroupLetter: c[3], IsPlaceholder: parseBool(c[4]),
		})
	}
	return out, nil
}

func parseStages(r io.Reader) (map[int64]string, error) {
	rows, err := readCSV(r)
	if err != nil {
		return nil, err
	}
	out := make(map[int64]string, len(rows))
	for _, c := range rows { // id,stage_name,stage_order
		out[atoi64(c[0])] = c[1]
	}
	return out, nil
}

func parseMatches(r io.Reader, stages map[int64]string) ([]MatchRow, error) {
	rows, err := readCSV(r)
	if err != nil {
		return nil, err
	}
	out := make([]MatchRow, 0, len(rows))
	for _, c := range rows { // id,match_number,home_team_id,away_team_id,city_id,stage_id,kickoff_at,match_label
		ko, err := parseKickoffUTC(c[6])
		if err != nil {
			return nil, err
		}
		stageID := atoi64(c[5])
		stage := stageFromID(stageID)
		out = append(out, MatchRow{
			SourceID:    atoi64(c[0]),
			MatchNumber: atoi(c[1]),
			HomeTeamID:  optID(c[2]),
			AwayTeamID:  optID(c[3]),
			VenueID:     optID(c[4]),
			StageID:     stageID,
			Stage:       stage,
			Round:       stages[stageID],
			GroupLetter: groupLetterFromLabel(c[7], stage),
			MatchLabel:  c[7],
			KickoffUTC:  ko,
		})
	}
	return out, nil
}
```

- [ ] **Step 5: Run → PASS**

Run: `cd backend && go test ./internal/importer/ -v`
Expected: all parse tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/importer/types.go backend/internal/importer/parse.go backend/internal/importer/parse_test.go
git commit -m "feat(importer): pure CSV parsing, venue-local->UTC, stage mapping"
```

---

### Task 3: Store — SeedStore interface + adapters

**Files:**
- Modify (replace contents): `backend/internal/store/matches.go`

- [ ] **Step 1: Replace `internal/store/matches.go`**

Adapt every `sqlc.*` reference to the identifiers generated in Task 1 (nullable FKs are `sql.NullInt64`; the list-row fields follow the `AS` aliases, e.g. `HomeName`, `VenueCity`).

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

type UpsertVenueParams struct {
	SourceID                                          int64
	CityName, Country, VenueName, RegionCluster, Code string
}

type UpsertTeamParams struct {
	SourceID      int64
	Name          string
	Code          string
	GroupLetter   string
	IsPlaceholder bool
}

type UpsertMatchParams struct {
	SourceID    int64
	MatchNumber int32
	Stage       Stage
	Round       string
	GroupLetter string
	MatchLabel  string
	HomeTeamID  *int64
	AwayTeamID  *int64
	VenueID     *int64
	KickoffUTC  time.Time
	Status      MatchStatus
}

type TeamRef struct {
	ID   int64
	Name string
	Code string
}

type VenueRef struct {
	Name    string
	City    string
	Country string
}

type MatchWithTeams struct {
	ID             int64
	MatchNumber    int32
	Stage          Stage
	Round          string
	GroupLetter    string
	MatchLabel     string
	KickoffUTC     time.Time
	Status         MatchStatus
	HomeScore      *int32
	AwayScore      *int32
	WentToPens     bool
	ManualOverride bool
	Home           *TeamRef // nil for placeholder
	Away           *TeamRef
	Venue          *VenueRef
}

// SeedStore is the importer's write surface; MatchStore is the read surface.
type SeedStore interface {
	UpsertVenue(ctx context.Context, p UpsertVenueParams) error
	UpsertTeam(ctx context.Context, p UpsertTeamParams) error
	UpsertMatch(ctx context.Context, p UpsertMatchParams) error
	GetVenueIDBySourceID(ctx context.Context, sourceID int64) (int64, error)
	GetTeamIDBySourceID(ctx context.Context, sourceID int64) (int64, error)
}

type MatchStore interface {
	ListMatchesWithTeams(ctx context.Context) ([]MatchWithTeams, error)
}

var (
	_ SeedStore  = (*SQLStore)(nil)
	_ MatchStore = (*SQLStore)(nil)
)

func nullI64(p *int64) sql.NullInt64 {
	if p == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: *p, Valid: true}
}

func (s *SQLStore) UpsertVenue(ctx context.Context, p UpsertVenueParams) error {
	if err := s.q.UpsertVenue(ctx, sqlcUpsertVenueParams(p)); err != nil {
		return fmt.Errorf("store: upsert venue: %w", err)
	}
	return nil
}

func (s *SQLStore) UpsertTeam(ctx context.Context, p UpsertTeamParams) error {
	if err := s.q.UpsertTeam(ctx, sqlcUpsertTeamParams(p)); err != nil {
		return fmt.Errorf("store: upsert team: %w", err)
	}
	return nil
}

func (s *SQLStore) UpsertMatch(ctx context.Context, p UpsertMatchParams) error {
	if err := s.q.UpsertMatch(ctx, sqlcUpsertMatchParams(p)); err != nil {
		return fmt.Errorf("store: upsert match: %w", err)
	}
	return nil
}

func (s *SQLStore) GetVenueIDBySourceID(ctx context.Context, sourceID int64) (int64, error) {
	return s.q.GetVenueIDBySourceID(ctx, sourceID)
}

func (s *SQLStore) GetTeamIDBySourceID(ctx context.Context, sourceID int64) (int64, error) {
	return s.q.GetTeamIDBySourceID(ctx, sourceID)
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
```

- [ ] **Step 2: Add the sqlc converters at the bottom of `matches.go`**

Write `sqlcUpsertVenueParams`, `sqlcUpsertTeamParams`, `sqlcUpsertMatchParams`, and `toMatchWithTeams` to bridge these domain structs and the **actual** generated `sqlc.*` types from Task 1. Guidance for the converters:
- `*int64` → `sql.NullInt64` via `nullI64`.
- `Stage`/`MatchStatus` → the generated enum types (e.g. `sqlc.MatchesStage(p.Stage)`).
- `MatchNumber int32` → the generated int type (`int32`).
- In `toMatchWithTeams`: a `sql.NullInt64` home/away/venue id that is `!Valid` → leave `Home`/`Away`/`Venue` nil; when valid, build the ref from the joined `*Name`/`*Code`/`*City` columns (which are `sql.NullString` under a LEFT JOIN — use `.String`). Map `home_score`/`away_score` (`sql.NullInt32`) to `*int32`.

Example shape (adjust names to generated code):

```go
func sqlcUpsertVenueParams(p UpsertVenueParams) sqlc.UpsertVenueParams {
	return sqlc.UpsertVenueParams{
		SourceID: p.SourceID, CityName: p.CityName, Country: p.Country,
		VenueName: p.VenueName, RegionCluster: p.RegionCluster, AirportCode: p.Code,
	}
}
// ... sqlcUpsertTeamParams, sqlcUpsertMatchParams, toMatchWithTeams similarly.
```

- [ ] **Step 3: Build**

Run: `cd backend && go build ./... 2>&1 | head` (httpapi/importer/cmd may still fail — that's later tasks; the `store` package itself must compile). Verify with: `go build ./internal/store/`.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/store/matches.go
git commit -m "feat(store): SeedStore/MatchStore for venues, teams, matches"
```

---

### Task 4: Importer orchestration

**Files:**
- Create: `backend/internal/importer/importer.go`
- Create: `backend/internal/importer/importer_test.go`

- [ ] **Step 1: Failing test — `internal/importer/importer_test.go`**

```go
package importer

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

type fakeStore struct {
	venuesBySrc map[int64]int64
	teamsBySrc  map[int64]int64
	matches     []store.UpsertMatchParams
}

func newFakeStore() *fakeStore {
	return &fakeStore{venuesBySrc: map[int64]int64{}, teamsBySrc: map[int64]int64{}}
}
func (f *fakeStore) UpsertVenue(_ context.Context, p store.UpsertVenueParams) error {
	if _, ok := f.venuesBySrc[p.SourceID]; !ok {
		f.venuesBySrc[p.SourceID] = int64(len(f.venuesBySrc) + 1)
	}
	return nil
}
func (f *fakeStore) UpsertTeam(_ context.Context, p store.UpsertTeamParams) error {
	if _, ok := f.teamsBySrc[p.SourceID]; !ok {
		f.teamsBySrc[p.SourceID] = int64(len(f.teamsBySrc) + 1)
	}
	return nil
}
func (f *fakeStore) UpsertMatch(_ context.Context, p store.UpsertMatchParams) error {
	f.matches = append(f.matches, p)
	return nil
}
func (f *fakeStore) GetVenueIDBySourceID(_ context.Context, s int64) (int64, error) {
	return f.venuesBySrc[s], nil
}
func (f *fakeStore) GetTeamIDBySourceID(_ context.Context, s int64) (int64, error) {
	return f.teamsBySrc[s], nil
}

func writeFixtures(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	write := func(name, body string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("teams.csv", "id,team_name,fifa_code,group_letter,is_placeholder\n1,Mexico,MEX,A,False\n2,South Africa,RSA,A,False\n")
	write("host_cities.csv", "id,city_name,country,venue_name,region_cluster,airport_code\n15,Mexico City,Mexico,Estadio Azteca,Central,MEX\n4,Houston,USA,NRG Stadium,Central,IAH\n")
	write("tournament_stages.csv", "id,stage_name,stage_order\n1,Group Stage,1\n3,Round of 16,3\n")
	write("matches.csv", "id,match_number,home_team_id,away_team_id,city_id,stage_id,kickoff_at,match_label\n"+
		"1,1,1,2,15,1,2026-06-11 15:00:00-06,Group A\n"+
		"89,89,,,4,3,2026-07-04 13:00:00-05,W73 vs W75\n")
	return dir
}

func TestImporterRunResolvesIDsAndNulls(t *testing.T) {
	dir := writeFixtures(t)
	fs := newFakeStore()
	res, err := (&Importer{Store: fs}).Run(context.Background(), dir)
	if err != nil {
		t.Fatalf("Run err = %v", err)
	}
	if res.Venues != 2 || res.Teams != 2 || res.Matches != 2 {
		t.Fatalf("result = %+v, want 2/2/2", res)
	}
	// group match: home/away resolved to internal ids; venue resolved
	g := fs.matches[0]
	if g.HomeTeamID == nil || g.AwayTeamID == nil || g.VenueID == nil {
		t.Errorf("group match refs should resolve: %+v", g)
	}
	if g.Stage != store.StageGroup || g.GroupLetter != "A" || g.Round != "Group Stage" {
		t.Errorf("group fields: %+v", g)
	}
	// placeholder: nil teams preserved
	k := fs.matches[1]
	if k.HomeTeamID != nil || k.AwayTeamID != nil {
		t.Errorf("placeholder teams should stay nil: %+v", k)
	}
	if k.Stage != store.StageKnockout || k.MatchLabel != "W73 vs W75" {
		t.Errorf("knockout fields: %+v", k)
	}
}

func TestImporterIsIdempotent(t *testing.T) {
	dir := writeFixtures(t)
	fs := newFakeStore()
	imp := &Importer{Store: fs}
	if _, err := imp.Run(context.Background(), dir); err != nil {
		t.Fatal(err)
	}
	if _, err := imp.Run(context.Background(), dir); err != nil {
		t.Fatal(err)
	}
	if len(fs.venuesBySrc) != 2 || len(fs.teamsBySrc) != 2 {
		t.Errorf("re-run grew refs: venues=%d teams=%d", len(fs.venuesBySrc), len(fs.teamsBySrc))
	}
}
```

- [ ] **Step 2: Run → FAIL**

Run: `cd backend && go test ./internal/importer/ -run TestImporter -v`
Expected: `Importer`/`Run`/`Result` undefined.

- [ ] **Step 3: Implement `internal/importer/importer.go`**

```go
package importer

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

type Importer struct {
	Store store.SeedStore
}

type Result struct {
	Venues  int
	Teams   int
	Matches int
}

// Run reads the CSV dataset in dir and upserts venues, teams, then matches.
// Idempotent: store upserts use ON DUPLICATE KEY and skip manual_override rows.
func (imp *Importer) Run(ctx context.Context, dir string) (Result, error) {
	venues, err := readFile(dir, "host_cities.csv", parseVenues)
	if err != nil {
		return Result{}, err
	}
	for _, v := range venues {
		if err := imp.Store.UpsertVenue(ctx, store.UpsertVenueParams{
			SourceID: v.SourceID, CityName: v.CityName, Country: v.Country,
			VenueName: v.VenueName, RegionCluster: v.RegionCluster, Code: v.Code,
		}); err != nil {
			return Result{}, err
		}
	}

	teams, err := readFile(dir, "teams.csv", parseTeams)
	if err != nil {
		return Result{}, err
	}
	for _, t := range teams {
		if err := imp.Store.UpsertTeam(ctx, store.UpsertTeamParams{
			SourceID: t.SourceID, Name: t.Name, Code: t.FifaCode,
			GroupLetter: t.GroupLetter, IsPlaceholder: t.IsPlaceholder,
		}); err != nil {
			return Result{}, err
		}
	}

	stages, err := readFile(dir, "tournament_stages.csv", parseStages)
	if err != nil {
		return Result{}, err
	}
	matches, err := readMatches(dir, stages)
	if err != nil {
		return Result{}, err
	}
	for _, m := range matches {
		home, err := imp.resolveTeam(ctx, m.HomeTeamID)
		if err != nil {
			return Result{}, err
		}
		away, err := imp.resolveTeam(ctx, m.AwayTeamID)
		if err != nil {
			return Result{}, err
		}
		venue, err := imp.resolveVenue(ctx, m.VenueID)
		if err != nil {
			return Result{}, err
		}
		if err := imp.Store.UpsertMatch(ctx, store.UpsertMatchParams{
			SourceID: m.SourceID, MatchNumber: int32(m.MatchNumber),
			Stage: store.Stage(m.Stage), Round: m.Round, GroupLetter: m.GroupLetter,
			MatchLabel: m.MatchLabel, HomeTeamID: home, AwayTeamID: away, VenueID: venue,
			KickoffUTC: m.KickoffUTC, Status: store.StatusScheduled,
		}); err != nil {
			return Result{}, err
		}
	}
	return Result{Venues: len(venues), Teams: len(teams), Matches: len(matches)}, nil
}

func (imp *Importer) resolveTeam(ctx context.Context, srcID *int64) (*int64, error) {
	if srcID == nil {
		return nil, nil
	}
	id, err := imp.Store.GetTeamIDBySourceID(ctx, *srcID)
	if err != nil {
		return nil, fmt.Errorf("importer: resolve team source %d: %w", *srcID, err)
	}
	return &id, nil
}

func (imp *Importer) resolveVenue(ctx context.Context, srcID *int64) (*int64, error) {
	if srcID == nil {
		return nil, nil
	}
	id, err := imp.Store.GetVenueIDBySourceID(ctx, *srcID)
	if err != nil {
		return nil, fmt.Errorf("importer: resolve venue source %d: %w", *srcID, err)
	}
	return &id, nil
}

func readFile[T any](dir, name string, parse func(r interface{ Read([]byte) (int, error) }) ([]T, error)) ([]T, error) {
	// (see note) — replaced by concrete helpers below; do not use generics here.
	return nil, nil
}
```

> **Implementation note:** Go's `io.Reader` + generics get awkward; use these concrete file helpers instead of the generic stub above (delete the stub):

```go
func openData(dir, name string) (*os.File, error) {
	f, err := os.Open(filepath.Join(dir, name))
	if err != nil {
		return nil, fmt.Errorf("importer: open %s: %w", name, err)
	}
	return f, nil
}

// Replace the three readFile(...) calls in Run with:
//   f, err := openData(dir, "host_cities.csv"); ... defer f.Close(); venues, err := parseVenues(f)
//   f, err := openData(dir, "teams.csv");       ... teams, err := parseTeams(f)
//   f, err := openData(dir, "tournament_stages.csv"); ... stages, err := parseStages(f)
// and a readMatches helper:
func readMatches(dir string, stages map[int64]string) ([]MatchRow, error) {
	f, err := openData(dir, "matches.csv")
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return parseMatches(f, stages)
}
```

Rewrite `Run` to open each file with `openData`, `defer f.Close()`, and pass `f` to the matching `parse*` function (remove the generic `readFile` entirely). Keep the venues→teams→matches order.

- [ ] **Step 4: Run → PASS**

Run: `cd backend && go test ./internal/importer/ -v`
Expected: all importer + parse tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/importer/importer.go backend/internal/importer/importer_test.go
git commit -m "feat(importer): idempotent venue/team/match seeding from CSV dir"
```

---

### Task 5: Config — drop API-Football, add SeedDataDir

**Files:**
- Modify: `backend/internal/config/config.go`, `config_test.go`
- Modify: `.env.example`

- [ ] **Step 1: Edit `config.go`** — remove the three `APIFootball*` fields and their loader lines; add `SeedDataDir`:

In the struct, replace the `APIFootball*` fields with:
```go
	SeedDataDir string
```
In `Load()`, replace the `APIFootball*` loader lines with:
```go
		SeedDataDir: getenv("SEED_DATA_DIR", "./data"),
```

- [ ] **Step 2: Update `config_test.go`** — delete `TestLoadAPIFootballDefaultsAndKey` (and any APIFootball assertions). Add:

```go
func TestLoadSeedDataDirDefault(t *testing.T) {
	t.Setenv("SESSION_SECRET", "secret")
	t.Setenv("GOOGLE_CLIENT_ID", "client-id")
	t.Setenv("SEED_DATA_DIR", "")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() err = %v", err)
	}
	if cfg.SeedDataDir != "./data" {
		t.Errorf("SeedDataDir default = %q, want ./data", cfg.SeedDataDir)
	}
}
```

- [ ] **Step 3: Update `.env.example`** — remove the `APIFOOTBALL_*` block; add under backend:
```dotenv
# Static fixtures dataset (committed CSVs). Override only if you move data/.
SEED_DATA_DIR=./data
```

- [ ] **Step 4: Run + build**

Run: `cd backend && go test ./internal/config/ -v && go build ./internal/config/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/config/config.go backend/internal/config/config_test.go .env.example
git commit -m "feat(config): replace API-Football settings with SEED_DATA_DIR"
```

---

### Task 6: Repoint `cmd/seedfixtures` + remove the API packages

**Files:**
- Modify: `backend/cmd/seedfixtures/main.go`
- Delete: `backend/internal/sportsapi/` (all), `backend/internal/fixtures/` (all)
- Modify: `deploy/docker-compose.yml` (drop any `APIFOOTBALL_*` from backend env, if present)

- [ ] **Step 1: Replace `backend/cmd/seedfixtures/main.go`**

```go
package main

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/config"
	"github.com/sayonetech/worldcup-predictor/backend/internal/importer"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"

	"github.com/joho/godotenv"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	_ = godotenv.Load() // load backend/.env in dev (matches cmd/server)

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

	logger.Info("seeding fixtures from CSV", "dir", cfg.SeedDataDir)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	res, err := (&importer.Importer{Store: store.New(db)}).Run(ctx, cfg.SeedDataDir)
	if err != nil {
		logger.Error("seed-fixtures failed", "err", err)
		os.Exit(1)
	}
	logger.Info("seed-fixtures complete", "venues", res.Venues, "teams", res.Teams, "matches", res.Matches)
}
```

- [ ] **Step 2: Delete the API packages**

```bash
git rm -r backend/internal/sportsapi backend/internal/fixtures
```

- [ ] **Step 3: Remove `APIFOOTBALL_*` from compose** (if present) — in `deploy/docker-compose.yml` `backend.environment`, delete any `APIFOOTBALL_*` lines. Add nothing (SEED_DATA_DIR defaults to `./data`, and the data dir is baked into the image — see Task 10 note).

- [ ] **Step 4: Build + vet + full test**

Run: `cd backend && go build ./... && go vet ./... && go test ./... -count=1 2>&1 | grep -E 'ok|FAIL'`
Expected: compiles; `importer`, `config`, `store` (no test files), `auth` pass. `httpapi` may fail until Task 7 — note it and proceed.

- [ ] **Step 5: Commit**

```bash
git add backend/cmd/seedfixtures/main.go deploy/docker-compose.yml
git commit -m "feat(cmd): seed from CSV importer; remove API-Football packages"
```

---

### Task 7: `GET /api/matches` — add group + venue + null-team handling

**Files:**
- Modify: `backend/internal/httpapi/matches_handler.go`, `matches_test.go`

- [ ] **Step 1: Replace the DTO + grouping in `matches_handler.go`**

Keep the IST location + injectable `now` (from `clock.go`). Replace the DTOs/handler with:

```go
type teamDTO struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Code string `json:"code"`
}

type venueDTO struct {
	Name    string `json:"name"`
	City    string `json:"city"`
	Country string `json:"country"`
}

type matchDTO struct {
	ID          int64     `json:"id"`
	MatchNumber int32     `json:"match_number"`
	Stage       string    `json:"stage"`
	Round       string    `json:"round"`
	Group       string    `json:"group"`       // letter, or "" for knockout
	Label       string    `json:"label"`       // e.g. "Group A" or "W73 vs W75"
	KickoffUTC  string    `json:"kickoff_utc"`
	KickoffIST  string    `json:"kickoff_ist"`
	Status      string    `json:"status"`
	Locked      bool      `json:"locked"`
	Home        *teamDTO  `json:"home"`        // null for placeholder
	Away        *teamDTO  `json:"away"`
	Venue       *venueDTO `json:"venue"`
	HomeScore   *int32    `json:"home_score"`
	AwayScore   *int32    `json:"away_score"`
}

type dayDTO struct {
	Date    string     `json:"date"`
	Matches []matchDTO `json:"matches"`
}

type matchesResponse struct {
	Days []dayDTO `json:"days"`
}

func (d *Deps) GetMatches(w http.ResponseWriter, r *http.Request) {
	rows, err := d.Matches.ListMatchesWithTeams(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load matches")
		return
	}
	writeJSON(w, http.StatusOK, matchesResponse{Days: groupByISTDate(rows, now())})
}

func teamDTOf(t *store.TeamRef) *teamDTO {
	if t == nil {
		return nil
	}
	return &teamDTO{ID: t.ID, Name: t.Name, Code: t.Code}
}

func groupByISTDate(rows []store.MatchWithTeams, nowUTC time.Time) []dayDTO {
	var days []dayDTO
	idx := map[string]int{}
	for _, m := range rows {
		k := m.KickoffUTC.In(ist)
		date := k.Format("2006-01-02")
		var venue *venueDTO
		if m.Venue != nil {
			venue = &venueDTO{Name: m.Venue.Name, City: m.Venue.City, Country: m.Venue.Country}
		}
		dto := matchDTO{
			ID: m.ID, MatchNumber: m.MatchNumber, Stage: string(m.Stage), Round: m.Round,
			Group: m.GroupLetter, Label: m.MatchLabel,
			KickoffUTC: m.KickoffUTC.UTC().Format(time.RFC3339),
			KickoffIST: k.Format(time.RFC3339),
			Status:     string(m.Status), Locked: !nowUTC.Before(m.KickoffUTC),
			Home: teamDTOf(m.Home), Away: teamDTOf(m.Away), Venue: venue,
			HomeScore: m.HomeScore, AwayScore: m.AwayScore,
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

- [ ] **Step 2: Update `matches_test.go`** — adjust the fake `MatchStore` + sample data to the new `MatchWithTeams` (pointers for `Home`/`Away`/`Venue`). Replace the existing matches test with:

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

type fakeMatchStore struct{ matches []store.MatchWithTeams }

func (f fakeMatchStore) ListMatchesWithTeams(context.Context) ([]store.MatchWithTeams, error) {
	return f.matches, nil
}

func authedMatchesDeps(t *testing.T, matches []store.MatchWithTeams) (*Deps, *http.Cookie) {
	t.Helper()
	fs := newFakeStore() // from auth_test.go
	u, _ := fs.UpsertUser(context.Background(), store.UpsertUserParams{Email: "dev@sayonetech.com"})
	sm := auth.NewSessionManager("test-secret")
	d := &Deps{Store: fs, Matches: fakeMatchStore{matches: matches}, Sessions: sm, AllowedEmailDomain: "sayonetech.com"}
	return d, &http.Cookie{Name: sessionCookieName, Value: sm.Encode(auth.Session{UserID: u.ID}, time.Hour)}
}

func TestGetMatchesRequiresAuth(t *testing.T) {
	d := &Deps{Matches: fakeMatchStore{}, Sessions: auth.NewSessionManager("test-secret")}
	rec := httptest.NewRecorder()
	NewRouter(d, false).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/matches", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestGetMatchesGroupVenueLockAndPlaceholder(t *testing.T) {
	fixedNow := time.Date(2026, 6, 12, 0, 0, 0, 0, time.UTC)
	old := now
	now = func() time.Time { return fixedNow }
	defer func() { now = old }()

	group := store.MatchWithTeams{
		ID: 1, MatchNumber: 1, Stage: store.StageGroup, Round: "Group Stage", GroupLetter: "A",
		MatchLabel: "Group A", KickoffUTC: time.Date(2026, 6, 11, 21, 0, 0, 0, time.UTC), Status: store.StatusScheduled,
		Home:  &store.TeamRef{ID: 1, Name: "Mexico", Code: "MEX"},
		Away:  &store.TeamRef{ID: 2, Name: "South Africa", Code: "RSA"},
		Venue: &store.VenueRef{Name: "Estadio Azteca", City: "Mexico City", Country: "Mexico"},
	}
	placeholder := store.MatchWithTeams{
		ID: 89, MatchNumber: 89, Stage: store.StageKnockout, Round: "Round of 16", MatchLabel: "W73 vs W75",
		KickoffUTC: time.Date(2026, 7, 4, 18, 0, 0, 0, time.UTC), Status: store.StatusScheduled,
		Venue: &store.VenueRef{Name: "NRG Stadium", City: "Houston", Country: "USA"},
	}

	d, cookie := authedMatchesDeps(t, []store.MatchWithTeams{group, placeholder})
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
	// group match kicked off 2026-06-11T21:00Z (before now) -> locked; IST date 2026-06-12
	// placeholder kicks off 2026-07-04 -> not locked; different IST day
	if len(resp.Days) != 2 {
		t.Fatalf("days = %d, want 2", len(resp.Days))
	}
	g := resp.Days[0].Matches[0]
	if g.Group != "A" || g.Venue == nil || g.Venue.Name != "Estadio Azteca" || g.Home == nil || g.Home.Code != "MEX" || !g.Locked {
		t.Errorf("group dto = %+v", g)
	}
	p := resp.Days[1].Matches[0]
	if p.Home != nil || p.Away != nil || p.Label != "W73 vs W75" || p.Locked {
		t.Errorf("placeholder dto = %+v", p)
	}
}
```

- [ ] **Step 3: Run → PASS; full build/test**

Run: `cd backend && go test ./... -count=1 2>&1 | grep -E 'ok|FAIL'`
Expected: all packages pass (auth, config, httpapi, importer).

- [ ] **Step 4: Commit**

```bash
git add backend/internal/httpapi/matches_handler.go backend/internal/httpapi/matches_test.go
git commit -m "feat(api): /api/matches returns group, venue, and placeholder labels"
```

---

### Task 8: Extend the OpenAPI spec

**Files:**
- Modify: `backend/internal/httpapi/openapi.yaml`

- [ ] **Step 1: Update the `Match`/`Team` schemas + add `Venue`** under `components.schemas` to match Task 7's DTO:

```yaml
    Team:
      type: object
      properties:
        id: { type: integer, format: int64 }
        name: { type: string }
        code: { type: string }
    Venue:
      type: object
      properties:
        name: { type: string }
        city: { type: string }
        country: { type: string }
    Match:
      type: object
      properties:
        id: { type: integer, format: int64 }
        match_number: { type: integer }
        stage: { type: string, enum: [group, knockout] }
        round: { type: string }
        group: { type: string, description: "Group letter for group matches, else empty" }
        label: { type: string, description: "e.g. 'Group A' or 'W73 vs W75'" }
        kickoff_utc: { type: string, format: date-time }
        kickoff_ist: { type: string, format: date-time }
        status: { type: string, enum: [scheduled, live, final] }
        locked: { type: boolean }
        home: { oneOf: [{ $ref: "#/components/schemas/Team" }, { type: "null" }] }
        away: { oneOf: [{ $ref: "#/components/schemas/Team" }, { type: "null" }] }
        venue: { oneOf: [{ $ref: "#/components/schemas/Venue" }, { type: "null" }] }
        home_score: { type: [integer, "null"], format: int32 }
        away_score: { type: [integer, "null"], format: int32 }
```

(The `Day`/`MatchesResponse` schemas from the prior spec stay; they reference `Match`.)

- [ ] **Step 2: Verify it still serves**

Run: `cd backend && go test ./internal/httpapi/ -run 'TestOpenAPI|TestDocs' -v 2>&1 | grep -E 'PASS|FAIL'`
Expected: PASS (embedded spec still served; contains `group`/`venue`).

- [ ] **Step 3: Commit**

```bash
git add backend/internal/httpapi/openapi.yaml
git commit -m "docs(api): document group/venue/label in /api/matches schema"
```

---

### Task 9: Frontend — show group + venue + placeholder labels (impeccable)

**Files:**
- Modify: `frontend/src/lib/matches.ts`, `frontend/src/components/MatchRow.tsx`

> **Invoke the `impeccable` design skill** for the row presentation, with §7 as the contract. Data contract is Task 7's response.

- [ ] **Step 1: Update types — `frontend/src/lib/matches.ts`**

```ts
const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

export type TeamDTO = { id: number; name: string; code: string };
export type VenueDTO = { name: string; city: string; country: string };
export type MatchDTO = {
  id: number;
  match_number: number;
  stage: "group" | "knockout";
  round: string;
  group: string;
  label: string;
  kickoff_utc: string;
  kickoff_ist: string;
  status: "scheduled" | "live" | "final";
  locked: boolean;
  home: TeamDTO | null;
  away: TeamDTO | null;
  venue: VenueDTO | null;
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

- [ ] **Step 2: Update `frontend/src/components/MatchRow.tsx`**

```tsx
import type { MatchDTO } from "../lib/matches";
import { Countdown } from "./Countdown";

const istTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
  });

// matchup shows the two teams, or the placeholder label (e.g. "W73 vs W75").
function Matchup({ m }: { m: MatchDTO }) {
  if (m.home && m.away) {
    return (
      <div className="teams">
        <span>{m.home.code || m.home.name}</span>
        <span className="muted">v</span>
        <span>{m.away.code || m.away.name}</span>
      </div>
    );
  }
  return <div className="teams muted">{m.label}</div>;
}

export function MatchRow({ m }: { m: MatchDTO }) {
  const tag = m.group ? `Group ${m.group}` : m.round;
  return (
    <div className="match-row">
      <div className="match-main">
        <Matchup m={m} />
        <span className="match-tag muted">{tag}{m.venue ? ` · ${m.venue.city}` : ""}</span>
      </div>
      <div className="kickoff">
        <span className="mono">{istTime(m.kickoff_ist)} IST</span>
        {m.locked ? <span className="badge-locked">Locked</span> : <Countdown to={m.kickoff_utc} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add styles** — append to `frontend/src/styles/tokens.css`:

```css
.match-main { display: flex; flex-direction: column; gap: 2px; }
.match-tag { font-size: 12px; }
```

- [ ] **Step 4: Type-check + build**

Run: `cd frontend && pnpm tsc --noEmit && pnpm build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/matches.ts frontend/src/components/MatchRow.tsx frontend/src/styles/tokens.css
git commit -m "feat(frontend): show group, venue, and placeholder labels on fixtures"
```

---

### Task 10: Commit dataset + end-to-end smoke

**Files:**
- Create/commit: `data/teams.csv`, `data/host_cities.csv`, `data/tournament_stages.csv`, `data/matches.csv`
- Modify: `.gitignore` (ignore `data/worldcup2026.db`)
- Modify: `backend/Dockerfile` (bake the data dir into the image)

- [ ] **Step 1: Gitignore the binary db** — append to `.gitignore`:
```gitignore
# Static dataset: commit CSVs, not the redundant sqlite
data/worldcup2026.db
```

- [ ] **Step 2: Bake the dataset into the backend image** — in `backend/Dockerfile`, the build stage `COPY . .` only copies `backend/`. The CSVs live in repo-root `data/`, outside the backend build context. Two options — use (a): copy the data into `backend/` at build is wrong; instead set the seed dir at runtime. For the container, mount or copy `data/` to the image. Simplest: in `deploy/docker-compose.yml`, mount the repo `data/` into the backend container and set `SEED_DATA_DIR`:

In `deploy/docker-compose.yml` under `backend`:
```yaml
    volumes:
      - ../data:/app/data:ro
    environment:
      # ... existing ...
      SEED_DATA_DIR: /app/data
```
(The backend binary's CWD is `/`; an absolute `SEED_DATA_DIR` avoids CWD assumptions. `make seed-fixtures` runs natively from `backend/`, where `../data` is the repo data — so also set `SEED_DATA_DIR=../data` for the native seed, see Step 3.)

- [ ] **Step 3: Native seed reads repo `data/`** — `make seed-fixtures` runs `cd backend && go run ./cmd/seedfixtures`, so CWD is `backend/` and the default `./data` won't exist there. Set the dir in the Makefile target:

In `Makefile`, change the `seed-fixtures` recipe to:
```makefile
seed-fixtures: ## Seed teams, venues, and fixtures from the committed CSV dataset
	cd backend && SEED_DATA_DIR=../data go run ./cmd/seedfixtures
```

- [ ] **Step 4: Commit the dataset + wiring**

```bash
git add data/teams.csv data/host_cities.csv data/tournament_stages.csv data/matches.csv .gitignore Makefile deploy/docker-compose.yml
git commit -m "chore(data): commit WC2026 CSV dataset; wire SEED_DATA_DIR"
```

- [ ] **Step 5: End-to-end smoke (real data, no API/key)**

```bash
docker compose -p sayscore down -v && docker compose -p sayscore up -d mysql
# wait healthy, then:
make migrate-up
make seed-fixtures      # expect: venues=16 teams=48 matches=104
# counts:
docker exec "$(docker compose -p sayscore ps -q mysql)" mysql -N -uwcp -pwcp wcp \
  -e "SELECT CONCAT('venues=',(SELECT COUNT(*) FROM venues),' teams=',(SELECT COUNT(*) FROM teams),' matches=',(SELECT COUNT(*) FROM matches));"
```
Expected: `venues=16 teams=48 matches=104`. Boot `make run`, and confirm `GET /api/matches` (with a session) returns days grouped by IST, with `group`, `venue`, and placeholder labels for knockout matches. (Authed call: mint a cookie as in prior verification, or sign in via the UI.)

- [ ] **Step 6: (verification only — no commit)** Record the counts + a sample day in the task report.

---

## Milestone 2 Definition of Done

- `go test ./...` (backend) passes incl. `importer` (parse + idempotent import) and `httpapi` (group/venue/placeholder); `pnpm tsc --noEmit && pnpm build` clean.
- `make migrate-up` creates `venues`, `teams`, `matches` (new shape; FKs nullable for placeholders).
- `make seed-fixtures` imports **16 venues / 48 teams / 104 matches** from `data/*.csv`, idempotently, normalizing venue-local kickoffs to UTC, never clobbering `manual_override`.
- `GET /api/matches` returns IST-grouped matches with `group`, `venue`, server-computed `locked`, and null teams + `label` for placeholders.
- Fixtures UI shows group + venue and renders placeholder matchups.
- `internal/sportsapi` + `internal/fixtures` + `APIFOOTBALL_*` config are gone; no API keys anywhere.
- `data/*.csv` committed; `data/worldcup2026.db` gitignored. All work committed.

---

## Self-Review

**1. Spec coverage:**
- §10 teams/matches (+ venues extension, + group) → Task 1. ✓
- §3.2 IST grouping + server-authoritative lock → Task 7 (`groupByISTDate`, `Locked`). ✓
- §11 `GET /api/matches` (auth) → Task 7. ✓
- Static seed, idempotent, skip `manual_override` → Task 1 SQL + Task 4 importer. ✓
- §7 design (group/venue surfaced) → Task 9 via impeccable. ✓
- UTC store / IST display, venue-local→UTC normalization → Task 2 `parseKickoffUTC` (tested: -06→+6h etc.). ✓
- Out of scope (correctly deferred): predictions+lock (M3), scoring (M4), results (M5), admin re-import (M8 reuses `importer.Importer`), bonus predictions (M7 — tournament-level; 4 of 7 need player data this dataset lacks — flagged for M7).

**2. Placeholder scan:** No TBD/TODO. The one judgement point (sqlc generated identifiers, Task 3 converters) is flagged with explicit guidance, as in M1. The Task 4 generic `readFile` stub is explicitly called out to be deleted and replaced with the concrete `openData`/`readMatches` helpers shown — implementer must not ship the stub.

**3. Type consistency:** `store.SeedStore` (UpsertVenue/UpsertTeam/UpsertMatch/GetVenueIDBySourceID/GetTeamIDBySourceID) is identical across `matches.go`, the importer's `fakeStore`, and `Importer.Run`. `store.MatchStore.ListMatchesWithTeams` matches the handler's `fakeMatchStore` and `Deps.Matches`. `MatchWithTeams` pointer fields (`Home`/`Away`/`Venue` `*TeamRef`/`*VenueRef`) are consistent between `matches.go`, the handler's `groupByISTDate`/`teamDTOf`, and `matches_test.go`. `importer.MatchRow` (`*int64` team/venue ids) → `store.UpsertMatchParams` (`*int64`) → sqlc `sql.NullInt64` bridge in Task 3. The JSON contract (`group`, `venue`, `label`, nullable `home`/`away`) matches `frontend/src/lib/matches.ts`.

> **Flagged risks for execution:** (a) sqlc null/enum type names vary by version — adapt Task 3 converters to generated code. (b) The backend Docker image doesn't contain `data/` (it's outside the build context); Task 10 mounts it via compose + `SEED_DATA_DIR` rather than rebuilding the image — confirm the mount path. (c) `csv.Reader` with `FieldsPerRecord=-1` tolerates the empty trailing-team cells in placeholder rows; the committed CSVs have a header row which `readCSV` skips.
