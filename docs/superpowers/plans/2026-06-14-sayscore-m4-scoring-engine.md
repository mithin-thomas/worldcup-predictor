# SayScore — Milestone 4: Pure Scoring Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure, I/O-free `internal/scoring/` package whose `Score(Prediction, Result) Score` function computes match points (5 exact / 3 correct-result / 0) plus the +1 knockout penalty bonus exactly as spec §5 defines, proven correct by exhaustive table-driven tests.

**Architecture:** One package, zero dependencies beyond the Go standard library (ideally zero imports). Engine-owned value types (`Prediction`, `Result` with semantic `Final`/`Knockout` booleans, `Score`) decouple the engine from the `store`/persistence layer. The function is pure and returns absolute points, so it is idempotent by construction. No callers yet — result ingestion + persistence are **M5**; the §5.1 tie-break is **M6**. Built TDD in two cycles: points logic first, then the penalty-bonus matrix.

**Tech Stack:** Go 1.26 standard library + `testing`. No new deps, no migrations, no sqlc, no frontend.

**Spec references:** design spec `docs/superpowers/specs/2026-06-14-sayscore-m4-scoring-engine-design.md`; REQUIREMENTS.md §3.3 (scoring rules), §5 (engine pseudocode + idempotency). §5.1 (tie-break) and result ingestion are explicitly **out of scope**.

---

## File Structure

**Create**
- `backend/internal/scoring/scoring.go` — the value types + `Score` + the `sign` helper. One responsibility: pure scoring. Zero imports.
- `backend/internal/scoring/scoring_test.go` — exhaustive table-driven tests (the deliverable's value).

**No other files change.** No `store`, handler, migration, sqlc, cron, or frontend changes.

---

## Conventions

Backend commands run from `backend/`. Lefthook hooks are active — Conventional Commits required; `gofmt` runs on commit, `go vet`/`go test` on push. TDD: write the failing test → confirm RED → minimal implementation → GREEN → commit, one bite-sized step at a time. The package must import nothing beyond the standard library (the tests need only `testing`). Don't stage `.claude/`, `node_modules/`, `dist/`, `.playwright-mcp/`.

---

### Task 1: Scoring package + points logic (5 / 3 / 0)

**Files:**
- Create: `backend/internal/scoring/scoring_test.go`
- Create: `backend/internal/scoring/scoring.go`

This task delivers the value types and the points computation (exact / correct-result / wrong / not-final) plus the `sign` helper and an idempotency check. The penalty bonus is added in Task 2; here `Score` always returns `PenaltyBonus: 0`.

- [ ] **Step 1: Write the failing test `backend/internal/scoring/scoring_test.go`**

```go
package scoring

import "testing"

func TestScorePoints(t *testing.T) {
	cases := []struct {
		name string
		p    Prediction
		r    Result
		want Score
	}{
		// Not final: never scores, even for a perfect-looking prediction.
		{"not final", Prediction{Home: 1, Away: 1}, Result{Final: false, Home: 1, Away: 1}, Score{}},

		// Exact (5).
		{"exact home win", Prediction{2, 1, nil}, Result{Final: true, Home: 2, Away: 1}, Score{Points: 5}},
		{"exact away win", Prediction{0, 3, nil}, Result{Final: true, Home: 0, Away: 3}, Score{Points: 5}},
		{"exact scoreless draw", Prediction{0, 0, nil}, Result{Final: true, Home: 0, Away: 0}, Score{Points: 5}},
		{"exact scoring draw", Prediction{2, 2, nil}, Result{Final: true, Home: 2, Away: 2}, Score{Points: 5}},
		{"exact high score", Prediction{4, 3, nil}, Result{Final: true, Home: 4, Away: 3}, Score{Points: 5}},

		// Correct result, wrong score (3).
		{"correct home win wrong score", Prediction{2, 1, nil}, Result{Final: true, Home: 3, Away: 1}, Score{Points: 3}},
		{"correct away win wrong score", Prediction{0, 1, nil}, Result{Final: true, Home: 1, Away: 3}, Score{Points: 3}},
		{"correct draw different score", Prediction{1, 1, nil}, Result{Final: true, Home: 2, Away: 2}, Score{Points: 3}},

		// Wrong (0).
		{"wrong home-win vs away-win", Prediction{2, 1, nil}, Result{Final: true, Home: 1, Away: 2}, Score{}},
		{"wrong draw vs decisive", Prediction{1, 1, nil}, Result{Final: true, Home: 2, Away: 1}, Score{}},
		{"wrong decisive vs draw", Prediction{2, 1, nil}, Result{Final: true, Home: 1, Away: 1}, Score{}},

		// sign() edges.
		{"sign 0-0 vs 0-0 exact", Prediction{0, 0, nil}, Result{Final: true, Home: 0, Away: 0}, Score{Points: 5}},
		{"sign 1-1 vs 2-2 correct", Prediction{1, 1, nil}, Result{Final: true, Home: 2, Away: 2}, Score{Points: 3}},
		{"sign 1-1 vs 1-0 wrong", Prediction{1, 1, nil}, Result{Final: true, Home: 1, Away: 0}, Score{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Score(tc.p, tc.r); got != tc.want {
				t.Errorf("Score(%+v, %+v) = %+v, want %+v", tc.p, tc.r, got, tc.want)
			}
		})
	}
}

func TestScoreIdempotent(t *testing.T) {
	p := Prediction{Home: 2, Away: 1}
	r := Result{Final: true, Home: 2, Away: 1}
	first := Score(p, r)
	second := Score(p, r)
	if first != second {
		t.Fatalf("Score not idempotent: %+v != %+v", first, second)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails (RED)**

Run: `cd backend && go test ./internal/scoring/`
Expected: FAIL — the package/types/`Score` don't exist yet (compile error: `undefined: Score`, `Prediction`, `Result`).

- [ ] **Step 3: Write `backend/internal/scoring/scoring.go` (points only, bonus stays 0)**

```go
// Package scoring implements SayScore's pure, idempotent match scoring (spec §5).
// It has no I/O and no dependencies beyond the standard library: given a
// prediction and an actual result it returns the points and knockout penalty
// bonus. Callers (Milestone 5) map persistence rows into these value types.
package scoring

// Prediction is a user's predicted scoreline plus an optional knockout
// shootout-winner pick. PenaltyWinner is nil when the user made no pick.
type Prediction struct {
	Home, Away    int
	PenaltyWinner *int64
}

// Result is the actual outcome to score against. Final and Knockout are
// semantic booleans the caller derives from the persistence enums, so the
// engine never hardcodes status/stage strings. Home/Away are the
// full-time / extra-time scoreline (a shootout does not change them).
type Result struct {
	Final           bool
	Knockout        bool
	Home, Away      int
	WentToPenalties bool
	PenaltyWinner   *int64
}

// Score is the engine output, stored per prediction (points, penalty_bonus).
type Score struct {
	Points       int
	PenaltyBonus int
}

// Score computes points + penalty bonus for one prediction against one result
// per spec §5. Pure and idempotent: identical inputs always yield identical
// output (absolute points, never a delta).
func Score(p Prediction, r Result) Score {
	if !r.Final {
		return Score{}
	}

	points := 0
	switch {
	case p.Home == r.Home && p.Away == r.Away:
		points = 5 // exact score
	case sign(p.Home-p.Away) == sign(r.Home-r.Away):
		points = 3 // correct result (incl. draw == draw)
	}

	return Score{Points: points}
}

// sign returns 1, -1, or 0; 0 represents a draw.
func sign(n int) int {
	switch {
	case n > 0:
		return 1
	case n < 0:
		return -1
	default:
		return 0
	}
}
```

- [ ] **Step 4: Run the test to verify it passes (GREEN)**

Run: `cd backend && go test ./internal/scoring/ -v`
Expected: PASS — `TestScorePoints` (all subtests) and `TestScoreIdempotent` green.

- [ ] **Step 5: Confirm zero non-stdlib imports + vet clean**

Run: `cd backend && go vet ./internal/scoring/ && grep -n "import" internal/scoring/scoring.go || echo "no imports (correct)"`
Expected: vet clean; `scoring.go` has **no import block** (prints "no imports (correct)").

- [ ] **Step 6: Commit**

```bash
git add backend/internal/scoring/scoring.go backend/internal/scoring/scoring_test.go
git commit -m "feat(scoring): pure points engine (exact/correct-result/wrong) + sign"
```

---

### Task 2: Knockout penalty bonus (+1) matrix

**Files:**
- Modify: `backend/internal/scoring/scoring_test.go` (add the bonus table)
- Modify: `backend/internal/scoring/scoring.go` (add the bonus block to `Score`)

Adds the §5 penalty bonus: +1 only when the match is a knockout that went to a shootout, the user predicted a draw, that prediction earned points, and the user's shootout-winner pick matches the actual winner.

- [ ] **Step 1: Write the failing bonus test (append to `scoring_test.go`)**

```go
// pw returns a pointer to a team id, for the penalty-winner fields.
func pw(id int64) *int64 { return &id }

func TestScorePenaltyBonus(t *testing.T) {
	// All cases are knockout matches that went to penalties unless the name says otherwise.
	cases := []struct {
		name string
		p    Prediction
		r    Result
		want Score
	}{
		// Bonus earned: predicted draw, earned points, correct shootout winner.
		{"exact draw + correct winner → +1",
			Prediction{1, 1, pw(7)},
			Result{Final: true, Knockout: true, Home: 1, Away: 1, WentToPenalties: true, PenaltyWinner: pw(7)},
			Score{Points: 5, PenaltyBonus: 1}},
		{"correct-result draw + correct winner → +1",
			Prediction{1, 1, pw(7)},
			Result{Final: true, Knockout: true, Home: 2, Away: 2, WentToPenalties: true, PenaltyWinner: pw(7)},
			Score{Points: 3, PenaltyBonus: 1}},

		// No bonus: every guard.
		{"wrong winner pick → no bonus",
			Prediction{1, 1, pw(7)},
			Result{Final: true, Knockout: true, Home: 1, Away: 1, WentToPenalties: true, PenaltyWinner: pw(8)},
			Score{Points: 5}},
		{"nil winner pick → no bonus",
			Prediction{1, 1, nil},
			Result{Final: true, Knockout: true, Home: 1, Away: 1, WentToPenalties: true, PenaltyWinner: pw(7)},
			Score{Points: 5}},
		{"nil actual winner → no bonus",
			Prediction{1, 1, pw(7)},
			Result{Final: true, Knockout: true, Home: 1, Away: 1, WentToPenalties: true, PenaltyWinner: nil},
			Score{Points: 5}},
		{"not knockout → no bonus",
			Prediction{1, 1, pw(7)},
			Result{Final: true, Knockout: false, Home: 1, Away: 1, WentToPenalties: true, PenaltyWinner: pw(7)},
			Score{Points: 5}},
		{"knockout but no shootout → no bonus",
			Prediction{1, 1, pw(7)},
			Result{Final: true, Knockout: true, Home: 1, Away: 1, WentToPenalties: false, PenaltyWinner: pw(7)},
			Score{Points: 5}},
		{"non-draw prediction → no bonus",
			Prediction{2, 1, pw(7)},
			Result{Final: true, Knockout: true, Home: 1, Away: 1, WentToPenalties: true, PenaltyWinner: pw(7)},
			Score{}}, // points 0 (2-1 vs 1-1 is wrong) and not a draw prediction
		{"points==0 guard (draw pred scores 0) → no bonus",
			Prediction{0, 0, pw(7)},
			Result{Final: true, Knockout: true, Home: 1, Away: 0, WentToPenalties: true, PenaltyWinner: pw(7)},
			Score{}}, // 0-0 vs 1-0 is wrong → points 0, so no bonus despite the draw prediction
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Score(tc.p, tc.r); got != tc.want {
				t.Errorf("Score(%+v, %+v) = %+v, want %+v", tc.p, tc.r, got, tc.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run the test to verify it fails (RED)**

Run: `cd backend && go test ./internal/scoring/ -run TestScorePenaltyBonus -v`
Expected: FAIL — the two "+1" cases get `PenaltyBonus: 0` (the bonus block isn't implemented yet). The no-bonus cases already pass.

- [ ] **Step 3: Add the bonus block to `Score` in `scoring.go`**

Replace the `return Score{Points: points}` line at the end of `Score` with:

```go
	bonus := 0
	if r.Knockout && r.WentToPenalties &&
		p.Home == p.Away && // user predicted a draw
		points > 0 && // the prediction earned score points
		p.PenaltyWinner != nil && r.PenaltyWinner != nil &&
		*p.PenaltyWinner == *r.PenaltyWinner {
		bonus = 1
	}

	return Score{Points: points, PenaltyBonus: bonus}
```

- [ ] **Step 4: Run the full package test (GREEN)**

Run: `cd backend && go test ./internal/scoring/ -v`
Expected: PASS — `TestScorePoints`, `TestScoreIdempotent`, and `TestScorePenaltyBonus` (all subtests) green.

- [ ] **Step 5: Confirm still zero non-stdlib imports + vet clean**

Run: `cd backend && go vet ./internal/scoring/ && grep -n "import" internal/scoring/scoring.go || echo "no imports (correct)"`
Expected: vet clean; `scoring.go` still has no import block.

- [ ] **Step 6: Run the whole backend suite (nothing else regressed)**

Run: `cd backend && go test ./... -count=1`
Expected: all packages green (the new `internal/scoring` package included; everything else unchanged).

- [ ] **Step 7: Commit**

```bash
git add backend/internal/scoring/scoring.go backend/internal/scoring/scoring_test.go
git commit -m "feat(scoring): knockout penalty bonus (+1) with full guard matrix"
```

---

## Self-Review

**Spec coverage:**
- §5 not-final guard → Task 1 (`not final` case + the `if !r.Final` return).
- §5 exact (5) → Task 1 (five exact cases).
- §5 correct-result via `sign` (3, incl. draw==draw) → Task 1 (correct cases + sign edges) + the `sign` helper.
- §5 wrong (0) → Task 1 (three wrong cases).
- §5 penalty bonus (+1) with all five conjuncts (knockout, went-to-penalties, predicted draw, points>0, winner match) → Task 2 (the "+1" cases + one no-bonus case per guard).
- §5 idempotency → Task 1 (`TestScoreIdempotent`) + pure absolute-value return.
- Engine-owned types, zero deps → both tasks (no imports; Step 5 verifies).
- Out of scope (ingestion M5, §5.1 M6) → no tasks, correctly absent.

**Placeholder scan:** none — every step has complete Go code and exact commands.

**Type consistency:** `Prediction{Home, Away int, PenaltyWinner *int64}`, `Result{Final, Knockout bool, Home, Away int, WentToPenalties bool, PenaltyWinner *int64}`, `Score{Points, PenaltyBonus int}`, `Score(Prediction, Result) Score`, and `sign(int) int` are used identically in Task 1 and Task 2. Test struct literals use positional fields for `Prediction` (3 fields: `{2, 1, nil}` / `{2, 1, pw(7)}`) and named fields for `Result` — consistent across both test tables. `pw` is defined once in Task 2.
