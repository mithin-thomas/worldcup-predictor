// Package importer parses the committed World Cup CSV dataset and seeds it into
// the store. Parsing is pure (no DB, no clock); the Importer does the I/O.
package importer

import "time"

type VenueRow struct {
	SourceID                                          int64
	CityName, Country, VenueName, RegionCluster, Code string // Code = airport_code
}

type TeamRow struct {
	SourceID      int64
	Name          string
	FifaCode      string
	GroupLetter   string
	IsPlaceholder bool
}

type Stage string

const (
	StageGroup    Stage = "group"
	StageKnockout Stage = "knockout"
)

type MatchRow struct {
	SourceID    int64
	MatchNumber int
	HomeTeamID  *int64 // nil for knockout placeholders
	AwayTeamID  *int64
	VenueID     *int64
	StageID     int64
	Stage       Stage
	Round       string // resolved from stages by the parser
	GroupLetter string // letter for group matches, else ""
	MatchLabel  string
	KickoffUTC  time.Time
}

type PlayerRow struct {
	SourceID     int64
	TeamFifaCode string
	Name         string
	Position     string
}
