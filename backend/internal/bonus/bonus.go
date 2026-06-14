// Package bonus implements SayScore's pure tournament-bonus rules (spec §3.4):
// the seven award categories, their points, whether each refers to a team or a
// player, and the idempotent score of one pick against one outcome. No I/O.
package bonus

// Category is one of the seven bonus award categories.
type Category string

const (
	Winner      Category = "winner"
	RunnerUp    Category = "runner_up"
	GoldenBall  Category = "golden_ball"
	GoldenBoot  Category = "golden_boot"
	GoldenGlove Category = "golden_glove"
	YoungPlayer Category = "young_player"
	FairPlay    Category = "fair_play"
)

// Categories is the canonical ordered list (display + iteration order).
var Categories = []Category{Winner, RunnerUp, GoldenBall, GoldenBoot, GoldenGlove, YoungPlayer, FairPlay}

// RefType distinguishes whether a category's ref_id resolves to a team or a player.
type RefType string

const (
	RefTeam   RefType = "team"
	RefPlayer RefType = "player"
)

var meta = map[Category]struct {
	points  int
	refType RefType
}{
	Winner:      {30, RefTeam},
	RunnerUp:    {20, RefTeam},
	GoldenBall:  {10, RefPlayer},
	GoldenBoot:  {10, RefPlayer},
	GoldenGlove: {10, RefPlayer},
	YoungPlayer: {10, RefPlayer},
	FairPlay:    {10, RefTeam},
}

// Valid reports whether c is a recognised bonus category.
func Valid(c Category) bool { _, ok := meta[c]; return ok }

// Points returns the number of bonus points for a correct pick in category c.
func Points(c Category) int { return meta[c].points }

// RefTypeOf returns whether c's ref_id resolves to a team or a player.
func RefTypeOf(c Category) RefType { return meta[c].refType }

// Score is the points a pick earns: the category's points when an outcome exists
// and the pick's ref matches it, else 0. Idempotent (pure function of inputs).
func Score(c Category, pickRef int64, resultRef *int64) int {
	if resultRef == nil || pickRef != *resultRef {
		return 0
	}
	return Points(c)
}
