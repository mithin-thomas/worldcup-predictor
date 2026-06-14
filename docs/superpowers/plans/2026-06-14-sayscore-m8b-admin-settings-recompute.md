# Admin settings + recompute (M8b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DB-backed, runtime-editable admin settings (`results_cron`, `weekly_cron`, `bonus_lock_at`) overriding env defaults, plus an idempotent `POST /api/admin/recompute` that re-derives materialized points from stored results — never touching `weekly_results` or match results.

**Architecture:** A `settings(key,value)` table (migration `0009`) + an `internal/settings` package (pure validators + a `Service` that seeds from env on boot and reads the DB at runtime). The bonus handler consults the Service for a **live** `bonus_lock_at` (replacing the boot-time `Deps.BonusLockAt`); the schedulers read cron values from the Service **at boot**. Recompute is a `jobs.Recompute` reusing the `ResultsStore` re-score tx over all FINAL matches + the existing `jobs.BonusScore` for bonus points.

**Tech Stack:** Go 1.26 · chi/v5 · sqlc · MySQL 8 · robfig/cron/v3 · React 18 + TS + Vite · TanStack Query · Vitest.

**Branch:** `feat/m8b-admin-settings-recompute` (already created off `main`).

**Spec:** `docs/superpowers/specs/2026-06-14-sayscore-m8b-admin-settings-recompute-design.md`.

**Conventions:** pure package = no I/O; thin sqlc pass-throughs (`store: …: %w`); handlers reuse `now()`/`writeJSON`/`writeError`, generic 500 + `slog`; server-authoritative; Conventional Commits per task; `gofmt -w` + `go vet`.

---

## File structure

- `backend/migrations/0009_create_settings.{up,down}.sql` (create).
- `backend/internal/store/queries/settings.sql` — GetSetting, UpsertSetting, ListSettings; + `ListFinalMatches` (in admin.sql or matches.sql) (create/modify).
- `backend/internal/store/settings.go` — `SettingsStore` + methods; `ListFinalMatches` store method (create/modify).
- `backend/internal/settings/settings.go` — keys + validators (create).
- `backend/internal/settings/service.go` — `Service` (create).
- `backend/internal/settings/*_test.go` (create).
- `backend/internal/jobs/recompute.go` (+ test) — the recompute job (create).
- `backend/internal/httpapi/admin_settings_handler.go` (+ test) — settings + recompute handlers (create).
- `backend/internal/httpapi/middleware.go` — `Deps.Settings` (replaces `Deps.BonusLockAt`), `Deps.Recompute` (modify).
- `backend/internal/httpapi/bonus_handler.go` (+ test) — read lock live from `d.Settings` (modify).
- `backend/internal/httpapi/router.go` — register routes (modify).
- `backend/cmd/server/main.go` — seed settings on boot, wire Deps.Settings + schedulers from settings + recompute (modify).
- `frontend/src/lib/admin.ts` — settings + recompute hooks (modify).
- `frontend/src/routes/Admin.tsx` (+ test) — Settings tab + Recompute (modify).
- `frontend/src/styles/tokens.css` (modify).
- `docs/REQUIREMENTS.md` + `backend/internal/httpapi/openapi.yaml` (modify).

---

## Task 1: Migration 0009 + sqlc (settings + ListFinalMatches)

**Files:** Create `backend/migrations/0009_create_settings.{up,down}.sql`, `backend/internal/store/queries/settings.sql`; add `ListFinalMatches` to `queries/matches.sql`; regenerate.

- [ ] **Step 1: migration up/down**

`0009_create_settings.up.sql`:
```sql
CREATE TABLE settings (
  `key`      VARCHAR(64)  NOT NULL,
  `value`    VARCHAR(255) NOT NULL,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```
`0009_create_settings.down.sql`: `DROP TABLE settings;`

- [ ] **Step 2: queries**

`backend/internal/store/queries/settings.sql`:
```sql
-- name: GetSetting :one
SELECT value FROM settings WHERE `key` = ?;

-- name: UpsertSetting :exec
INSERT INTO settings (`key`, `value`) VALUES (?, ?)
ON DUPLICATE KEY UPDATE value = VALUES(value);

-- name: ListSettings :many
SELECT `key`, value FROM settings;
```

Append to `backend/internal/store/queries/matches.sql` — all FINAL matches with the fields recompute needs:
```sql
-- name: ListFinalMatches :many
SELECT id, stage, home_team_id, away_team_id, home_score, away_score,
       went_to_penalties, penalty_winner_team_id
FROM matches WHERE status = 'final';
```

- [ ] **Step 3: apply + regenerate**

Run: `make migrate-up && make sqlc && cd backend && go build ./...`
Verify `settings` table exists. Note generated names (`ListFinalMatchesRow`, etc.).

- [ ] **Step 4: commit**

```bash
git add backend/migrations/0009_create_settings.up.sql backend/migrations/0009_create_settings.down.sql backend/internal/store/queries backend/internal/store/sqlc
git commit -m "feat(db): settings table + ListFinalMatches query"
```

---

## Task 2: Settings package — validators (pure, TDD)

**Files:** Create `backend/internal/settings/settings.go` + `settings_test.go`.

- [ ] **Step 1: failing test**

```go
package settings

import "testing"

func TestIsKey(t *testing.T) {
	if !IsKey(KeyResultsCron) || !IsKey(KeyWeeklyCron) || !IsKey(KeyBonusLockAt) {
		t.Fatal("known keys must be valid")
	}
	if IsKey("nope") || IsKey("") {
		t.Fatal("unknown key must be invalid")
	}
	if len(Keys) != 3 {
		t.Fatalf("Keys = %d, want 3", len(Keys))
	}
}

func TestValidate(t *testing.T) {
	good := map[string]string{
		KeyResultsCron:  "0 3,8,13 * * *",
		KeyWeeklyCron:   "30 13 * * 1",
		KeyBonusLockAt:  "2026-06-28T23:59:00+05:30",
	}
	for k, v := range good {
		if err := Validate(k, v); err != nil {
			t.Errorf("Validate(%s,%q) unexpected error: %v", k, v, err)
		}
	}
	bad := map[string]string{
		KeyResultsCron: "not a cron",
		KeyWeeklyCron:  "61 99 * * *",
		KeyBonusLockAt: "28-06-2026",
	}
	for k, v := range bad {
		if err := Validate(k, v); err == nil {
			t.Errorf("Validate(%s,%q) expected error", k, v)
		}
	}
	if err := Validate("unknown", "x"); err == nil {
		t.Error("unknown key must error")
	}
}
```

- [ ] **Step 2: RED** → `cd backend && go test ./internal/settings/ -v`.

- [ ] **Step 3: implement**

`backend/internal/settings/settings.go`:
```go
// Package settings owns the runtime-configurable admin settings: the allowlisted
// keys, their pure validators, and (in service.go) a DB-backed Service with
// env-default seeding. No HTTP here.
package settings

import (
	"fmt"
	"time"

	"github.com/robfig/cron/v3"
)

const (
	KeyResultsCron = "results_cron"
	KeyWeeklyCron  = "weekly_cron"
	KeyBonusLockAt = "bonus_lock_at"
)

// Keys is the canonical allowlist (and display order).
var Keys = []string{KeyResultsCron, KeyWeeklyCron, KeyBonusLockAt}

func IsKey(k string) bool {
	for _, kk := range Keys {
		if kk == k {
			return true
		}
	}
	return false
}

// cronParser matches the standard 5-field spec the schedulers use.
var cronParser = cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)

func ValidateCron(v string) error {
	if _, err := cronParser.Parse(v); err != nil {
		return fmt.Errorf("invalid cron expression: %w", err)
	}
	return nil
}

func ValidateLockAt(v string) error {
	if _, err := time.Parse(time.RFC3339, v); err != nil {
		return fmt.Errorf("invalid timestamp (want RFC3339): %w", err)
	}
	return nil
}

// Validate checks an allowlisted key + its value.
func Validate(key, value string) error {
	switch key {
	case KeyResultsCron, KeyWeeklyCron:
		return ValidateCron(value)
	case KeyBonusLockAt:
		return ValidateLockAt(value)
	default:
		return fmt.Errorf("unknown setting key: %s", key)
	}
}
```

(Confirm the schedulers use the standard 5-field parser — `startResultsCron` calls `c.AddFunc(cfg.ResultsCron, …)` and `cron.New()` defaults to the standard parser. Match that parser here so validation == what the scheduler accepts.)

- [ ] **Step 4: GREEN** + commit `feat(settings): allowlisted keys + pure cron/timestamp validators`.

---

## Task 3: Settings Service (TDD)

**Files:** Create `backend/internal/settings/service.go` + extend `settings_test.go`.

- [ ] **Step 1: failing test** (fake in-memory Store): `EnsureSeeded` inserts a missing key from defaults and does NOT overwrite an existing value; `Get`/`All` return DB values; `BonusLockAt` parses the stored value; `SetAll` validates-all-then-writes (bad 2nd key → error, nothing written).

```go
type memStore struct{ m map[string]string }
func (s *memStore) GetSetting(_ context.Context, k string) (string, bool, error) { v, ok := s.m[k]; return v, ok, nil }
func (s *memStore) UpsertSetting(_ context.Context, k, v string) error { s.m[k] = v; return nil }
func (s *memStore) ListSettings(_ context.Context) (map[string]string, error) { return s.m, nil }

func TestServiceSeedAndSet(t *testing.T) {
	st := &memStore{m: map[string]string{KeyBonusLockAt: "2026-06-28T23:59:00+05:30"}}
	svc := &Service{Store: st, Defaults: map[string]string{
		KeyResultsCron: "0 3,8,13 * * *", KeyWeeklyCron: "30 13 * * 1", KeyBonusLockAt: "2099-01-01T00:00:00+05:30",
	}}
	if err := svc.EnsureSeeded(context.Background()); err != nil { t.Fatal(err) }
	// missing keys seeded; existing bonus_lock_at NOT overwritten
	if st.m[KeyResultsCron] != "0 3,8,13 * * *" { t.Error("results_cron not seeded") }
	if st.m[KeyBonusLockAt] != "2026-06-28T23:59:00+05:30" { t.Error("existing value must not be overwritten") }
	// SetAll validate-all-then-write: a bad cron rejects the whole batch
	err := svc.SetAll(context.Background(), map[string]string{KeyWeeklyCron: "0 0 * * 1", KeyResultsCron: "bad"})
	if err == nil { t.Fatal("bad cron must error") }
	if st.m[KeyWeeklyCron] == "0 0 * * 1" { t.Error("must not write any key when one is invalid") }
}
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: implement** `service.go`:
```go
package settings

import (
	"context"
	"time"
)

type Store interface {
	GetSetting(ctx context.Context, key string) (string, bool, error)
	UpsertSetting(ctx context.Context, key, value string) error
	ListSettings(ctx context.Context) (map[string]string, error)
}

// Service is the DB-backed settings provider. Defaults are the env/config
// bootstrap values used to seed missing keys; the DB is the runtime truth.
type Service struct {
	Store    Store
	Defaults map[string]string
}

// EnsureSeeded inserts any missing allowlisted key from Defaults (idempotent;
// never overwrites an existing DB value).
func (s *Service) EnsureSeeded(ctx context.Context) error {
	for _, k := range Keys {
		if _, ok, err := s.Store.GetSetting(ctx, k); err != nil {
			return err
		} else if ok {
			continue
		}
		if def, ok := s.Defaults[k]; ok {
			if err := s.Store.UpsertSetting(ctx, k, def); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Service) Get(ctx context.Context, key string) (string, error) {
	v, ok, err := s.Store.GetSetting(ctx, key)
	if err != nil {
		return "", err
	}
	if !ok {
		return s.Defaults[key], nil // fallback if somehow unseeded
	}
	return v, nil
}

func (s *Service) All(ctx context.Context) (map[string]string, error) {
	db, err := s.Store.ListSettings(ctx)
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(Keys))
	for _, k := range Keys {
		if v, ok := db[k]; ok {
			out[k] = v
		} else {
			out[k] = s.Defaults[k]
		}
	}
	return out, nil
}

func (s *Service) BonusLockAt(ctx context.Context) (time.Time, error) {
	v, err := s.Get(ctx, KeyBonusLockAt)
	if err != nil {
		return time.Time{}, err
	}
	return time.Parse(time.RFC3339, v)
}

// SetAll validates every key+value (allowlist + per-key validator) before
// writing any, then upserts each.
func (s *Service) SetAll(ctx context.Context, kv map[string]string) error {
	for k, v := range kv {
		if !IsKey(k) {
			return fmt.Errorf("unknown setting key: %s", k)
		}
		if err := Validate(k, v); err != nil {
			return err
		}
	}
	for k, v := range kv {
		if err := s.Store.UpsertSetting(ctx, k, v); err != nil {
			return err
		}
	}
	return nil
}
```
(add `"fmt"` import.)

- [ ] **Step 4: GREEN** + commit `feat(settings): DB-backed Service (seed-from-env, live read, validate-all SetAll)`.

---

## Task 4: Store — SettingsStore + ListFinalMatches

**Files:** Create `backend/internal/store/settings.go`.

- [ ] **Step 1:** implement the `settings.Store` methods on `*SQLStore` (`GetSetting` → `(value,found,error)` mapping `sql.ErrNoRows`→`("",false,nil)`; `UpsertSetting`; `ListSettings` → `map[string]string`) and `ListFinalMatches(ctx) ([]MatchForResult-like)` returning the scoreline fields recompute needs (reuse/extend a struct — e.g. a new `FinalMatch` type with ID, Stage, Home/AwayTeamID, HomeScore/AwayScore (*int), WentToPenalties, PenaltyWinnerTeamID). Add a compile-time guard `var _ settings.Store = (*SQLStore)(nil)`.

- [ ] **Step 2:** `cd backend && go build ./... && go vet ./...`.

- [ ] **Step 3:** commit `feat(store): SettingsStore (get/upsert/list) + ListFinalMatches`.

---

## Task 5: Recompute job (TDD)

**Files:** Create `backend/internal/jobs/recompute.go` + `recompute_test.go`.

- [ ] **Step 1: failing test** — fake store returns 2 final matches + their predictions + a fake BonusScore store; assert predictions re-scored via real `scoring.Compute`, bonus re-materialized, idempotent (run twice identical), and **assert no `weekly_results` write and no match-result write occurred** (the fakes expose only re-score + bonus setters; there is no method to write results/weekly_results, which structurally enforces the invariant — assert the summary counts).

- [ ] **Step 2: RED.**

- [ ] **Step 3: implement** `recompute.go`:
```go
package jobs

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/sayonetech/worldcup-predictor/backend/internal/scoring"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

// RecomputeStore is the read/re-score surface recompute needs (no result writes,
// no weekly_results — by construction it cannot touch those).
type RecomputeStore interface {
	ListFinalMatches(ctx context.Context) ([]store.FinalMatch, error)
	ListPredictionsForMatch(ctx context.Context, matchID int64) ([]store.PredictionToScore, error)
	SetPredictionScore(ctx context.Context, predictionID int64, points, penaltyBonus int32) error
}

type Recompute struct {
	Store RecomputeStore
	Bonus BonusScore // reuse the M7 bonus materialiser
}

type RecomputeSummary struct {
	MatchesRescored    int `json:"matches_rescored"`
	PredictionsUpdated int `json:"predictions_updated"`
	BonusUpdated       int `json:"bonus_updated"`
}

func (j Recompute) Run(ctx context.Context) (RecomputeSummary, error) {
	matches, err := j.Store.ListFinalMatches(ctx)
	if err != nil {
		return RecomputeSummary{}, fmt.Errorf("jobs: list final matches: %w", err)
	}
	sum := RecomputeSummary{}
	for _, m := range matches {
		preds, err := j.Store.ListPredictionsForMatch(ctx, m.ID)
		if err != nil {
			return RecomputeSummary{}, fmt.Errorf("jobs: list predictions match=%d: %w", m.ID, err)
		}
		res := scoring.Result{
			Final: true, Knockout: m.Stage == store.StageKnockout,
			Home: int(m.HomeScore), Away: int(m.AwayScore),
			WentToPenalties: m.WentToPenalties, PenaltyWinner: m.PenaltyWinnerTeamID,
		}
		for _, p := range preds {
			sc := scoring.Compute(
				scoring.Prediction{Home: int(p.HomeScore), Away: int(p.AwayScore), PenaltyWinner: p.PenaltyWinnerTeamID},
				res,
			)
			if err := j.Store.SetPredictionScore(ctx, p.ID, int32(sc.Points), int32(sc.PenaltyBonus)); err != nil {
				return RecomputeSummary{}, fmt.Errorf("jobs: set score pred=%d: %w", p.ID, err)
			}
			sum.PredictionsUpdated++
		}
		sum.MatchesRescored++
	}
	bs, err := j.Bonus.Run(ctx)
	if err != nil {
		return RecomputeSummary{}, fmt.Errorf("jobs: recompute bonus: %w", err)
	}
	sum.BonusUpdated = bs.Scored
	slog.Info("recompute complete", "matches", sum.MatchesRescored, "predictions", sum.PredictionsUpdated, "bonus", sum.BonusUpdated)
	return sum, nil
}
```
(`store.FinalMatch` is the Task-4 type; `HomeScore/AwayScore` are non-null on FINAL matches — model as `int32`; if the columns are nullable, treat NULL as 0.)

- [ ] **Step 4: GREEN** + commit `feat(jobs): idempotent recompute (re-score finals + bonus; never writes results/weekly_results)`.

---

## Task 6: Handlers — settings + recompute + live bonus lock (TDD)

**Files:** Create `backend/internal/httpapi/admin_settings_handler.go` (+ test); modify `middleware.go`, `bonus_handler.go` (+ its test).

- [ ] **Step 1: middleware.go** — define the handler-facing interfaces and swap `Deps`:
```go
type SettingsProvider interface {
	BonusLockAt(ctx context.Context) (time.Time, error)
	All(ctx context.Context) (map[string]string, error)
	SetAll(ctx context.Context, kv map[string]string) error
}
type RecomputeRunner interface {
	Run(ctx context.Context) (any, error) // or a concrete summary; see note
}
```
Replace `BonusLockAt time.Time` in `Deps` with `Settings SettingsProvider`; add `Recompute RecomputeRunner` (or reuse `JobRunner` with a new method — but a small dedicated interface is cleaner). `settings.Service` satisfies `SettingsProvider`. For `RecomputeRunner`, wrap `jobs.Recompute` in `cmd/server` with a `Run(ctx)(any,error)` adapter (like `serverJobs`).

- [ ] **Step 2: bonus_handler.go** — replace `d.BonusLockAt` reads with the live Service:
```go
func (d *Deps) lockAt(ctx context.Context) (time.Time, bool) {
	t, err := d.Settings.BonusLockAt(ctx)
	if err != nil { return time.Time{}, false }
	return t, true
}
```
In `GetBonus`: `lock, ok := d.lockAt(r.Context()); if !ok { slog.Error(...); writeError(w, 500, "settings unavailable"); return }` then use `lock` for `LockAt`/`Locked`. In `PutBonus`: same — fail safe (500, never silently unlocked) if the read errors. Update the bonus handler tests: replace `Deps{… BonusLockAt: t}` with `Deps{… Settings: fakeSettings{lockAt: t}}` (a tiny fake returning a fixed time). [~8 sites.]

- [ ] **Step 3: failing tests** for the new handlers (`admin_settings_handler_test.go`):
  - `GET /api/admin/settings` → 200 with the 3 keys (fake Settings.All).
  - `PUT /api/admin/settings` valid → 200 (fake records SetAll); bad cron / bad timestamp / unknown key → 400 (fake SetAll returns the validation error, or validate in the handler before calling — see impl); ensure nothing partially written is asserted at the Service layer (Task 3 covers that).
  - `POST /api/admin/recompute` → 200 with the summary (fake RecomputeRunner).

- [ ] **Step 4: implement** `admin_settings_handler.go`:
```go
func (d *Deps) GetAdminSettings(w http.ResponseWriter, r *http.Request) {
	all, err := d.Settings.All(r.Context())
	if err != nil { slog.Error("admin settings list", "err", err); writeError(w, http.StatusInternalServerError, "could not load settings"); return }
	writeJSON(w, http.StatusOK, all)
}

func (d *Deps) PutAdminSettings(w http.ResponseWriter, r *http.Request) {
	var body map[string]string
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil { writeError(w, http.StatusBadRequest, "invalid JSON body"); return }
	if len(body) == 0 { writeError(w, http.StatusBadRequest, "no settings provided"); return }
	if err := d.Settings.SetAll(r.Context(), body); err != nil {
		// validation errors are user errors → 400; everything else 500
		writeError(w, http.StatusBadRequest, err.Error()) // NOTE: SetAll returns only validation/store errors; see refinement below
		return
	}
	all, err := d.Settings.All(r.Context())
	if err != nil { slog.Error("admin settings reload", "err", err); writeError(w, http.StatusInternalServerError, "saved, but could not reload"); return }
	writeJSON(w, http.StatusOK, all)
}

func (d *Deps) PostRecompute(w http.ResponseWriter, r *http.Request) {
	summary, err := d.Recompute.Run(r.Context())
	if err != nil { slog.Error("admin recompute", "err", err); writeError(w, http.StatusInternalServerError, "recompute failed"); return }
	writeJSON(w, http.StatusOK, summary)
}
```
Refinement to avoid leaking store errors as 400: have `SetAll` validation errors be a distinct sentinel/type, OR validate in the handler first (loop `settings.Validate(k,v)` → 400) and only then call a store-only `SetAll`. Prefer: handler validates each key via `settings.Validate` (and `settings.IsKey`) returning 400 with the message; then calls `SetAll` which (defensively) re-validates. This keeps 400 (user) vs 500 (store) clean. Adjust the impl + tests accordingly.

- [ ] **Step 5: GREEN** (`go test ./internal/httpapi/...`) + commit `feat(api): GET/PUT /admin/settings + POST /admin/recompute; live bonus lock from settings`.

---

## Task 7: Wire routes + main.go

**Files:** Modify `router.go`, `cmd/server/main.go`.

- [ ] **Step 1: routes** — in `router.go` under `priv.With(d.RequireAdmin)` (unconditional):
```go
			priv.With(d.RequireAdmin).Get("/admin/settings", d.GetAdminSettings)
			priv.With(d.RequireAdmin).Put("/admin/settings", d.PutAdminSettings)
			priv.With(d.RequireAdmin).Post("/admin/recompute", d.PostRecompute)
```

- [ ] **Step 2: main.go** —
  - Build `settingsSvc := &settings.Service{Store: st, Defaults: map[string]string{ settings.KeyResultsCron: cfg.ResultsCron, settings.KeyWeeklyCron: cfg.WeeklyCron, settings.KeyBonusLockAt: cfg.BonusLockAt.Format(time.RFC3339) }}`; call `settingsSvc.EnsureSeeded(ctx)` on boot (log + continue on error).
  - `deps.Settings = settingsSvc`; remove `deps.BonusLockAt`.
  - Schedulers read cron from settings at boot: `rc, _ := settingsSvc.Get(ctx, settings.KeyResultsCron)` (fallback `cfg.ResultsCron`); pass into `startResultsCron`/`startWeeklyCron` (adjust their signatures to take the cron string instead of `cfg`). Keep env as the seed.
  - Build `jobs.Recompute{Store: st, Bonus: jobs.BonusScore{Store: st}}` and a `recomputeAdapter{r}` implementing `RecomputeRunner.Run(ctx)(any,error)`; set `deps.Recompute`.

- [ ] **Step 3:** authz test (table) — `GET/PUT /admin/settings`, `POST /admin/recompute` → 403 non-admin / 401 unauth. Then `go build ./... && go vet ./... && go test ./...` green.

- [ ] **Step 4:** commit `feat(server): seed settings on boot, schedulers + bonus lock from settings, wire recompute`.

---

## Task 8: Frontend — Settings tab + Recompute (impeccable)

**Files:** Modify `frontend/src/lib/admin.ts`, `frontend/src/routes/Admin.tsx` (+ test), `frontend/src/styles/tokens.css`.

**Contract (impeccable / §7):** a third **Settings** tab in the Admin segmented control (Matches | Users | Settings). Build with the `impeccable` skill.

- [ ] **Step 1: hooks** in `admin.ts`: `useSettings()` (GET `/admin/settings`), `useSaveSettings()` (PUT, invalidate `["admin","settings"]` + `["bonus"]`), `useRecompute()` (POST `/admin/recompute`; onSuccess invalidate `["leaderboard"]`/`["bonus"]`/`["winners"]`).

- [ ] **Step 2: failing test** (mock `../lib/admin` + `../lib/auth`): Settings form renders the 3 values; the cron fields show an "applies after restart" note; a 400 renders a `role="alert"`; the Recompute button requires confirm then shows the returned summary.

- [ ] **Step 3: implement** the Settings section: three labeled fields (`results_cron`, `weekly_cron` mono text inputs with a hint + restart note; `bonus_lock_at` a datetime-local in IST → RFC3339 on save, labeled "live"), Save with inline validation errors; a **Recompute** button → confirm dialog ("Recompute all points from stored results? Won't change results or past winners.") → on success show `N matches · N predictions · N bonus`. Reuse the M8a `.admin*` styles; add `.admin-settings*` as needed (impeccable).

- [ ] **Step 4:** `cd frontend && pnpm tsc --noEmit && pnpm vitest run` green. Commit `feat(frontend): admin Settings tab + Recompute action (impeccable)`.

---

## Task 9: Docs — REQUIREMENTS.md + OpenAPI

- [ ] §11: document `GET/PUT /api/admin/settings` (3 keys, validated; bonus_lock_at live, cron on-restart) + `POST /api/admin/recompute` (idempotent points rebuild; never touches weekly_results/results). Note settings precedence (env seeds → DB wins).
- [ ] `openapi.yaml`: add the 3 paths + schemas; keep valid 3.1.
- [ ] `cd backend && go test ./internal/httpapi/... && python3 -c "import yaml; yaml.safe_load(open('backend/internal/httpapi/openapi.yaml')); print('YAML_OK')"`.
- [ ] commit `docs: spec + OpenAPI for admin settings + recompute`.

---

## Task 10: Verification + DoD

- [ ] `cd backend && go vet ./... && go test ./...` green.
- [ ] `cd frontend && pnpm tsc --noEmit && pnpm vitest run && pnpm build` green.
- [ ] `make migrate-up`; `settings` exists + seeded.
- [ ] Live smoke (admin cookie / browser): `GET /api/admin/settings` shows 3 seeded values; `PUT` a bad cron → 400, a valid `bonus_lock_at` in the past → `GET /api/bonus` shows `locked:true` (live); corrupt a prediction's `points` in the DB then `POST /api/admin/recompute` → it's restored, summary returned; confirm a `prize_paid` past `weekly_results` row is unchanged after recompute; `/admin/*` → 403 for a non-admin.
- [ ] run `sayscore-verifier`.

---

## Self-review notes

- **Spec coverage:** migration+queries (T1), validators (T2), Service (T3), store (T4), recompute job (T5), handlers + live lock (T6), routes/wiring (T7), frontend (T8), docs (T9), DoD (T10). All M8b spec sections mapped.
- **Recompute invariant** is enforced structurally: `RecomputeStore` exposes only `ListFinalMatches`/`ListPredictionsForMatch`/`SetPredictionScore` (+ the bonus setter) — there is no method to write match results or `weekly_results`, so the job *cannot* touch them; a test asserts the summary + that those fakes saw zero writes.
- **Live bonus lock:** `Deps.BonusLockAt` is replaced by `Deps.Settings`; the ~8 bonus handler tests move to a fake `SettingsProvider` returning a fixed time (T6).
- **Precedence:** env defaults seed missing keys on boot (T7 `EnsureSeeded`); DB is runtime truth (Service `Get`/`All`).
- **400 vs 500 hygiene:** the settings PUT validates keys/values for 400 and reserves 500 for store failures (T6 refinement).
- **No placeholders beyond generated-sqlc-name adaptation** (T1→T4) and confirming the cron parser matches the scheduler's (T2).
