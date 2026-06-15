# SayScore — Milestone 8c Design: Admin bonus-outcomes screen

**Status:** approved 2026-06-15. Requirements locked in `docs/REQUIREMENTS.md` (§3.4 bonus categories +
points, §3.6 admin, §11 admin API, §12 security). **Third and final** M8 sub-milestone — M8a
(match/result/user mgmt) and M8b (settings + recompute) are merged.

## Goal

Give admins a polished screen to enter/edit the seven tournament-award outcomes, and make saving an
outcome **score it immediately** so the overall leaderboard reflects the winners at once. This closes
the gap M7 left (it shipped only a minimal `PUT /api/admin/bonus/results` + a debug-only scoring trigger,
with no UI and no production-safe scoring path beyond M8b's recompute).

## Scope

In scope:

- `GET /api/admin/bonus/results` (new) — the 7 categories with their current outcome + resolved label.
- `PUT /api/admin/bonus/results` (existing) gains **auto-scoring** after the upsert.
- A 4th Admin tab — **Bonus** — to view/set the 7 outcomes, built with the `impeccable` skill.

Out of scope: nothing deferred — this completes M8. No new migration, no new store query, no new
scoring endpoint (recompute from M8b remains the bulk safety-net; the debug `bonus-score` trigger stays
as a dev convenience).

## Reuses (no new backend plumbing)

Everything the backend needs already exists:

- `store.ListBonusResults(ctx) ([]BonusResult{Category,RefID})` + `UpsertBonusResult` (M7).
- `bonus.Categories` (canonical 7, ordered), `bonus.Points(c)`, `bonus.RefTypeOf(c)` (M7).
- `Deps.Players.TeamNameByID` / `PlayerNameByID` (added in M7 for `GetBonus` label resolution).
- `Deps.JobRunner.RunBonusScore(ctx)` — the idempotent bonus materializer (`jobs.BonusScore`), wired in
  **all** environments via `serverJobs` (only the debug `/admin/jobs/run` *route* is env-gated, not the
  runner). `PutBonusResults` calls it directly for auto-scoring.
- `PutBonusResults` validation (category + ref-type + existence) — unchanged.

## API

### `GET /api/admin/bonus/results` (RequireAuth + RequireAdmin, all environments) — NEW

Returns **all seven** categories in canonical order so the UI renders every row, set or not:

```json
{ "results": [
  { "category": "winner",       "points": 30, "ref_type": "team",   "ref_id": 9,  "label": "Brazil", "set": true },
  { "category": "runner_up",    "points": 20, "ref_type": "team",   "ref_id": 0,  "label": "",       "set": false },
  { "category": "golden_ball",  "points": 10, "ref_type": "player", "ref_id": 42, "label": "Messi",  "set": true },
  { "category": "golden_boot",  "points": 10, "ref_type": "player", "ref_id": 0,  "label": "",       "set": false },
  { "category": "golden_glove", "points": 10, "ref_type": "player", "ref_id": 0,  "label": "",       "set": false },
  { "category": "young_player", "points": 10, "ref_type": "player", "ref_id": 0,  "label": "",       "set": false },
  { "category": "fair_play",    "points": 10, "ref_type": "team",   "ref_id": 0,  "label": "",       "set": false }
] }
```

Handler builds it by iterating `bonus.Categories`, looking up each in a `category→ref_id` map from
`ListBonusResults`, resolving the label via `RefTypeOf` → `TeamNameByID`/`PlayerNameByID`. A stale/
missing ref resolves to an empty label (degrades gracefully, mirroring `GetBonus`). Unset categories
return `ref_id:0, set:false`.

### `PUT /api/admin/bonus/results` (existing) — gains auto-scoring

After the existing validate-all-then-upsert, the handler runs `d.JobRunner.RunBonusScore(ctx)` to
materialize `bonus_predictions.points` from the new outcomes (idempotent). Response becomes
`{ "saved": N, "scored": M }` (M = predictions scored). Behavior:

- Scoring runs in the same request, so the overall leaderboard (a live SUM over
  `bonus_predictions.points`) reflects the winners immediately.
- **Outcomes are persisted before scoring.** If `RunBonusScore` errors, the outcomes are already saved;
  the handler logs the error and returns **500** with a message indicating the save succeeded but
  scoring failed (the admin can re-run via `POST /api/admin/recompute`). This never leaves outcomes
  unsaved.
- If `JobRunner` is nil (only in tests that don't wire it), scoring is skipped and `scored:0` is
  returned — production always has it wired.

Validation, auth (403 non-admin / 401 unauth), and the all-environments registration are unchanged.

## Frontend — Admin **Bonus** tab (impeccable)

The Admin segmented control gains a 4th tab: **Matches | Users | Settings | Bonus**.

- The Bonus panel renders **7 rows** in canonical order from `GET /api/admin/bonus/results`. Each row:
  the category label + its points (mono, e.g. "Golden Boot · 10 pts"), the **current outcome** (the
  resolved team/player name, or a muted "Not set"), and a picker:
  - team awards (winner/runner_up/fair_play) → a **team `<select>`** (reuse `useTeams`);
  - player awards (golden_ball/boot/glove/young_player) → the **searchable player combobox** (reuse
    `usePlayerSearch`, the hand-rolled combobox from the M7 Bonus screen).
- A single **Save outcomes** button PUTs all currently-chosen categories → the server auto-scores; on
  success it invalidates the `["leaderboard"]` and `["bonus"]`/admin queries and shows a confirmation
  (e.g. "Saved · N predictions scored"). Set vs unset rows are visually distinct.
- States: skeleton while loading; `role="alert"` on load/save error; teaching empty/intro line
  ("Enter the seven award winners after the tournament; saving updates standings immediately").
- §7 design system, reusing the M8a/M8b `.admin*` patterns + the M7 picker styles; ≥44px targets,
  focus rings, JetBrains Mono for points, reduced-motion.

## Testing (TDD; backend the high-value surface)

- **`GET /api/admin/bonus/results`:** returns all 7 categories in canonical order; set categories carry
  the resolved team/player label; unset return `set:false, ref_id:0`; a stale ref → empty label; authz
  (403 non-admin / 401 unauth via the router).
- **`PUT` auto-score:** after saving outcomes the handler invokes the bonus scorer and returns
  `scored:M`; a fake `JobRunner` records the call; idempotent (saving twice → same stored points); a
  scorer error → 500 but outcomes still persisted (assert the upsert happened); existing validation 400s
  + authz unchanged.
- **Frontend (Vitest):** renders 7 rows with the correct picker per category (team select vs player
  search), shows current outcomes vs "Not set", and Save triggers the mutation; the player awards use
  the combobox.

## Definition of Done

- `GET /api/admin/bonus/results` returns the 7 categories with labels + set flags; admin-gated, all
  environments.
- Saving outcomes auto-scores: `bonus_predictions.points` materialize and the overall leaderboard
  reflects winners without any separate step; idempotent; a scorer failure surfaces but never loses the
  saved outcomes.
- The Admin **Bonus** tab lets an admin set/edit all 7 outcomes (team + player pickers) and save;
  built with `impeccable`.
- `go vet` + `go test ./...` and `pnpm tsc --noEmit` + `pnpm vitest run` + `pnpm build` all green.
- `docs/REQUIREMENTS.md` (§11) + OpenAPI updated for the new GET + the auto-scoring PUT response.
- Live-verified: set the 7 winners on the screen → overall leaderboard bonus points update immediately;
  re-saving is idempotent; a non-admin gets 403.
