# SayScore — Milestone 8a Design: Admin foundation + match/result management + users

**Status:** approved 2026-06-14. Requirements remain locked in `docs/REQUIREMENTS.md` (§2 roles, §3.6 admin
features, §5 scoring, §11 admin API, §12 security). M8 (admin tools) is decomposed into three
sub-milestones; this is **M8a**, the first. M8b (settings table + recompute) and M8c (polished
bonus-outcomes screen) follow as their own spec → plan → execute cycles.

## Goal

Give admins the core operational tools — a role-gated **Admin screen** with **match CRUD**, **result +
penalty-shootout-winner correction** (setting `manual_override` and immediately re-scoring), and **user
promote/demote** — plus the admin frontend shell that M8b/M8c reuse.

## Scope

In scope:

- Backend admin endpoints (all `RequireAdmin`, registered in **all** environments — like
  `/api/admin/winners/paid`, NOT debug-gated):
  - `GET /api/admin/matches` — full match list for management.
  - `POST /api/admin/matches` — create a fixture.
  - `PUT /api/admin/matches/:id` — edit fixture detail.
  - `DELETE /api/admin/matches/:id` — delete (predictions cascade).
  - `PUT /api/admin/matches/:id/result` — set/correct the result + immediately re-score.
  - `GET /api/admin/users` — list users.
  - `POST /api/admin/users/:id/role` — promote/demote (guarded).
- The `manual_override` invariant on every admin match write; immediate idempotent re-score on result
  correction (reuses the M5 `ResultsStore` tx).
- Frontend: an **Admin** nav entry (role-gated) + an Admin screen with **Matches** and **Users**
  sections, built with the `impeccable` skill; confirm dialogs for destructive actions.

Out of scope (other sub-milestones / deferred):

- **Settings table + runtime cron/bonus-lock + `POST /api/admin/recompute`** — M8b.
- **Polished bonus-outcomes screen** — M8c (the minimal `PUT /api/admin/bonus/results` already ships).
- **`POST /api/admin/fixtures/sync`** — deferred (the WC dataset is a committed static CSV; admins
  correct individual fixtures via match CRUD).

## Data model

No new migrations. The `matches` table already has every needed column (`stage`, `round`,
`home_team_id`, `away_team_id`, `kickoff_utc`, `status`, `home_score`, `away_score`,
`went_to_penalties`, `penalty_winner_team_id`, `manual_override`). `predictions.match_id` already has
`ON DELETE CASCADE` (verified), so deleting a match removes its predictions automatically. `users` has
`role`. M8a is API + store + frontend only.

## The `manual_override` invariant

§2: *"Any admin edit to a match (fixture detail or result) sets a `manual_override` flag so the
scheduled results job never overwrites a human correction."* Therefore **every** admin match write
(`POST`, `PUT` detail, `PUT result`) sets `manual_override = 1`. The M5 results-ingest already skips
`manual_override` matches (tested) — M8a adds tests asserting the flag is set and the skip still holds.
Admin-created matches have no `api_fixture_id`, so the ingest cannot match them anyway; the flag is
belt-and-suspenders.

## Re-scoring on result correction

`PUT /api/admin/matches/:id/result` reuses the M5 `ResultsStore` machinery (`WithTx`,
`UpdateMatchResult`, `ListPredictionsForMatch`, `SetPredictionScore`) and the pure `scoring.Compute`:
in **one transaction** it updates the match result (status `final`, scores, penalties, penalty winner,
`manual_override=1`) then re-scores every prediction on that match (absolute `SET`, idempotent). Because
leaderboards are **live SUMs over `predictions.points`**, weekly + overall standings are correct
immediately. The stored `weekly_results` winner snapshot (Hall of Fame) for a *past* week is **not**
rewritten here — it refreshes on the next weekly-winner job or a manual recompute (M8b). This is noted
in the admin UI ("past-week winner badges update on the next weekly run").

## API (§11)

### Matches (all `RequireAuth` + `RequireAdmin`)

- `GET /api/admin/matches` → `[{ id, match_number, stage, round, home_team_id, home_team, away_team_id,
  away_team, kickoff_utc, status, home_score, away_score, went_to_penalties, penalty_winner_team_id,
  manual_override }]` (team names resolved for display; ordered by `kickoff_utc`).
- `POST /api/admin/matches` body `{ home_team_id, away_team_id, kickoff_utc, stage, round?,
  match_number? }` → 201 with the created match. Validates: distinct existing teams, RFC3339
  `kickoff_utc`, `stage ∈ {group,knockout}`. Sets `manual_override=1`, `status=scheduled`.
- `PUT /api/admin/matches/:id` body `{ home_team_id, away_team_id, kickoff_utc, stage, round? }` →
  200 updated match. Edits fixture detail only (not scores); sets `manual_override=1`. 404 if absent.
- `DELETE /api/admin/matches/:id` → 204. Cascades predictions. 404 if absent.
- `PUT /api/admin/matches/:id/result` body `{ home_score, away_score, went_to_penalties,
  penalty_winner_team_id? }` → 200 with the updated match. Sets `status=final`, `manual_override=1`,
  re-scores predictions in one tx. Validation: non-negative scores; if `went_to_penalties` then the
  match must be knockout and `penalty_winner_team_id` must be the home or away team; 400 otherwise.

### Users (all `RequireAuth` + `RequireAdmin`)

- `GET /api/admin/users` → `[{ id, email, name, avatar_url, role }]` ordered by name/email.
- `POST /api/admin/users/:id/role` body `{ role: "admin" | "user" }` → 200 `{ id, role }`.
  **Guards:** an admin cannot demote **themselves** (400 "cannot change your own role"); the **last
  remaining admin** cannot be demoted (400 "cannot remove the last admin"). Unknown user → 404; bad
  role → 400.

All admin endpoints: non-admin → 403 (`RequireAdmin`), unauthenticated → 401 (`RequireAuth`),
parameterized SQL only, generic 500 messages + `slog`.

## Store (new methods on `*SQLStore`, thin sqlc pass-throughs)

- `AdminMatchStore`: `ListMatchesForAdmin(ctx) ([]AdminMatch, error)`, `CreateMatch(ctx, params)
  (int64, error)`, `UpdateMatchDetail(ctx, params) error`, `DeleteMatch(ctx, id) error`,
  `GetMatchForResult(ctx, id) (MatchForResult, error)` (for the result endpoint to know stage + team
  ids). Result correction reuses the existing `ResultsStore` (`WithTx`/`UpdateMatchResult`/
  `ListPredictionsForMatch`/`SetPredictionScore`).
- `AdminUserStore`: `ListUsers(ctx) ([]User, error)`, `CountAdmins(ctx) (int64, error)`, plus the
  existing `SetUserRole`. The last-admin guard reads `CountAdmins` + the target's current role inside
  the role handler.

All new queries go in `internal/store/queries/`, regenerated with `make sqlc`.

## Frontend — Admin screen (impeccable)

- **Nav:** the topbar nav (currently Predictions | Bonus) gains an **Admin** item rendered only when
  `me.role === "admin"`; selecting it shows `<Admin/>`.
- **Admin screen** with two sections (a simple in-page segmented control, consistent with the existing
  Home/Bonus toggles — no router):
  - **Matches:** a list grouped by IST date with each match's teams, kickoff (IST), status, and score;
    actions per row — **Edit detail**, **Set/Correct result**, **Delete** (confirm). A **New match**
    form. Team pickers reuse `GET /api/teams`; kickoff is entered in IST and converted to UTC at the
    edge. The result form shows the penalty-winner picker only for knockout + went-to-penalties.
  - **Users:** a list with name/email + a role badge and a **Make admin / Make user** toggle (confirm
    on demote). The current user's own row shows the role but no toggle (self-demote blocked).
  - Destructive actions use a confirm dialog; `--danger` styling; optimistic updates reconciled with
    the server; skeletons / `role="alert"` errors / teaching empty states. TanStack Query hooks
    (`useAdminMatches`, `useAdminUsers`, mutations that invalidate their lists).
- §7 design system throughout (dark tokens, JetBrains Mono for scores/dates, ≥44px targets, focus
  rings, reduced-motion).

## Testing (TDD; backend the high-value surface)

- **Authorization:** each `/api/admin/*` path → 403 for a non-admin, 401 unauthenticated (router-level).
- **manual_override:** create/edit/result each set `manual_override=1`; an ingest run still skips a
  `manual_override` match (reuse the M5 invariant test).
- **Result correction re-scores idempotently:** a corrected result re-scores its predictions through
  the real `scoring.Compute` (exact → 5, correct → 3, wrong → 0, knockout-shootout draw → +1);
  running the correction twice yields identical stored points.
- **Delete cascades:** deleting a match removes its predictions (and their points leave the live
  leaderboard sums).
- **User role guards:** promote works; demoting yourself → 400; demoting the last admin → 400;
  demoting a non-last admin works; unknown id → 404; bad role → 400.
- **Validation:** match create/edit reject non-existent or identical teams, bad `kickoff_utc`, bad
  `stage`; result rejects negative scores and a penalty winner that isn't one of the two teams / a
  non-knockout shootout → 400.
- **Frontend (Vitest):** Admin nav appears only for admins; the match list renders with actions; the
  result form reveals the penalty-winner picker only for knockout+penalties; the user row for self
  has no demote control; a confirm is required before delete.

## Definition of Done

- `go vet` + `go test ./...` green incl. the admin handlers, the re-score reuse, and the role guards.
- All seven admin endpoints behave per spec; every one is admin-gated and present in all environments;
  `manual_override` set on every admin match write and the ingest-skip invariant still holds.
- Result correction re-scores predictions in a tx (idempotent); delete cascades predictions.
- Admin nav + screen render only for admins; matches CRUD + result correction + user role toggle work
  end-to-end; frontend type-check + tests green; built with `impeccable`.
- `docs/REQUIREMENTS.md` (§11) + OpenAPI updated for the new admin endpoints.
- Live-verified: create a match, correct a result (predictions re-score, leaderboard reflects it),
  delete a match, promote/demote a user (guards enforced).
