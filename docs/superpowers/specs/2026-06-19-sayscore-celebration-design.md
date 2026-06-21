# SayScore — Match Celebration (Brazil) — Design Spec

**Date:** 2026-06-19
**Branch:** `feat/celebration` (off `feat/frontend-v2-design`; V2 not yet merged)
**Status:** Approved in brainstorming; ready for implementation plan.

## 1. Overview

When a **celebrated team (Brazil only, for now) wins a match**, every user sees a one-time,
full-screen **victory celebration** the next time they open the app after that match has gone
FINAL. The celebration is seen **once per user per match, across devices** (server-tracked). The
overlay names the exact match with an inline **scorecard** (e.g. `BRA 3 – 1 JOR`), then settles
into the normal app behind it.

The visual/audio design is imported from the Claude Design handoff (`renjith-design`):
`project/app/victory.jsx` + `project/app/victory.css` (component `VictoryCelebration`) plus the
single asset `project/app/legends-flag.jpg`.

## 2. Goals / Non-goals

**Goals**
- Detect a celebrated-team win server-side and surface it to the user once (per user, per match).
- Play the imported `VictoryCelebration` overlay (canvas particles + synthesized WebAudio +
  Brazil-themed reveal), with an added inline scorecard for the won match.
- Cross-device "seen once" via the backend.
- Show **at most one** celebration per login (the latest unseen win); mark older unseen wins seen.
- An **admin-only** debug button to replay the celebration on demand (works in production).

**Non-goals (YAGNI)**
- Celebrations for teams other than Brazil. The allowlist is server-side and extensible, but only
  `BRA` is enabled now. The overlay copy/colours are intentionally Brazil-specific.
- Per-match custom copy, user opt-out/settings, sound preferences. (Audio only starts on a user
  gesture per browser autoplay rules; a click on the overlay resumes it — inherited from the design.)
- Any change to scoring, leaderboards, or the results pipeline.

## 3. Behavior rules

- A **celebrated win** = a match with `status = 'final'` whose **winner** is a celebrated team.
  Winner = the side with the higher score; on a draw, the `penalty_winner_team_id` (knockout
  shootout) is the winner. Group-stage draws have no winner → no celebration.
- A user sees a given match's celebration **exactly once**, tracked in `celebration_views`.
- On login, if there are multiple unseen celebrated wins, play **only the most recent** (by
  kickoff) and mark **all** unseen ones seen (so the rest don't queue up).
- On launch (Brazil already having won), each existing user sees exactly **one** celebration (the
  latest Brazil win) on first login — not one per past win.
- The celebration is informational/decorative; failure to load it never blocks the app.

## 4. Data model (backend)

New migration `00NN_create_celebration_views` (next sequential number):

```sql
CREATE TABLE celebration_views (
  user_id    BIGINT    NOT NULL,
  match_id   BIGINT    NOT NULL,
  seen_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, match_id),
  CONSTRAINT fk_celview_user  FOREIGN KEY (user_id)  REFERENCES users (id)   ON DELETE CASCADE,
  CONSTRAINT fk_celview_match FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

The down migration drops the table.

## 5. Backend

### 5.1 Allowlist
A server constant — celebrated team **codes**, keyed by code (stable across reseeds), default
`{"BRA"}`. Lives in the celebrations store/handler package (e.g. `celebratedTeamCodes = []string{"BRA"}`).
Extensible later without a schema change.

### 5.2 Detection query (sqlc)
"Unseen celebrated wins for a user", newest-first:
- `FROM matches m JOIN teams ht ON ht.id = m.home_team_id JOIN teams at ON at.id = m.away_team_id`
- winner team's `code` ∈ allowlist, where winner is derived in SQL:
  - home wins if `home_score > away_score`
  - away wins if `away_score > home_score`
  - draw + `penalty_winner_team_id` set → that team
- `m.status = 'final'`
- `LEFT JOIN celebration_views cv ON cv.user_id = ? AND cv.match_id = m.id WHERE cv.match_id IS NULL`
- `ORDER BY m.kickoff_utc DESC`

Returns, per row: `match_id`, winner `team_code` + `team_score`, `opponent_code` + `opponent_score`,
`kickoff_utc`. (Winner/opponent resolved so the frontend can render `BRA {team_score} – {opponent_score} {OPP}`.)

A second query `MarkCelebrationSeen` upserts `(user_id, match_id)` (`INSERT … ON DUPLICATE KEY
UPDATE seen_at = seen_at`) — idempotent.

### 5.3 Store
`CelebrationStore` interface (handlers depend on the interface, per §9 boundary rules):
- `ListPendingCelebrations(ctx, userID) ([]Celebration, error)`
- `MarkCelebrationsSeen(ctx, userID int64, matchIDs []int64) error`

### 5.4 Endpoints (both behind `RequireAuth`, registered in all envs)
- `GET /api/celebrations` → `200 { "celebrations": [ { "match_id", "team_code", "team_score",
  "opponent_code", "opponent_score", "kickoff_utc" } ] }` — unseen celebrated wins, newest-first;
  `{ "celebrations": [] }` when none.
- `POST /api/celebrations/seen` — body `{ "match_ids": [int,…] }` → `200 { "seen": N }`. Idempotent
  upsert. `400` on missing/empty/invalid body. Only marks rows for the authenticated user.

## 6. Frontend

### 6.1 Component port
- `frontend/src/components/VictoryCelebration.tsx` — port of `victory.jsx`:
  - Keep the canvas particle system + `createVictoryAudio()` WebAudio score verbatim (no assets).
  - Swap the prototype's `Icon.trophy` for our `TrophyIcon`; keep `var(--font-display)`.
  - Props: `{ celebration: Celebration; onDone: () => void }`.
- `frontend/src/styles/victory.css` (imported once) — port of `victory.css`. Drop the prototype's
  `.vc-replay-fab` styles (replaced by the admin debug button). Keep `prefers-reduced-motion`.
- Vendor `legends-flag.jpg` (293 KB) → `frontend/public/legends-flag.jpg`; reference as
  `/legends-flag.jpg`. If the file 404s, the radial-gradient background still renders (graceful).

### 6.2 Scorecard addition (new element, in the overlay)
Add a `vc-scoreline` block to `vc-center`, after `vc-sub`, showing the won match:
`{team_code} {team_score} – {opponent_score} {opponent_code}` with the two flags (reuse the `Flag`
component) and the mono/tabular score, styled to the vc- visual language (gold/green gradient, drop
shadow) and revealed after the title (its own keyframe + reduced-motion fallback). Data comes from
the `celebration` prop (§5.4).

### 6.3 Trigger flow
- `useCelebrations()` TanStack Query hook → `GET /api/celebrations` (enabled only when authed).
- In `App.tsx`, after the authenticated shell mounts: if `celebrations.length > 0`, render
  `<VictoryCelebration celebration={celebrations[0]} onDone={…} />` (latest = index 0).
- `onDone` (natural end or Skip): `POST /api/celebrations/seen` with **all** returned `match_ids`
  (the "latest only, mark rest seen" rule), then invalidate the `celebrations` query so it won't
  replay.

### 6.4 Debug replay (admin-only)
A floating "Play victory" button rendered only when `me.role === "admin"` (works in production for
demos). Clicking it replays the overlay locally **without** changing seen-state and without a
`seen` POST. If there's no real pending celebration, it replays against a small hard-coded sample
(e.g. `BRA 3 – 1 JOR`) so admins can always preview.

## 7. File structure

**Backend**
- Create: `backend/migrations/00NN_create_celebration_views.up.sql` / `.down.sql`
- Modify: `backend/internal/store/queries/celebrations.sql` (new) → `make sqlc`
- Create: `backend/internal/store/celebrations.go` (store methods + `Celebration` type + allowlist)
- Create: `backend/internal/httpapi/celebrations_handler.go` (`GetCelebrations`, `PostCelebrationsSeen`)
- Modify: `backend/internal/httpapi/middleware.go` (add `Celebrations CelebrationStore` to `Deps`),
  `router.go` (register the two routes), `cmd/server/main.go` (wire `Celebrations: st`)

**Frontend**
- Create: `frontend/src/components/VictoryCelebration.tsx`, `frontend/src/styles/victory.css`
- Create: `frontend/public/legends-flag.jpg` (vendored from the handoff)
- Create: `frontend/src/lib/celebrations.ts` (`Celebration` type, `useCelebrations`, `useMarkSeen`)
- Modify: `frontend/src/App.tsx` (mount the overlay + admin debug button), `main.tsx`/styles import

**Docs**
- Modify: `docs/REQUIREMENTS.md` — add a "Celebrations" subsection (new user-facing behavior) and
  the two endpoints in the API section; note Brazil-only + server-tracked once-per-user-per-match.

## 8. Testing

**Backend (table-driven)**
- Celebrated-win detection: Brazil home win / Brazil away win / Brazil shootout win / Brazil loss /
  Brazil draw (no shootout) / non-Brazil win / not-final → only the wins for `BRA` qualify.
- `ListPendingCelebrations`: excludes already-seen rows; newest-first ordering.
- `MarkCelebrationsSeen`: idempotent (double-call = one row); only affects the given user.
- Handlers: `GET` returns unseen list + `401` unauthed; `POST /seen` marks + `400` on bad body +
  scopes to the caller.

**Frontend (Vitest)**
- `useCelebrations` fetches and exposes the list.
- Overlay renders the scorecard from the `celebration` prop; "Skip" calls `onDone`.
- `onDone` posts `seen` with **all** pending `match_ids`.
- Debug button renders only for `me.role === "admin"`; replays without posting `seen`.

## 9. Out-of-scope confirmations
- No backend change to scoring/results; celebrations only **read** finalized match data.
- Allowlist stays `{"BRA"}`; widening it later is a one-line change + spec note.
