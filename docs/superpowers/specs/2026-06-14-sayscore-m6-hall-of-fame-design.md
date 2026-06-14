# SayScore — M6 Addition Design: Hall of Fame (weekly-winner history + prize tracking)

**Status:** approved 2026-06-14. **Folded into the existing M6 branch (`feat/m6-leaderboards`) / PR #8** — not
a separate milestone. This is **new scope** beyond `docs/REQUIREMENTS.md` as originally locked: the spec
names the ₹500 prize but defines no winner-history view and no payout-tracking. This document records the
addition; `docs/REQUIREMENTS.md` is updated in lock-step (§3.5 winner history, §3.6 prize-paid admin action).

It builds directly on the M6 leaderboard design (`2026-06-14-sayscore-m6-leaderboards-design.md`) and the
already-merged-to-branch `weekly_results` table + weekly-winner job.

## Goal

A **"Hall of Fame"** on the same landing screen: every past weekly champion (newest first), visible to
**all** users, with the ₹500 gift-card payout status shown; admins can mark a winner's card paid/unpaid
inline. Plus per-tab empty states for the leaderboard.

## Scope

In scope:

- Migration `0006` — add `prize_paid` + `paid_at` to `weekly_results`.
- sqlc: `ListWinners` (all winner rows, newest week first, joined to users) + `MarkWinnerPaid`.
- Store: a `Winner` domain type + `ListWinners` / `MarkWinnerPaid` on `LeaderboardStore`.
- `GET /api/winners` (auth, all users) — past champions grouped by week.
- `PUT /api/admin/winners/paid` (`RequireAuth` + `RequireAdmin`) — toggle a winner's payout status. A
  **standard admin route registered in all environments** (not debug-gated like `/admin/jobs/run`).
- Frontend: a `HallOfFame` section on the landing screen (in the leaderboard column, below the panel),
  with admin mark-paid toggle, paid badges, and loading/empty/error states; the leaderboard gets
  **per-tab** empty copy. Built with the `impeccable` skill against §7.
- `docs/REQUIREMENTS.md` updated for the new view + admin action.

Out of scope: tournament-bonus integration (M7); a separate admin screen (everything stays on the landing
page); editing past winners or points (M8 owns broader admin tooling).

## Data model — migration `0006_add_weekly_results_prize`

```sql
-- up
ALTER TABLE weekly_results
  ADD COLUMN prize_paid BOOL      NOT NULL DEFAULT 0 AFTER is_winner,
  ADD COLUMN paid_at    TIMESTAMP NULL              AFTER prize_paid;
-- down
ALTER TABLE weekly_results
  DROP COLUMN paid_at,
  DROP COLUMN prize_paid;
```

`prize_paid` defaults false; `paid_at` records *when* it was marked paid (NULL while unpaid). Payout state
is **per winner row** (the existing `UNIQUE(user_id, week_start)`), so co-winners' cards are tracked
individually. The weekly-winner job's existing upsert is unchanged — it never writes these columns, so an
idempotent re-run of the job **must not clobber a paid flag** (see "Idempotency interaction" below).

## sqlc queries (append to `internal/store/queries/leaderboard.sql`)

```sql
-- name: ListWinners :many
SELECT w.week_start, w.user_id, u.name, u.avatar_url, w.points, w.prize_paid, w.paid_at
FROM weekly_results w
JOIN users u ON u.id = w.user_id
WHERE w.is_winner = 1
ORDER BY w.week_start DESC, w.points DESC, u.id ASC;

-- name: MarkWinnerPaid :execrows
UPDATE weekly_results
SET prize_paid = ?, paid_at = ?
WHERE week_start = ? AND user_id = ? AND is_winner = 1;
```

`MarkWinnerPaid` is `:execrows` so the handler can return **404** when no winner row matches (wrong week,
non-winner user). The `is_winner = 1` guard means only actual champions can be marked paid.

## Idempotency interaction (important)

The existing `UpsertWeeklyResult` does `ON DUPLICATE KEY UPDATE points = …, is_winner = …` — it does **not**
list `prize_paid`/`paid_at`, so a re-run of the weekly-winner job preserves an already-paid flag. This is
the desired behavior and the column list must stay that way; a test locks it in (run job → mark paid →
re-run job → still paid).

## Store (append to `internal/store/leaderboard.go`)

```go
// Winner is one past weekly champion (a weekly_results row with is_winner=1).
type Winner struct {
    WeekStart time.Time
    UserID    int64
    Name      string
    AvatarURL string
    Points    int64
    PrizePaid bool
    PaidAt    *time.Time
}
```

Added to `LeaderboardStore`:

- `ListWinners(ctx) ([]Winner, error)` — thin sqlc pass-through; maps `sql.NullTime` → `*time.Time`.
- `MarkWinnerPaid(ctx, weekStart time.Time, userID int64, paid bool, paidAt *time.Time) (bool, error)` —
  pass-through to the `:execrows` query; returns `affected > 0`. The handler decides `paidAt`
  (`now()` when paying, `nil` when un-paying) and passes a `sql.NullTime` down. Store stays clock-free.

## API

### `GET /api/winners` (auth required)

Same response for everyone (payout status is transparent to all employees). Grouped by week, newest first:

```json
{
  "weeks": [
    { "week_start": "2026-06-08",
      "winners": [
        { "user_id": 5, "name": "…", "avatar_url": "…", "points": 18, "prize_paid": true }
      ] }
  ]
}
```

`week_start` is `YYYY-MM-DD` (the DATE key, which is the IST calendar Monday). The flat `ListWinners` rows
(already ordered `week_start DESC, points DESC, id ASC`) are grouped by `week_start` in Go preserving order.
Empty list → `{"weeks": []}`.

### `PUT /api/admin/winners/paid` (`RequireAuth` + `RequireAdmin`)

```json
{ "week_start": "2026-06-08", "user_id": 5, "paid": true }
```

- Validates `week_start` as `YYYY-MM-DD` (→ 400 on bad format) and a non-zero `user_id` (→ 400).
- `paid=true` → set `prize_paid=1, paid_at=now()`; `paid=false` → `prize_paid=0, paid_at=NULL`.
- No matching winner row → **404** `{"error":"winner not found"}`.
- Success → **200** `{"week_start":"…","user_id":5,"prize_paid":true}`.
- Non-admin → 403 (via `RequireAdmin`); unauthenticated → 401.

### Routing (`router.go`)

```go
priv.Get("/winners", d.GetWinners)
priv.With(d.RequireAdmin).Put("/admin/winners/paid", d.PutWinnerPaid)
```

Both inside the existing `RequireAuth` group. The PUT is a **normal admin route** — registered
unconditionally, unlike the debug-only `if debug { … /admin/jobs/run }`.

## Frontend (impeccable, same landing page)

- `lib/winners.ts` — `WinnersResponse`/`WinnerWeek`/`Winner` types, `getWinners()`, `useWinners()`, and a
  `useMarkWinnerPaid()` mutation (PUT with `credentials:"include"`, invalidates `["winners"]`).
- `components/HallOfFame.tsx` — a `<section className="hof">`:
  - Heading "Hall of Fame".
  - Each week: an IST label (`Week of 8 Jun`, formatted at the edge like the leaderboard's week label) and
    its champion(s). Co-winners each render as their own line.
  - Each champion: a 🏆/medal marker, name, points in **JetBrains Mono**, the **₹500** prize, and either a
    **Paid ✓** badge or — when `useMe().role === "admin"` — a **Mark paid / Mark unpaid** toggle button
    (≥44px target, visible focus ring, `aria-label`, loading state while the mutation is pending).
  - States: skeleton while loading; `role="alert"` on error; teaching empty state —
    *"No champions yet — the first weekly winner is crowned Monday."*
- `Home.tsx` — render `<HallOfFame />` below `<LeaderboardPanel />` in the existing `home__aside` (so on
  mobile it sits in the "Ranks" view under the leaderboard; no new tab or route).
- `LeaderboardPanel.tsx` — replace the single empty message with **per-tab** copy: weekly →
  *"No scores this week yet — points appear after matches kick off."*; overall →
  *"No ranked players yet — make your first prediction."*
- `styles/tokens.css` — `.hof*` classes consistent with the existing `.lb*` system (dark §7 tokens, mono
  numerics, 44px targets).

## Testing (TDD)

Backend (high-value):

- **Store:** `ListWinners` maps rows + `NullTime`→`*time.Time`; `MarkWinnerPaid` returns affected-bool;
  build + (where a DB-backed test exists) round-trip.
- **`GET /api/winners` handler:** grouping (two co-winners in one week → one week with two winners; two
  weeks → newest first), `prize_paid` surfaced, empty → `{"weeks":[]}`, auth 401.
- **`PUT /api/admin/winners/paid` handler:** paid=true sets flag + `paid_at`; paid=false clears both;
  non-winner/unknown week → 404; bad `week_start` / zero `user_id` → 400; non-admin → 403; auth 401.
- **Idempotency:** mark paid → re-run weekly-winner job upsert → `prize_paid` still true.

Frontend (Vitest + Testing Library):

- `HallOfFame` renders weeks + champions with points; **admin** sees the Mark-paid toggle, **non-admin**
  sees only the Paid/Unpaid badge; empty state renders the teaching copy.
- Leaderboard per-tab empty copy differs between weekly and overall.

## Definition of Done

- `0006` applied; `weekly_results.prize_paid` + `paid_at` exist.
- `go vet` + `go test ./...` green incl. winners handler, store, and the idempotency lock.
- `GET /api/winners` returns past champions grouped newest-first with payout status; `PUT
  /api/admin/winners/paid` toggles it (admin only, 404 on non-winner).
- Landing screen shows Hall of Fame below the leaderboard on the same page (mobile: in the Ranks view);
  admin can mark a card paid and the badge updates; non-admins see read-only status.
- Per-tab leaderboard empty states present; frontend type-check + tests green.
- `docs/REQUIREMENTS.md` updated (§3.5 winner history, §3.6 prize-paid admin action).
- Live-verified against the existing weekly_results rows.
