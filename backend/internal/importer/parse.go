package importer

import (
	"encoding/csv"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
)

const kickoffLayout = "2006-01-02 15:04:05-07"

// parseKickoffUTC parses a venue-local ISO 8601 timestamp with offset
// (e.g. "2026-06-11 15:00:00-06") and returns the equivalent UTC instant.
func parseKickoffUTC(s string) (time.Time, error) {
	t, err := time.Parse(kickoffLayout, strings.TrimSpace(s))
	if err != nil {
		return time.Time{}, fmt.Errorf("importer: bad kickoff %q: %w", s, err)
	}
	return t.UTC(), nil
}

func stageFromID(stageID int64) Stage {
	if stageID == 1 {
		return StageGroup
	}
	return StageKnockout
}

func parseBool(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "true", "1", "yes":
		return true
	default:
		return false
	}
}

// groupLetterFromLabel extracts "A" from "Group A"; "" for non-group labels.
func groupLetterFromLabel(label string, stage Stage) string {
	if stage != StageGroup {
		return ""
	}
	if f := strings.Fields(strings.TrimSpace(label)); len(f) == 2 && strings.EqualFold(f[0], "group") {
		return f[1]
	}
	return ""
}

// readCSV returns the data rows (header skipped) from r.
func readCSV(r io.Reader) ([][]string, error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1 // tolerate ragged rows (empty trailing fields)
	rows, err := cr.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("importer: read csv: %w", err)
	}
	if len(rows) <= 1 {
		return nil, nil
	}
	return rows[1:], nil
}

func atoi64(s string) int64 { n, _ := strconv.ParseInt(strings.TrimSpace(s), 10, 64); return n }
func atoi(s string) int     { n, _ := strconv.Atoi(strings.TrimSpace(s)); return n }

// optID returns nil for an empty cell, else &id.
func optID(s string) *int64 {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	v := atoi64(s)
	return &v
}

func parseVenues(r io.Reader) ([]VenueRow, error) {
	rows, err := readCSV(r)
	if err != nil {
		return nil, err
	}
	out := make([]VenueRow, 0, len(rows))
	for _, c := range rows { // id,city_name,country,venue_name,region_cluster,airport_code
		out = append(out, VenueRow{
			SourceID: atoi64(c[0]), CityName: c[1], Country: c[2],
			VenueName: c[3], RegionCluster: c[4], Code: c[5],
		})
	}
	return out, nil
}

func parseTeams(r io.Reader) ([]TeamRow, error) {
	rows, err := readCSV(r)
	if err != nil {
		return nil, err
	}
	out := make([]TeamRow, 0, len(rows))
	for _, c := range rows { // id,team_name,fifa_code,group_letter,is_placeholder
		out = append(out, TeamRow{
			SourceID: atoi64(c[0]), Name: c[1], FifaCode: c[2],
			GroupLetter: c[3], IsPlaceholder: parseBool(c[4]),
		})
	}
	return out, nil
}

func parseStages(r io.Reader) (map[int64]string, error) {
	rows, err := readCSV(r)
	if err != nil {
		return nil, err
	}
	out := make(map[int64]string, len(rows))
	for _, c := range rows { // id,stage_name,stage_order
		out[atoi64(c[0])] = c[1]
	}
	return out, nil
}

func parsePlayers(r io.Reader) ([]PlayerRow, error) {
	rows, err := readCSV(r)
	if err != nil {
		return nil, err
	}
	out := make([]PlayerRow, 0, len(rows))
	for i, c := range rows { // source_id,team_fifa_code,name,position
		if len(c) < 4 {
			return nil, fmt.Errorf("importer: players.csv row %d: got %d fields, want 4", i+2, len(c))
		}
		out = append(out, PlayerRow{
			SourceID:     atoi64(c[0]),
			TeamFifaCode: strings.TrimSpace(c[1]),
			Name:         strings.TrimSpace(c[2]),
			Position:     strings.TrimSpace(c[3]),
		})
	}
	return out, nil
}

func parseMatches(r io.Reader, stages map[int64]string) ([]MatchRow, error) {
	rows, err := readCSV(r)
	if err != nil {
		return nil, err
	}
	out := make([]MatchRow, 0, len(rows))
	for _, c := range rows { // id,match_number,home_team_id,away_team_id,city_id,stage_id,kickoff_at,match_label
		ko, err := parseKickoffUTC(c[6])
		if err != nil {
			return nil, err
		}
		stageID := atoi64(c[5])
		stage := stageFromID(stageID)
		out = append(out, MatchRow{
			SourceID:    atoi64(c[0]),
			MatchNumber: atoi(c[1]),
			HomeTeamID:  optID(c[2]),
			AwayTeamID:  optID(c[3]),
			VenueID:     optID(c[4]),
			StageID:     stageID,
			Stage:       stage,
			Round:       stages[stageID],
			GroupLetter: groupLetterFromLabel(c[7], stage),
			MatchLabel:  c[7],
			KickoffUTC:  ko,
		})
	}
	return out, nil
}
