package sportsapi

// Result is the source-agnostic outcome the ingest consumes. WinnerSide is the
// raw side (HOME_TEAM/AWAY_TEAM/DRAW); the job resolves it to a concrete team id
// only when WentToPenalties.
type Result struct {
	Final           bool
	Knockout        bool
	Home, Away      int
	WentToPenalties bool
	WinnerSide      string
}

// ToResult translates a football-data.org match to a Result. ok is false when the
// match is not FINISHED or has no full-time scoreline (not scoreable yet).
func ToResult(m Match) (Result, bool) {
	if m.Status != "FINISHED" || m.Score.FullTime.Home == nil || m.Score.FullTime.Away == nil {
		return Result{}, false
	}
	return Result{
		Final:           true,
		Knockout:        m.Stage != "GROUP_STAGE",
		Home:            *m.Score.FullTime.Home,
		Away:            *m.Score.FullTime.Away,
		WentToPenalties: m.Score.Duration == "PENALTY_SHOOTOUT",
		WinnerSide:      m.Score.Winner,
	}, true
}
