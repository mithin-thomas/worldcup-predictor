# SayScore — Milestone 6 Design: Leaderboards (weekly + overall)

**Status:** approved 2026-06-14. Requirements remain locked in `docs/REQUIREMENTS.md` (§3.5 leaderboards,
§5/§5.1 scoring + tie-break, §6 weekly-winner job, §10 `weekly_results`, §11 `/api/leaderboard`). This
document records the M6 design; it does not re-derive those rules.

## Goal

Weekly and overall leaderboards, served as plain SUMs over the materialized `predictions.points` /
`penalty_bonus` (never recomputed on read), plus the weekly-winner cron job that records official
co-winners, surfaced on the landing screen (no separate route).

## Scope

In scope:

- Migration `0005` — `weekly_results`.
- Store: leaderboard SUM queries (weekly window by `kickoff_utc`; overall) + `weekly_results` upsert /
  list-by-week.
- Pure Go ranking (competition ties + §5.1 cascade) + pagination + caller's own rank.
- `GET /api/leaderboard` (week + overall, paginated).
- The weekly-winner job (`internal/jobs`), wired into the `robfig/cron` scheduler (`WEEKLY_CRON`) and
  the existing debug-only `POST /api/admin/jobs/run` trigger (currently 400 for `weekly-winner`).
- Frontend: the landing screen gains the leaderboard (desktop two-column, mobile in-page toggle) — no
  new route.
- Config: `WEEKLY_CRON`.

Out of scope (other milestones):

- **Tournament bonus points** (M7): overall sums `points + penalty_bonus` only for now; the §5.1
  "bonus-hits" tie-break tier is 0 until M7.
- Admin tools (M8). The weekly-winner job reuses the M5 `RequireAdmin`-gated debug trigger.

## Data model — migration `0005_create_weekly_results`

```
weekly_results
  id          BIGINT PK AUTO_INCREMENT
  user_id     BIGINT NOT NULL   FK -> users(id) ON DELETE CASCADE
  week_start  DATE   NOT NULL   -- IST Monday (00:00 IST) of the week
  points      INT    NOT NULL   -- the user's summed match points for that week
  is_winner   BOOL   NOT NULL DEFAULT 0
  created_at  TIMESTAMP
  updated_at  TIMESTAMP
  UNIQUE KEY uq_weekly_user_week (user_id, week_start)
  KEY idx_weekly_week (week_start)
ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
```

The unique key makes the weekly-winner write an idempotent upsert.

## Read model

Both leaderboards are **plain SUMs over stored points** (§5) — `COALESCE(points,0) + COALESCE(penalty_bonus,0)`
per user. Unscored predictions (NULL points, match not yet FINAL) count as 0, so a participant still
appears with total 0.

- **Weekly** (`period=week&week=YYYY-MM-DD`): the `week` param is the **IST Monday**; the window is
  `[week 00:00 IST, week+7d 00:00 IST)`, converted to UTC for the `kickoff_utc` filter. Attribution is
  by kickoff (deterministic). Default (no `week`) = the current IST week. The endpoint joins
  `weekly_results` for the requested week to surface `is_winner`.
- **Overall** (`period=overall`): SUM over **all** predictions, ordered by the **§5.1 cascade**:
  total desc → exact-score count (points == 5) desc → correct-result count (points == 3) desc →
  bonus-category count desc (0 until M7).

Participation: a user appears if they have **≥1 prediction in scope** (any prediction for overall; a
prediction on an in-window match for weekly).

## Ranking, pagination, and "me" (in Go — the high-value test surface)

The dataset is internal-scale (tens of SayOne employees), so the handler **fetches the full ordered
result set and ranks it in Go**, rather than pushing ranking/pagination into SQL. This keeps the SQL a
simple `GROUP BY ... ORDER BY` and makes ranking unit-testable.

- **Weekly** uses standard competition ranking with ties: equal totals share a rank (co-winners share
  rank 1 → `1, 1, 3, …`).
- **Overall** assigns rank by cascade-ordered position; two rows share a rank only when they tie on
  **all** tiers (total, exact, correct, bonus).
- The handler then **paginates the ranked slice** (`page`, default 1; `page_size` = 20) and always
  attaches the caller's own `{rank, points}` (`me`), computed from the full ranking so it shows even
  when the caller is off the current page.

## API (§11)

`GET /api/leaderboard?period=week|overall[&week=YYYY-MM-DD][&page=N]` (auth required):

```json
{
  "period": "week",
  "week": "2026-06-15",
  "page": 1,
  "page_size": 20,
  "total": 37,
  "rows": [
    { "rank": 1, "user_id": 5, "name": "…", "avatar_url": "…",
      "points": 18, "exact": 2, "correct": 3, "is_winner": false, "is_me": false }
  ],
  "me": { "rank": 12, "points": 7 }
}
```

`week` is omitted for `period=overall`. `is_winner` is always false for `period=overall` and for an
in-progress weekly (no `weekly_results` row yet). Invalid `period` → 400; bad `week` format → 400.

## weekly-winner job (`internal/jobs`)

`WeeklyWinner{Store, Now}.Run(ctx) (Summary, error)`:

1. Compute the **previous completed** IST week relative to `now`: `thisMonday` = Monday 00:00 IST of
   the week containing `now`; the target `week_start = thisMonday − 7 days`; window
   `[week_start, thisMonday)`.
2. SUM points per user over that window's matches (same query the weekly read uses).
3. **Upsert** a `weekly_results` row per participating user (idempotent SET, never increment).
4. Mark `is_winner = true` for the user(s) with the **maximum** total **> 0** (co-winners allowed); all
   others false. A week where nobody scored has no winner.

Wired into the `robfig/cron` scheduler at `WEEKLY_CRON` (default `30 13 * * 1` = Mon 13:30 IST, IST
location, key-independent — it needs no external API) and the debug trigger (`weekly-winner` case →
`RunWeeklyWinner`).

## Frontend — landing screen, no new route (impeccable)

The Fixtures landing screen becomes responsive:

- **Desktop (≥ ~1024px):** two columns — the fixtures list (main, left) + a sticky leaderboard panel
  (right) with a **Weekly | Overall** toggle and pagination.
- **Mobile:** a segmented **Fixtures | Ranks** control at the top swaps the single column's content
  (same screen, no navigation).

Leaderboard table (§7 design system): rank, name (current user highlighted), points in **JetBrains
Mono**, exact/correct counts, a co-winner badge; skeletons-not-spinners while loading; a teaching empty
state ("No ranked players yet — points appear after matches finish"); the IST week label. One typed
API client + a TanStack Query hook (`useLeaderboard`). Built with the `impeccable` skill against §7.

## Testing (TDD; backend the high-value surface)

- **Weekly window:** a match at exactly Mon 00:00 IST is included; Sun 23:59:59 IST included; the next
  Mon 00:00 IST excluded. Attribution by kickoff.
- **Co-winner ties:** two users with the equal top weekly total → both `is_winner`, share rank 1.
- **§5.1 overall ordering:** equal totals broken by exact count, then correct count (table-driven).
- **Idempotent `weekly_results`:** running the job twice yields identical rows + winner flags.
- **Pure ranking + pagination + me-rank:** competition ranking, page slicing, caller located off-page.
- **Handler:** week vs overall, default week, bad params (400), auth (401).

## Definition of Done

- `0005` applied; `weekly_results` exists.
- `go vet` + `go test ./...` green incl. the leaderboard ranking + weekly-winner job.
- `GET /api/leaderboard` returns correct weekly + overall rankings (live SUMs, §5.1 order, pagination,
  `me`).
- The weekly-winner job writes `weekly_results` with co-winners idempotently, via cron + trigger.
- The landing screen shows the leaderboard (desktop two-column, mobile toggle), current user
  highlighted; frontend type-check + tests green.
- Live-verified against the M5-ingested results.
