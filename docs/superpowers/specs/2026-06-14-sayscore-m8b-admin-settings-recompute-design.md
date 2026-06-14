# SayScore — Milestone 8b Design: Admin settings + recompute

**Status:** approved 2026-06-14. Requirements locked in `docs/REQUIREMENTS.md` (§2/§3.6 admin, §5 scoring,
§10 `settings` table, §11 `/api/admin/settings` + `/api/admin/recompute`, §12 security). Second of three
M8 sub-milestones — M8a (match/result/user management) is merged; **M8c** (polished bonus-outcomes
screen) remains.

## Goal

Make the three operational settings (`results_cron`, `weekly_cron`, `bonus_lock_at`) **runtime-editable
by admins** (DB-backed, overriding the env defaults), and add a manual, idempotent **recompute** that
re-derives all materialized points from stored results — without ever changing match results or
already-declared weekly winners.

## Scope

In scope:

- Migration `0009` — a `settings(key, value, updated_at)` table.
- An `internal/settings` package: the key allowlist, per-key validators, and a `Service` that seeds
  from env defaults on boot and reads the DB at runtime.
- `GET /api/admin/settings` + `PUT /api/admin/settings` (validated).
- `bonus_lock_at` read **live** from settings in the bonus handler (replacing the boot-time
  `Deps.BonusLockAt`); `results_cron`/`weekly_cron` read from settings **at boot** by the schedulers.
- `POST /api/admin/recompute` — re-score every FINAL match's predictions + re-materialize bonus
  points, idempotently.
- Frontend: a **Settings** section in the existing Admin screen + a **Recompute** action, built with
  the `impeccable` skill.

Out of scope:

- **Polished bonus-outcomes screen** — M8c.
- **Live cron rescheduling** — cron changes apply on next restart (explicit decision); only
  `bonus_lock_at` is live.
- **Editing the admin list / arbitrary keys** — only the 3 typed keys; promote/demote is M8a.
- Recompute does **not** touch `weekly_results` or match results (see "Recompute" below).

## Data model — migration `0009_create_settings`

```sql
CREATE TABLE settings (
  `key`      VARCHAR(64)  NOT NULL,
  `value`    VARCHAR(255) NOT NULL,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Generic key/value, but the application only ever reads/writes the **three allowlisted keys**.

## Settings: keys, validation, precedence

The `internal/settings` package owns:

- **Keys** (constants): `results_cron`, `weekly_cron`, `bonus_lock_at`. A `Keys` slice + an `IsKey`
  allowlist check — a `PUT` to any other key is rejected (400).
- **Validators** (pure):
  - `results_cron` / `weekly_cron`: parsed with the same `robfig/cron` parser the schedulers use
    (`cron.ParseStandard` / the standard 5-field parser the app already relies on) — invalid → 400.
  - `bonus_lock_at`: `time.Parse(time.RFC3339, …)` — invalid → 400.
- **`Service`** wrapping a `store.SettingsStore` + the env defaults:
  - `EnsureSeeded(ctx, defaults)` — on boot, insert any **missing** key from its env/config default
    (idempotent; never overwrites an existing DB value).
  - `Get(ctx, key) (string, error)` — the DB value (always present after seeding).
  - `BonusLockAt(ctx) (time.Time, error)` — parses the stored `bonus_lock_at`.
  - `All(ctx) (map[string]string, error)` — for the GET endpoint.
  - `SetAll(ctx, map[string]string) error` — validates every provided key+value (allowlist + the
    per-key validator) **before** writing any (validate-all-then-write), then upserts.

**Precedence:** env/config is the **bootstrap default** (seeds the row if absent on boot); the
**settings table is the runtime source of truth** thereafter.

## Liveness

- **`bonus_lock_at` — live.** `Deps.BonusLockAt time.Time` is replaced by `Deps.Settings settings.Service`
  (an interface the handler depends on). `GetBonus`/`PutBonus` call `d.Settings.BonusLockAt(ctx)` per
  request, so an admin edit takes effect immediately (still server-authoritative — the client clock is
  never trusted). On a settings read error the handler fails safe (500, not "unlocked").
- **`results_cron` / `weekly_cron` — on next restart.** `cmd/server` reads them from the settings
  `Service` at boot (after `EnsureSeeded`) to build the schedulers. A live edit is persisted +
  validated but only changes the schedule after a restart; the Settings UI states this.

## API (§11)

- `GET /api/admin/settings` (admin) → `{ "results_cron": "...", "weekly_cron": "...",
  "bonus_lock_at": "2026-06-28T23:59:00+05:30" }`.
- `PUT /api/admin/settings` (admin) → body with any subset of the 3 keys; validates allowlist +
  each value; 400 on unknown key / bad cron / bad timestamp (writes nothing on any failure); returns
  the full updated set. Cron changes carry a server note (`"cron_changes_apply_after_restart": true`)
  when a cron key changed, surfaced by the UI.
- `POST /api/admin/recompute` (admin) → runs the recompute; returns
  `{ "matches_rescored": N, "predictions_updated": N, "bonus_updated": N }`.

All three: `RequireAuth` + `RequireAdmin`, registered in **all** environments; parameterized SQL;
generic 500 + `slog`.

## Recompute (the safety-net)

`POST /api/admin/recompute` re-derives **only materialized points** from the stored source of truth,
idempotently (absolute `SET`, never increment). It is the admin's "rebuild standings from what's
stored" button after a correction, a partial job failure, or a data restore.

**It does:**
1. **Match points** — for every match with `status = final`, build a `scoring.Result` from the stored
   row (`home_score`, `away_score`, `went_to_penalties`, `penalty_winner_team_id`, knockout from
   `stage`), load its predictions, run `scoring.Compute`, and `SetPredictionScore` each (the same
   per-match transaction the ingest + M8a correction use). Includes `manual_override` matches (it uses
   whatever result is stored — it never changes results).
2. **Bonus points** — re-materialize `bonus_predictions.points` from `bonus_results` via `bonus.Score`
   (this is exactly the existing M7 `jobs.BonusScore.Run`, reused).

**It must NOT:**
- change any match result (read-only over `matches`),
- write `weekly_results` — **a declared weekly winner is a historical fact** (the ₹500 may already be
  paid); recompute never rebuilds past winners. The live weekly/overall leaderboards (live SUMs) pick
  up the corrected points immediately for the current/in-progress week; future weeks are declared by
  the Monday weekly-winner cron from the now-correct points.

Idempotent: re-running yields identical stored points. Implemented as `jobs.Recompute{...}.Run(ctx)`
reusing `ResultsStore` (match re-score) + `BonusScoreStore` (bonus) seams; a new
`ListFinalMatches(ctx) ([]MatchForResult+scoreline)` store query feeds the match loop.

## Frontend — Admin **Settings** section + Recompute (impeccable)

The M8a Admin screen's segmented control gains a **Settings** tab (Matches | Users | Settings):

- **Settings form:** three fields — `results_cron`, `weekly_cron` (text, monospace, with a short
  hint + "applies after restart" note), `bonus_lock_at` (a datetime entered/displayed in IST, sent as
  RFC3339; labeled "live"). Inline `role="alert"` validation errors from the 400; Save reconciles with
  the returned set. `useSettings` / `useSaveSettings` TanStack hooks.
- **Recompute:** a button with a confirm dialog ("Recompute all points from stored results? This won't
  change results or past weekly winners.") and, on success, a result summary
  (`N matches rescored · N predictions · N bonus`). `useRecompute` mutation; on success it invalidates
  the leaderboard/bonus queries so the UI refreshes. Non-destructive, but confirmed.
- §7 tokens, JetBrains Mono for the cron/numeric values, ≥44px targets, skeleton/error states.

## Testing (TDD; backend the high-value surface)

- **Validators (pure):** good/bad cron exprs; good/bad RFC3339; unknown key rejected.
- **Service precedence:** `EnsureSeeded` inserts a missing key from default and does **not** overwrite
  an existing value; `Get`/`All` return DB values; `SetAll` validates-all-then-writes (a bad 2nd key
  writes nothing).
- **Bonus lock live:** with `bonus_lock_at` in the past (from settings) `PutBonus` → 403; in the
  future → allowed — driven by the settings value, not a boot constant.
- **Recompute:** re-scores all final matches through the real `scoring.Compute` (exact/correct/wrong/
  penalty bonus); re-materializes bonus points; idempotent (run twice → identical); **asserts
  `weekly_results` and match results are never written** (fakes record zero such calls); summary counts
  correct.
- **Handlers/authz:** `GET/PUT /settings` + `POST /recompute` → 403 non-admin / 401 unauth; PUT 400 on
  bad cron/timestamp/unknown key.
- **Frontend (Vitest):** Settings form renders the 3 values + validation error; cron field shows the
  restart note; Recompute requires confirm then shows the summary.

## Definition of Done

- `0009` applied; `settings` exists and is seeded from env on boot.
- `go vet` + `go test ./...` green incl. validators, the Service precedence, live bonus lock, and
  recompute idempotency + the no-`weekly_results`/no-result-write invariant.
- `GET/PUT /api/admin/settings` validate + persist the 3 keys; `bonus_lock_at` edits take effect live;
  cron edits persist and apply after restart.
- `POST /api/admin/recompute` rebuilds points idempotently and leaves `weekly_results` + match results
  untouched.
- Admin Settings + Recompute UI works (admin-only); frontend type-check + tests + build green.
- `docs/REQUIREMENTS.md` (§11) + OpenAPI updated.
- Live-verified: edit bonus_lock_at → bonus lock state flips; corrupt a prediction's points in the DB →
  recompute restores it; recompute leaves a paid past weekly winner unchanged.
