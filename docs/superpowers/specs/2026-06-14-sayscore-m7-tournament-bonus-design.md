# SayScore — Milestone 7 Design: Tournament Bonus + Lock

**Status:** approved 2026-06-14. Requirements remain locked in `docs/REQUIREMENTS.md` (§3.4 bonus
categories + points, §5/§5.1 scoring + overall tie-break, §10 `bonus_predictions`/`bonus_results`/
`settings`, §11 `/api/bonus`). This document records the M7 design and refines §10's indicative
columns; it does not re-derive the locked rules.

## Goal

Let every user make their **7 tournament bonus picks** before the bonus lock (28 Jun 2026 23:59 IST),
and wire bonus points into the **overall** standings and the **§5.1 "most correct bonus picks"**
tie-break tier (stubbed at 0 since M6). Bonus scoring is a pure, idempotent recompute. Outcome entry +
scoring are reachable via a minimal admin/debug path now; the polished admin outcomes screen is M8.

## Scope

In scope:

- Migration `0007` — `players` (squad data for the player awards) + a committed `data/players.csv`
  seed authored from football-data squads, importer, regenerated `seed.sql`.
- Migration `0008` — `bonus_predictions` + `bonus_results`.
- Store + sqlc: bonus pick upsert/list, team list, player search, bonus-results upsert, bonus scoring
  reads, and the overall-leaderboard change to include bonus points + bonus-hit counts.
- `GET /api/bonus` + `PUT /api/bonus` (server-authoritative lock), `GET /api/teams`,
  `GET /api/players?q=`, and a minimal admin outcome path (`PUT /api/admin/bonus/results` +
  `bonus-score` on the debug job trigger).
- Pure `internal/bonus` scoring engine + idempotent materialization of `bonus_predictions.points`.
- Overall leaderboard + §5.1 ranking updated to add bonus points and the bonus-hit tie-break tier.
- Frontend Bonus route (team dropdown + searchable player select, lock countdown, locked/empty states)
  built with the `impeccable` skill, plus a nav entry.
- Config: parse `BONUS_LOCK_AT`.

Out of scope (other milestones):

- **Polished admin outcomes UI + settings-table override of the lock** — M8. M7 ships a minimal
  `RequireAdmin` outcome endpoint + the debug `bonus-score` trigger so scoring is testable/runnable.
- Showing player stats (goals, etc.) in the picker — not needed for picking or scoring (YAGNI).

## Data model

### Migration `0007_create_players`

```sql
CREATE TABLE players (
  id        BIGINT      NOT NULL AUTO_INCREMENT,
  source_id BIGINT      NOT NULL,                 -- football-data player id
  team_id   BIGINT      NOT NULL,                 -- FK -> teams(id)
  name      VARCHAR(128) NOT NULL,
  position  VARCHAR(32)  NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY uq_players_source (source_id),
  KEY idx_players_team (team_id),
  KEY idx_players_name (name),                    -- typeahead search
  CONSTRAINT fk_players_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Seeded from a committed `data/players.csv` (`source_id,team_fifa_code,name,position`), authored once by
`scripts/gen_players.py`: for each row in `data/fd_team_aliases.csv` it calls football-data
`GET /v4/teams/{fd_team_id}`, reads `squad[]`, maps the fd team to our FIFA code, and writes players;
**throttled** (the free tier allows ~10 req/min, so ~7s between the 48 calls). The Go importer loads
the CSV into `players`; `seed.sql` is regenerated. Squad availability was verified against the live API.

### Migration `0008_create_bonus`

```sql
CREATE TABLE bonus_predictions (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  user_id    BIGINT NOT NULL,
  category   ENUM('winner','runner_up','golden_ball','golden_boot','golden_glove','young_player','fair_play') NOT NULL,
  ref_id     BIGINT NOT NULL,        -- team id (team awards) or player id (player awards)
  points     INT    NULL,            -- materialized when scored (NULL until tournament end)
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bonus_user_cat (user_id, category),
  KEY idx_bonus_user (user_id),
  CONSTRAINT fk_bonus_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE bonus_results (
  category   ENUM('winner','runner_up','golden_ball','golden_boot','golden_glove','young_player','fair_play') NOT NULL,
  ref_id     BIGINT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**`ref_id` is polymorphic by category** — team id for `winner`/`runner_up`/`fair_play`, player id for
`golden_ball`/`golden_boot`/`golden_glove`/`young_player`. The mapping is a fixed code constant; there
is no DB FK on `ref_id` (it spans two tables). Integrity is enforced server-side: a team-award `ref_id`
must exist in `teams`, a player-award `ref_id` in `players`. This refines §10's indicative `value`
column (we now have a `players` table, so a typed `ref_id` beats free text).

**Category points** (a code constant, from §3.4): winner 30, runner_up 20, the other five 10. Max 100.

## Category → ref-type + points (single source of truth, in `internal/bonus`)

```
winner       team   30
runner_up    team   20
golden_ball  player 10
golden_boot  player 10
golden_glove player 10
young_player player 10
fair_play    team   10
```

## API (§11)

- `GET /api/bonus` (auth) → the caller's picks + lock state:
  ```json
  { "lock_at": "2026-06-28T23:59:00+05:30", "locked": false,
    "picks": [ { "category": "winner", "ref_type": "team", "ref_id": 9, "label": "Brazil" } ] }
  ```
  `label` is the resolved team/player name for display; categories with no pick are omitted (the UI
  shows all 7 rows and fills what's present).
- `PUT /api/bonus` (auth) → upsert `{ "picks": [ { "category", "ref_id" } ] }`. Validates each
  category, that `ref_id` exists in the correct table for the category's ref-type, and **rejects the
  whole request with 403 when `now >= lock_at`** (server-authoritative; the client clock is never
  trusted). Bad category / missing ref / wrong-type ref → 400. Partial upserts allowed (send any
  subset of the 7). Returns the updated pick set.
- `GET /api/teams` (auth) → `[{ id, name, code }]` (≈48; fetched once for the team dropdowns).
- `GET /api/players?q=<term>` (auth) → `[{ id, name, team_code, position }]`, name-prefix/substring
  search, capped (e.g. 20 rows) for the typeahead.
- `PUT /api/admin/bonus/results` (`RequireAdmin`, all environments) → upsert one or more
  `{ category, ref_id }` outcomes (validated like picks). Minimal entry point; M8 adds the UI.
- Debug job trigger gains `"bonus-score"` (`APP_ENV != production` only) → runs idempotent bonus
  scoring over all picks from the stored `bonus_results`.

## Scoring + leaderboard integration

- Pure `bonus.Score(category, pickRefID int64, result *Result) int` → the category's points if a result
  exists and `pickRefID == result.RefID`, else 0. No I/O. Exhaustively table-tested.
- **Materialization** (`internal/jobs` or a store tx): for every `bonus_prediction`, `SET points` from
  the matching `bonus_results` row (recompute, never increment) — idempotent, safe to re-run.
- **Overall leaderboard** (`OverallLeaderboard` query): the per-user total becomes
  `SUM(predictions.points + penalty_bonus) + COALESCE(bonus_points, 0)`, where `bonus_points` is each
  user's `SUM(bonus_predictions.points)`. The §5.1 cascade's 4th tier, **most correct bonus picks**,
  becomes `COUNT(bonus_predictions WHERE points > 0)` per user (previously hard-0). The ranking
  `leaderboard.Row` gains a `BonusHits` field used in `OverallSameRank`. **Weekly is unchanged** —
  bonus points are tournament-wide, never attributed to a week.

## Frontend — Bonus route (impeccable)

A new **Bonus** screen + nav entry (visible to all authed users):

- Seven rows, one per category, each labelled with its points value (e.g. "World Cup Winner · 30 pts").
  Team awards render a **team `<select>`** (from `GET /api/teams`); player awards render a **searchable
  combobox** (debounced `GET /api/players?q=`) showing *name · team · position*.
- A live **countdown to `lock_at`** (IST); at/after lock the screen switches to a **read-only** view of
  the user's picks (inputs disabled), and any write still gets sent and a 403 is handled gracefully
  (server authoritative, never the client clock).
- Teaching **empty state** before any pick; skeletons while loading; `role="alert"` errors; optimistic
  save reconciled with the server response. TanStack Query: `useBonus`, `useTeams`, `usePlayersSearch`,
  `useSaveBonus`. Times displayed in IST; §7 tokens, JetBrains Mono for the points/countdown.

## Config

`BONUS_LOCK_AT` (env, RFC3339 with offset; default `2026-06-28T23:59:00+05:30`) parsed in
`internal/config` to a `time.Time`. The handler compares `now()` (the existing injectable clock) to it.
A settings-table override is deferred to M8.

## Testing (TDD; backend is the high-value surface)

- **Lock enforcement:** `PUT /api/bonus` just before `lock_at` succeeds; at exactly `lock_at` and after
  → 403 (fixed-clock tests; server clock authoritative).
- **Validation:** a team category with a player `ref_id` (and vice versa) → 400; unknown category → 400;
  non-existent `ref_id` → 400.
- **Bonus scoring engine:** each category's points on a ref match; 0 on mismatch; 0 when no result yet;
  idempotent materialization (run twice → identical `points`).
- **Overall integration:** overall total includes bonus points; the §5.1 tie-break is broken by
  bonus-hit count when totals + exact + correct tie (table-driven); weekly totals unaffected by bonus.
- **Players seed/import + search:** CSV parse → rows; `GET /api/players?q=` returns matches, capped.
- **Frontend:** picker renders all 7 rows; locked state disables inputs and shows the read-only picks;
  player search renders results.

## Definition of Done

- `0007` + `0008` applied; `players`, `bonus_predictions`, `bonus_results` exist; `data/players.csv`
  committed and seeded.
- `go vet` + `go test ./...` green incl. the bonus engine, lock enforcement, and overall integration.
- Before lock, a user can save/edit all 7 picks (team dropdowns + player search); at/after lock writes
  are rejected (403) and the UI is read-only.
- With outcomes set (`PUT /api/admin/bonus/results`) and `bonus-score` run, `bonus_predictions.points`
  materialize, the overall leaderboard reflects bonus points, and the §5.1 bonus tie-break is active.
- Frontend type-check + tests green; Bonus screen built to §7 with the `impeccable` skill.
- `docs/REQUIREMENTS.md` updated where M7 refines it (§10 `ref_id`, §11 the new endpoints).
