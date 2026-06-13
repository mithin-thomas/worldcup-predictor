# SayScore — Milestone 4 Design: Pure Scoring Engine

**Status:** approved 2026-06-14. Requirements remain locked in `docs/REQUIREMENTS.md` (§3.3 scoring
rules, §5 scoring-engine spec + pseudocode, §5.1 tie-break). This document records the M4 design; it
does not re-derive the rules.

## Goal

A pure, I/O-free Go package `internal/scoring/` that, given a prediction and an actual match result,
computes the match points (5 / 3 / 0) and the +1 knockout penalty bonus exactly as §5 specifies. It is
the highest-value test surface in the project — exhaustively table-tested.

## Scope

In scope:

- The `internal/scoring/` package: input/output value types and a single `Score` function.
- Exhaustive table-driven unit tests covering every scoring branch and the penalty-bonus matrix.

Explicitly out of scope (other milestones):

- **Result ingestion** — fetching results from a free results API, the daily cron, marking matches
  FINAL: **Milestone 5**. The engine is source-agnostic; it never fetches anything.
- **Persistence** — writing `predictions.points` / `predictions.penalty_bonus`, the recompute
  transaction, `weekly_results`: **Milestone 5**.
- **§5.1 final-standings tie-break cascade** — it operates on aggregated standings (counts of 5s, 3s,
  bonus hits), not per-match scoring: **Milestone 6**. The per-prediction points this engine produces
  are what M6 later counts.

M4 ships a standalone, fully-tested library with **no callers yet**. That is intentional: scoring is a
horizontal layer the spec deliberately isolates (§8/§9 "pure scoring engine, zero I/O") so it can be
proven correct in isolation before M5 wires it to real data.

## Package shape

`backend/internal/scoring/scoring.go` — imports nothing (not even `internal/store`):

```go
package scoring

// Prediction is a user's predicted scoreline plus an optional knockout
// shootout-winner pick. PenaltyWinner is nil when the user made no pick.
type Prediction struct {
	Home, Away    int
	PenaltyWinner *int64
}

// Result is the actual outcome the engine scores against. Final and Knockout
// are semantic booleans (the caller derives them from the persistence enums),
// so the engine never hardcodes status/stage string values. Home/Away are the
// full-time / extra-time scoreline (a shootout does not change them).
type Result struct {
	Final           bool
	Knockout        bool
	Home, Away      int
	WentToPenalties bool
	PenaltyWinner   *int64
}

// Score is the engine's output, stored per prediction (points, penalty_bonus).
type Score struct {
	Points       int
	PenaltyBonus int
}

// Score computes points + penalty bonus for one prediction against one result.
// Pure and idempotent: same inputs always yield the same Score.
func Score(p Prediction, r Result) Score
```

Rationale for **semantic booleans** (`Final`, `Knockout`) over raw `"final"`/`"knockout"` strings:
the engine stays decoupled from the `store` package's enum vocabulary, keeping its dependency set
empty. The M5 caller computes `Final: m.Status == store.StatusFinal`,
`Knockout: m.Stage == store.StageKnockout`.

## Algorithm (verbatim from §5)

```
Score(p, r):
  if !r.Final:                       return {0, 0}

  if p.Home == r.Home && p.Away == r.Away:        points = 5   // exact
  else if sign(p.Home-p.Away) == sign(r.Home-r.Away): points = 3   // correct result (incl. draw==draw)
  else:                                            points = 0

  bonus = 0
  if r.Knockout && r.WentToPenalties
     && p.Home == p.Away                   // user predicted a draw
     && points > 0                          // the prediction earned score points
     && p.PenaltyWinner != nil && r.PenaltyWinner != nil
     && *p.PenaltyWinner == *r.PenaltyWinner:
       bonus = 1

  return {points, bonus}

sign(n): 1 if n>0, -1 if n<0, 0 if n==0   // 0 represents a draw
```

Notes:
- A predicted draw matching an actual draw with the *same* score is exact (5); with a *different*
  score it is correct-result (3) via the `sign==sign` (both 0) path.
- The `points > 0` guard is belt-and-suspenders: a shootout implies the regulation/ET result was a
  draw, so a draw prediction already scores ≥3 — but the guard makes the bonus impossible on a
  0-point prediction even with inconsistent input data.
- Both penalty-winner values must be non-nil and equal; a nil pick (or nil actual winner) yields no
  bonus.

## Idempotency

`Score` is a pure function returning **absolute** points, not a delta, so calling it any number of
times with the same inputs returns the same `Score`. The "recompute, never increment" rule (§5) is
satisfied by construction; M5's persistence will `SET points = …` rather than `+=`. A test asserts
`Score(x) == Score(x)`.

## Tests — exhaustive table-driven `scoring_test.go`

The deliverable's value lives here. Cases:

- **Not final:** `Final=false` with an otherwise-perfect prediction → `{0,0}`.
- **Exact (5):** home win, away win, scoreless draw, scoring draw, high scores — each predicted ==
  actual.
- **Correct result (3):** right winner wrong score (home and away); predicted draw vs a
  different-scored actual draw.
- **Wrong (0):** predicted home win → actual away win; predicted draw → actual decisive; predicted
  decisive → actual draw.
- **sign edges:** 0-0 vs 0-0 → 5; 1-1 vs 2-2 → 3; 1-1 vs 1-0 → 0.
- **Penalty-bonus matrix** (all on a knockout that went to penalties unless noted):
  - predicted draw + earned points + correct winner pick → bonus 1 (verify on both an exact 5 draw
    and a correct-result 3 draw).
  - wrong winner pick → 0.
  - nil winner pick → 0.
  - nil actual winner → 0.
  - not knockout (group) → 0.
  - knockout but `WentToPenalties=false` → 0.
  - non-draw prediction (`Home != Away`) → 0 (user didn't predict a draw).
  - `points==0` guard: inconsistent input (non-draw actual + `WentToPenalties=true` + draw
    prediction that scores 0) → 0.
- **Idempotency:** `Score` invoked twice with identical inputs is equal.

## Definition of Done

- `go test ./internal/scoring/ -count=1` passes with the full table above.
- The package imports nothing beyond the standard library (verified — ideally zero imports).
- An architecture review confirms zero I/O and no dependency on `store`/handlers.
- No other code in the repo changes (M4 adds only the package + its test).
