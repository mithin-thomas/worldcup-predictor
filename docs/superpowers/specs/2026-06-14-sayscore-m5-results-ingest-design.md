# SayScore — Milestone 5 Design: Results Ingestion + Points

**Status:** approved 2026-06-14. Requirements remain locked in `docs/REQUIREMENTS.md` (§6 scheduled
jobs + `results-ingest` cron `0 3,8,13 * * *`, §8 football-data.org v4 source + field mapping, §3.6
debug-only job trigger, §5 scoring engine). This document records the M5 design; it does not
re-derive those.

## Goal

A scheduled (and debug-triggerable) `results-ingest` pipeline that pulls FINISHED World Cup matches
from football-data.org, aligns each to its seeded match, updates the stored result, and materializes
`predictions.points` / `predictions.penalty_bonus` via the M4 scoring engine — idempotently.

## Scope

In scope:

- `internal/sportsapi` — a football-data.org v4 client + a pure translator from an API match to a
  domain result.
- `internal/jobs` — the `results-ingest` job (fetch → align → update → recompute), transactional and
  idempotent.
- Migration `0004` — `matches.api_fixture_id`.
- `data/fd_team_aliases.csv` — a committed 48-row football-data-team-id → FIFA-code map, plus the
  one-time authoring script.
- New `store` methods + a `WithTx` closure helper.
- The in-process `robfig/cron/v3` scheduler in `cmd/server` (location IST).
- A minimal `RequireAdmin` middleware and the debug-only `POST /api/admin/jobs/run` trigger.
- Config: `FootballDataAPIKey`, `FootballDataBaseURL`, `ResultsCron`.

Out of scope (other milestones):

- **weekly-winner job + leaderboards** — Milestone 6. In M5 the trigger returns 400 for that job.
- **Admin match CRUD + result-correction UI** — Milestone 8. M5 builds only `RequireAdmin` (reused
  by M8) and the debug trigger.
- Scoring rules themselves — built and tested in M4 (`internal/scoring`, `scoring.Compute`).

## Match alignment (the crux)

The two datasets disagree on team names ("South Korea" vs "Korea Republic", "Czech Republic" vs
"Czechia", "Turkey" vs "Türkiye") and several matches kick off simultaneously, so no single
name/time key is reliable. Decision: **align by stable football-data team ids via a committed alias
map.**

- `data/fd_team_aliases.csv` (`fd_team_id,fifa_code`) — 48 rows, authored once by a small script
  that calls `GET /v4/competitions/WC/teams`, maps each returned team to our FIFA code (using a
  known name→code dictionary like `scripts/gen_fixtures.py`), and writes the file. It is committed;
  the ingest loads it at startup.
- The ingest resolves `apiMatch.homeTeam.id → fifa_code → our teams.id` (and away likewise), then
  finds the seeded match by `(api_fixture_id if known, else (utcDate, home_id, away_id))`.
- On first successful alignment it stamps `matches.api_fixture_id = apiMatch.id`, so subsequent runs
  are a direct id lookup (immune to any later name/time drift).

## Data model — migration `0004_add_match_api_fixture_id`

```
ALTER TABLE matches
  ADD COLUMN api_fixture_id BIGINT NULL AFTER source_id,
  ADD UNIQUE KEY uq_matches_api_fixture_id (api_fixture_id);
```

Nullable (unset until first matched); unique (one seeded match per football-data id). The `down`
drops the key + column.

## Components

### `internal/sportsapi` — football-data.org client

- `Client{httpClient *http.Client, baseURL, apiKey string}`; `New(baseURL, apiKey)`.
- `ListFinishedMatches(ctx, dateFrom, dateTo string) ([]Match, error)` →
  `GET {baseURL}/competitions/WC/matches?status=FINISHED&dateFrom={from}&dateTo={to}`, header
  `X-Auth-Token: {apiKey}`. Non-2xx → error (logged + aborts the run).
- Typed DTOs mirroring the JSON: `Match{ID int64; UtcDate string; Stage string; Status string;
  Score{Winner string; Duration string; FullTime{Home, Away *int}}; HomeTeam{ID int64};
  AwayTeam{ID int64}}`.
- Pure translator `func toResult(m Match) Result` producing a domain ingest result:
  - `Final = m.Status == "FINISHED"`.
  - `HomeScore/AwayScore = m.Score.FullTime.Home/Away`.
  - `WentToPenalties = m.Score.Duration == "PENALTY_SHOOTOUT"`.
  - `Knockout = m.Stage != "GROUP_STAGE"`.
  - `WinnerSide = m.Score.Winner` (`HOME_TEAM` / `AWAY_TEAM` / `DRAW`) — the job converts this to a
    concrete `penalty_winner_team_id` only when `WentToPenalties` (using which seeded team is
    home/away).
- Tested with `httptest.Server` against canned football-data JSON (incl. the USA 4-1 Paraguay sample
  and a knockout shootout sample).

### `internal/jobs` — results-ingest

`type ResultsIngest struct { API; Store; Now func() time.Time; Alias map[int64]string }` with
`Run(ctx) (Summary, error)`. Steps:

1. Window: `dateFrom = (now IST − 1 day)`, `dateTo = now IST`, formatted as UTC `YYYY-MM-DD`.
2. `matches := API.ListFinishedMatches(ctx, from, to)`; API error → return it (run aborts; next cron
   retries).
3. Resolve `Alias` (`fd_team_id → fifa_code`) once; build/lookup `fifa_code → teams.id`.
4. For each finished `m`:
   - Resolve home/away seeded team ids via the alias; unresolved → log + skip.
   - Find the seeded match (`api_fixture_id`, else `(utcDate, home_id, away_id)`); not found → log +
     skip.
   - If the seeded match is `manual_override` → **skip wholesale** (no result update, no recompute;
     M8 owns it).
   - Else, in **one transaction**: update the match (`status='final'`, `home_score`, `away_score`,
     `went_to_penalties`, `penalty_winner_team_id`, set `api_fixture_id` if unset); load the match's
     predictions; for each, build `scoring.Prediction`/`scoring.Result` and call `scoring.Compute`;
     `SET predictions.points = r.Points, penalty_bonus = r.PenaltyBonus`.
5. Return a `Summary{Fetched, Updated, Skipped, PredictionsScored}` (logged).

Idempotent: every write is an absolute `SET`, so re-running the job (or overlapping runs) cannot
double-count.

### Store (new)

- `WithTx(ctx, func(q TxQueries) error) error` — runs the closure inside `db.BeginTx`, commit/rollback.
- `FindMatchForResult(ctx, apiFixtureID *int64, utcDate time.Time, homeID, awayID int64)
  (MatchByID, error)` — `ErrNotFound` when no row.
- `UpdateMatchResult(ctx, params)` — sets status/scores/penalty fields + `api_fixture_id`.
- `ListPredictionsForMatch(ctx, matchID) ([]PredictionToScore, error)` — id + home/away +
  penalty_winner pick.
- `SetPredictionScore(ctx, predictionID, points, penaltyBonus int)`.
- `ListTeamsByCode(ctx) (map[string]int64, error)` — FIFA code → team id, for alias resolution.

These are thin sqlc pass-throughs (new queries in `queries/`), verified by `go build` + the jobs
integration test against fakes, following the M3/M4 store pattern.

### Scheduler (`cmd/server`)

- Add `robfig/cron/v3`. On boot, if `FootballDataAPIKey != ""`, construct the `sportsapi.Client`,
  load the alias map, build `ResultsIngest`, and register it on a `cron.New(cron.WithLocation(IST))`
  at `cfg.ResultsCron`; `Start()` it; `Stop()` on shutdown. If the key is empty, log
  "results-ingest disabled (no FOOTBALL_DATA_API_KEY)" and skip — local dev without a key still runs.

### Debug trigger + admin gate

- New `RequireAdmin` middleware: after `RequireAuth`, 403 unless `user.Role == admin`.
- `POST /api/admin/jobs/run` `{ "job": "results-ingest" }` — registered **only when `debug`**
  (`APP_ENV != production`, the flag already passed to `NewRouter`), behind `RequireAuth` +
  `RequireAdmin`. Runs the job synchronously and returns its `Summary` (200) or the error (500).
  `"weekly-winner"` → 400 `{"error":"unknown job"}` (M6). Unknown job → 400.

### Config

`FootballDataAPIKey` (`FOOTBALL_DATA_API_KEY`), `FootballDataBaseURL`
(`FOOTBALL_DATA_BASE_URL`, default `https://api.football-data.org/v4`), `ResultsCron`
(`RESULTS_CRON`, default `0 3,8,13 * * *`).

## Testing (TDD; backend is the whole surface)

- **`sportsapi`**: httptest server returning canned JSON → assert DTO parsing and `toResult` mapping:
  group final, a knockout that went to a shootout (`Duration=PENALTY_SHOOTOUT` → `WentToPenalties`,
  `Winner` side), a non-shootout knockout, header `X-Auth-Token` sent, non-2xx → error.
- **`jobs.ResultsIngest`** (fake API + fake store + fixed clock + alias map):
  - a finished group match is aligned and its result written;
  - its predictions are recomputed through the **real `scoring.Compute`** — assert exact stored
    points (e.g. exact → 5, correct → 3, wrong → 0) and a knockout-shootout draw → +1;
  - a `manual_override` match is skipped (no result write, no recompute);
  - an unmatched/unaligned match is skipped, others still processed;
  - **idempotency**: running `Run` twice yields identical stored scores and no duplication;
  - the update + recompute happen within a transaction.
- **alias loader**: parses `fd_team_aliases.csv` → map; unknown/blank rows error.
- Debug-trigger handler: `RequireAdmin` returns 403 for a non-admin; the route is absent in
  production (`debug=false`); `results-ingest` runs, `weekly-winner`/unknown → 400.

## Definition of Done

- `make migrate-up` applies `0004`; `matches.api_fixture_id` exists (nullable, unique).
- `go vet` + `go test ./...` green, including the new `sportsapi` and `jobs` packages.
- With `FOOTBALL_DATA_API_KEY` set, the debug trigger (`POST /api/admin/jobs/run`) ingests the WC
  matches already FINISHED and the affected predictions show correct `points`/`penalty_bonus`;
  re-triggering changes nothing (idempotent). Without a key, the server boots and logs the job as
  disabled.
- No endpoint or job touches a `manual_override` match's result.
