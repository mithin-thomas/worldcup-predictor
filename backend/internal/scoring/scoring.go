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

// Compute computes points + penalty bonus for one prediction against one result
// per spec §5. Pure and idempotent: identical inputs always yield identical
// output (absolute points, never a delta).
func Compute(p Prediction, r Result) Score {
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
