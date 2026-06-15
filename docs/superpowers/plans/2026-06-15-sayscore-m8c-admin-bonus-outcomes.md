# Admin bonus-outcomes screen (M8c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A polished admin screen to enter the 7 tournament-award outcomes, with saving auto-scoring bonus points immediately. Completes Milestone 8.

**Architecture:** Reuse-everything. A new `GET /api/admin/bonus/results` builds the 7-category view from `store.ListBonusResults` + `bonus.Categories/Points/RefTypeOf` + the existing `Players.TeamNameByID/PlayerNameByID` label resolvers. The existing `PUT /api/admin/bonus/results` gains auto-scoring by calling `JobRunner.RunBonusScore` after the upsert. A 4th Admin tab (Bonus) reuses the M7 team/player pickers. No migration, no new store query, no new scoring endpoint.

**Tech Stack:** Go 1.26 · chi/v5 · React 18 + TS + Vite · TanStack Query · Vitest.

**Branch:** `feat/m8c-admin-bonus-outcomes` (already created off `main`).

**Spec:** `docs/superpowers/specs/2026-06-15-sayscore-m8c-admin-bonus-outcomes-design.md`.

**Conventions:** handlers reuse `writeJSON`/`writeError`, generic 500 + `slog`; admin routes `RequireAdmin`, all environments; Conventional Commits per task; `gofmt -w` + `go vet`; `pnpm build` runs `tsc -b` (strict — cast mocked TanStack hooks `as unknown as` in tests).

---

## File structure

- `backend/internal/httpapi/admin_bonus_handler.go` — add `GetBonusResults`; auto-score in `PutBonusResults` (modify).
- `backend/internal/httpapi/admin_bonus_handler_test.go` — new test file for both (create) — or extend `bonus_handler_test.go` where `TestPutBonusResults_*` live (the executor picks; keep fakes shared).
- `backend/internal/httpapi/router.go` — register `GET /api/admin/bonus/results` (modify).
- `frontend/src/lib/admin.ts` — `useBonusResults` + `useSaveBonusResults` hooks (modify).
- `frontend/src/routes/Admin.tsx` (+ test) — Bonus tab (modify).
- `frontend/src/styles/tokens.css` — `.admin-bonus*` (modify).
- `docs/REQUIREMENTS.md` + `backend/internal/httpapi/openapi.yaml` (modify).

---

## Task 1: GET /api/admin/bonus/results (TDD)

**Files:** Modify `backend/internal/httpapi/admin_bonus_handler.go`; tests in `admin_bonus_handler_test.go` (new) or `bonus_handler_test.go`.

The handler reuses `d.Bonus.ListBonusResults` (→ `[]store.BonusResult{Category,RefID}`), `bonus.Categories/Points/RefTypeOf`, and `d.Players.TeamNameByID`/`PlayerNameByID`. The existing test fakes (`fakeBonusStore` has `ListBonusResults`; `fakePlayerStore` has `teamNames`/`playerNames` maps) already support this.

- [ ] **Step 1: failing tests**

```go
func TestGetBonusResults_AllSevenInOrderWithLabels(t *testing.T) {
	bs := &fakeBonusStore{}
	bs.results = []store.BonusResult{
		{Category: "winner", RefID: 9},
		{Category: "golden_ball", RefID: 42},
	}
	ps := &fakePlayerStore{
		teamNames:   map[int64]string{9: "Brazil"},
		playerNames: map[int64]string{42: "Messi"},
	}
	d := &Deps{Bonus: bs, Players: ps}
	req := ctxUser(httptest.NewRequest(http.MethodGet, "/api/admin/bonus/results", nil), 1)
	rec := httptest.NewRecorder()
	d.GetBonusResults(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want 200", rec.Code)
	}
	var got struct {
		Results []struct {
			Category string `json:"category"`
			Points   int    `json:"points"`
			RefType  string `json:"ref_type"`
			RefID    int64  `json:"ref_id"`
			Label    string `json:"label"`
			Set      bool   `json:"set"`
		} `json:"results"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&got)
	if len(got.Results) != 7 {
		t.Fatalf("results=%d want 7", len(got.Results))
	}
	if got.Results[0].Category != "winner" || got.Results[0].Points != 30 || got.Results[0].Label != "Brazil" || !got.Results[0].Set {
		t.Errorf("winner row wrong: %+v", got.Results[0])
	}
	// find golden_ball → player label
	var gb bool
	for _, r := range got.Results {
		if r.Category == "golden_ball" {
			gb = true
			if r.RefType != "player" || r.Label != "Messi" || r.Points != 10 || !r.Set {
				t.Errorf("golden_ball row wrong: %+v", r)
			}
		}
		if r.Category == "runner_up" && (r.Set || r.RefID != 0 || r.Label != "") {
			t.Errorf("unset runner_up should be set:false ref:0 label:\"\"; got %+v", r)
		}
	}
	if !gb {
		t.Error("golden_ball missing")
	}
}
```

Add `results []store.BonusResult` to `fakeBonusStore` and have its `ListBonusResults` return it (check current — it returns nil; wire the field).

- [ ] **Step 2: run RED** → `GetBonusResults` undefined.

- [ ] **Step 3: implement** (append to `admin_bonus_handler.go`):

```go
type bonusResultDTO struct {
	Category string `json:"category"`
	Points   int    `json:"points"`
	RefType  string `json:"ref_type"`
	RefID    int64  `json:"ref_id"`
	Label    string `json:"label"`
	Set      bool   `json:"set"`
}

// GetBonusResults returns all 7 award categories (canonical order) with their
// current stored outcome + resolved team/player label. Admin-only.
func (d *Deps) GetBonusResults(w http.ResponseWriter, r *http.Request) {
	stored, err := d.Bonus.ListBonusResults(r.Context())
	if err != nil {
		slog.Error("admin list bonus results", "err", err)
		writeError(w, http.StatusInternalServerError, "could not load outcomes")
		return
	}
	byCat := make(map[string]int64, len(stored))
	for _, s := range stored {
		byCat[s.Category] = s.RefID
	}
	out := make([]bonusResultDTO, 0, len(bonus.Categories))
	for _, c := range bonus.Categories {
		row := bonusResultDTO{
			Category: string(c), Points: bonus.Points(c), RefType: string(bonus.RefTypeOf(c)),
		}
		if refID, ok := byCat[string(c)]; ok {
			row.RefID = refID
			row.Set = true
			row.Label = d.resolveRefLabel(r, c, refID)
		}
		out = append(out, row)
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": out})
}

// resolveRefLabel returns the team/player name for a ref (empty on a stale ref).
func (d *Deps) resolveRefLabel(r *http.Request, c bonus.Category, refID int64) string {
	var name string
	var err error
	if bonus.RefTypeOf(c) == bonus.RefTeam {
		name, err = d.Players.TeamNameByID(r.Context(), refID)
	} else {
		name, err = d.Players.PlayerNameByID(r.Context(), refID)
	}
	if err != nil {
		slog.Error("admin bonus result label", "category", c, "ref_id", refID, "err", err)
		return ""
	}
	return name
}
```

- [ ] **Step 4: run GREEN.**

- [ ] **Step 5: commit** `feat(api): GET /api/admin/bonus/results — 7 categories with resolved labels`.

---

## Task 2: Auto-score on PUT (TDD)

**Files:** Modify `admin_bonus_handler.go` (`PutBonusResults`); tests.

`Deps.JobRunner` (interface with `RunBonusScore(ctx)(any,error)`) is wired in all environments. The handler calls it after the upsert.

- [ ] **Step 1: failing tests**

```go
func TestPutBonusResults_AutoScores(t *testing.T) {
	bs := &fakeBonusStore{teamOK: true, playerOK: true}
	jr := &fakeJobRunner{} // from admin_jobs_test.go; records calls, RunBonusScore returns {"scored":3} or similar
	d := &Deps{Bonus: bs, Players: &fakePlayerStore{}, JobRunner: jr}
	body := `{"results":[{"category":"winner","ref_id":9}]}`
	req := ctxUser(httptest.NewRequest(http.MethodPut, "/api/admin/bonus/results", strings.NewReader(body)), 1)
	rec := httptest.NewRecorder()
	d.PutBonusResults(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want 200", rec.Code)
	}
	if bs.resultsSaved != 1 {
		t.Errorf("resultsSaved=%d want 1", bs.resultsSaved)
	}
	if jr.called == 0 {
		t.Error("auto-score must call RunBonusScore")
	}
}

func TestPutBonusResults_ScorerErrorStillSavedReturns500(t *testing.T) {
	bs := &fakeBonusStore{teamOK: true, playerOK: true}
	jr := &fakeJobRunner{bonusErr: errors.New("score boom")} // add a bonusErr field to the fake
	d := &Deps{Bonus: bs, Players: &fakePlayerStore{}, JobRunner: jr}
	req := ctxUser(httptest.NewRequest(http.MethodPut, "/api/admin/bonus/results", strings.NewReader(`{"results":[{"category":"winner","ref_id":9}]}`)), 1)
	rec := httptest.NewRecorder()
	d.PutBonusResults(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d want 500", rec.Code)
	}
	if bs.resultsSaved != 1 {
		t.Errorf("outcomes must be persisted even when scoring fails; resultsSaved=%d", bs.resultsSaved)
	}
}
```

Extend the shared `fakeJobRunner` (admin_jobs_test.go) with a `bonusErr error` field returned by `RunBonusScore` (and a `scored` summary). If `fakeJobRunner` is per-file, add a minimal one here.

- [ ] **Step 2: run RED.**

- [ ] **Step 3: implement** — change the tail of `PutBonusResults` (after the upsert loop):

```go
	scored := 0
	if d.JobRunner != nil {
		summary, err := d.JobRunner.RunBonusScore(r.Context())
		if err != nil {
			slog.Error("auto-score bonus after outcomes save", "err", err)
			writeError(w, http.StatusInternalServerError, "outcomes saved, but scoring failed — run recompute")
			return
		}
		if m, ok := summary.(map[string]int); ok { // jobs.BonusSummary is returned as `any`; adapt to its real shape
			scored = m["scored"]
		}
	}
	writeJSON(w, http.StatusOK, map[string]int{"saved": len(req.Results), "scored": scored})
```

Note: `RunBonusScore` returns `(any, error)` where the concrete is `jobs.BonusSummary{Scored int}`. Extract `scored` via a type assertion on the actual returned type (check `jobs.BonusScore.Run` → `BonusSummary`; the `serverJobs` adapter returns it as `any`). If extracting is awkward, just return `{"saved": N}` and drop `scored` — the spec allows either; the leaderboard is the real signal. Keep it simple if the type assertion is fragile.

- [ ] **Step 4: run GREEN.**

- [ ] **Step 5: commit** `feat(api): auto-score bonus on outcomes save (idempotent; outcomes persist on scorer error)`.

---

## Task 3: Route + authz

**Files:** Modify `router.go`; authz test.

- [ ] **Step 1:** register under the admin group (PUT already there):

```go
			priv.With(d.RequireAdmin).Get("/admin/bonus/results", d.GetBonusResults)
```

- [ ] **Step 2:** extend the admin authz table test (`admin_authz_test.go`) with `GET /api/admin/bonus/results` → 401 no-session / 403 non-admin.

- [ ] **Step 3:** `cd backend && go build ./... && go vet ./... && go test ./...` green.

- [ ] **Step 4:** commit `feat(api): register GET /admin/bonus/results + authz`.

---

## Task 4: Frontend — Admin Bonus tab (impeccable)

**Files:** Modify `frontend/src/lib/admin.ts`, `frontend/src/routes/Admin.tsx` (+ test), `frontend/src/styles/tokens.css`.

**Contract (impeccable / §7):** a 4th Admin tab "Bonus". Build with the `impeccable` skill, reusing the M8a/M8b `.admin*` patterns and the M7 `useTeams`/`usePlayerSearch` pickers (the searchable player combobox lives in `frontend/src/routes/Bonus.tsx` — extract it to a shared component, e.g. `frontend/src/components/PlayerCombobox.tsx`, and import it in both Bonus.tsx and Admin.tsx, OR replicate its minimal accessible form; prefer extraction to avoid divergence).

- [ ] **Step 1: hooks** in `admin.ts`:

```ts
export type BonusResultRow = { category: string; points: number; ref_type: "team" | "player"; ref_id: number; label: string; set: boolean };
export function useBonusResults() {
  return useQuery({ queryKey: ["admin", "bonus-results"], queryFn: () => apiFetch<{ results: BonusResultRow[] }>("/admin/bonus/results") });
}
export function useSaveBonusResults() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (results: { category: string; ref_id: number }[]) =>
      apiFetch("/admin/bonus/results", { method: "PUT", body: JSON.stringify({ results }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "bonus-results"] });
      qc.invalidateQueries({ queryKey: ["leaderboard"] });
      qc.invalidateQueries({ queryKey: ["bonus"] });
    },
  });
}
```

(Match the existing `apiFetch` signature in `admin.ts`.)

- [ ] **Step 2: failing component test** (`Admin.test.tsx`, mock `../lib/admin` + `../lib/auth` + `../lib/bonus`): the Bonus tab renders all 7 category rows; team-award rows show a team `<select>`, player-award rows show the player search input; a set category shows its label, an unset one shows "Not set"; clicking Save calls the save mutation with the chosen `{category, ref_id}` entries.

- [ ] **Step 3: implement** the Bonus section + add "Bonus" to the segmented control (Matches | Users | Settings | Bonus). Seed each row's selection from `useBonusResults` (team awards preselect the `<select>` to `ref_id`; player awards show the current `label` with the combobox to change it). A single **Save outcomes** button collects the chosen entries and calls `useSaveBonusResults`; on success show "Saved · N predictions scored" (from the response) and rely on the query invalidation. Set/unset rows visually distinct; skeleton/error/teaching-empty states. Build visuals with `impeccable`; add `.admin-bonus*` to tokens.css.

- [ ] **Step 4:** `cd frontend && pnpm tsc --noEmit && pnpm vitest run && pnpm build` green.

- [ ] **Step 5:** commit `feat(frontend): admin Bonus outcomes tab — team/player pickers, auto-scored save (impeccable)`.

---

## Task 5: Docs — REQUIREMENTS.md + OpenAPI

- [ ] §11: document `GET /api/admin/bonus/results` (7 categories + labels + set flag) and the auto-scoring `PUT` response (`{saved, scored}`); note saving materializes bonus points immediately (recompute remains the bulk path). Mark M8 complete.
- [ ] `openapi.yaml`: add the GET path + a `BonusResults` schema; update the PUT response; keep valid 3.1.
- [ ] `cd backend && go test ./internal/httpapi/... && python3 -c "import yaml; yaml.safe_load(open('backend/internal/httpapi/openapi.yaml')); print('YAML_OK')"`.
- [ ] commit `docs: spec + OpenAPI for admin bonus-outcomes read + auto-score`.

---

## Task 6: Verification + DoD

- [ ] `cd backend && go vet ./... && go test ./...` green.
- [ ] `cd frontend && pnpm tsc --noEmit && pnpm vitest run && pnpm build` green.
- [ ] Live smoke (admin cookie / browser): `GET /api/admin/bonus/results` → 7 rows; PUT a winner (team) + a golden_boot (player) → 200 `{saved,scored}`; `GET /api/leaderboard?period=overall` shows the bonus points applied immediately; re-saving is idempotent (same stored points); a non-admin → 403 on both.
- [ ] run `sayscore-verifier`.

---

## Self-review notes

- **Spec coverage:** GET read (T1), auto-score PUT (T2), route/authz (T3), frontend tab (T4), docs (T5), DoD (T6). All M8c spec sections mapped.
- **No new migration/store/scoring-endpoint** — confirmed; reuses `ListBonusResults`, `bonus.Categories/Points/RefTypeOf`, `Players.TeamNameByID/PlayerNameByID`, `JobRunner.RunBonusScore`.
- **Auto-score ordering:** outcomes upserted BEFORE scoring; a scorer error → 500 but outcomes persist (T2 asserts `resultsSaved==1` on the error path).
- **The `any`→summary extraction** in T2 is the only adapt-to-actual note (the `scored` count is cosmetic; dropping it is acceptable if the type assertion is fragile).
- **Combobox reuse:** prefer extracting the M7 `PlayerCombobox` to a shared component so Bonus.tsx + Admin.tsx don't diverge (T4).
