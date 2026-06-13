package sportsapi

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// raw API-Football JSON shapes (only the fields we use).
type teamsEnvelope struct {
	Response []struct {
		Team struct {
			ID   int64  `json:"id"`
			Name string `json:"name"`
			Code string `json:"code"`
			Logo string `json:"logo"`
		} `json:"team"`
	} `json:"response"`
}

type fixturesEnvelope struct {
	Response []struct {
		Fixture struct {
			ID     int64  `json:"id"`
			Date   string `json:"date"`
			Status struct {
				Short string `json:"short"`
			} `json:"status"`
		} `json:"fixture"`
		League struct {
			Round string `json:"round"`
		} `json:"league"`
		Teams struct {
			Home struct {
				ID int64 `json:"id"`
			} `json:"home"`
			Away struct {
				ID int64 `json:"id"`
			} `json:"away"`
		} `json:"teams"`
		Goals struct {
			Home *int32 `json:"home"`
			Away *int32 `json:"away"`
		} `json:"goals"`
	} `json:"response"`
}

func parseTeams(b []byte) ([]Team, error) {
	var env teamsEnvelope
	if err := json.Unmarshal(b, &env); err != nil {
		return nil, fmt.Errorf("sportsapi: decode teams: %w", err)
	}
	out := make([]Team, 0, len(env.Response))
	for _, r := range env.Response {
		out = append(out, Team{
			APITeamID: r.Team.ID, Name: r.Team.Name, Code: r.Team.Code, LogoURL: r.Team.Logo,
		})
	}
	return out, nil
}

func parseFixtures(b []byte) ([]Fixture, error) {
	var env fixturesEnvelope
	if err := json.Unmarshal(b, &env); err != nil {
		return nil, fmt.Errorf("sportsapi: decode fixtures: %w", err)
	}
	out := make([]Fixture, 0, len(env.Response))
	for _, r := range env.Response {
		ts, err := time.Parse(time.RFC3339, r.Fixture.Date)
		if err != nil {
			return nil, fmt.Errorf("sportsapi: fixture %d bad date %q: %w", r.Fixture.ID, r.Fixture.Date, err)
		}
		out = append(out, Fixture{
			APIFixtureID:  r.Fixture.ID,
			Stage:         mapStage(r.League.Round),
			Round:         r.League.Round,
			HomeAPITeamID: r.Teams.Home.ID,
			AwayAPITeamID: r.Teams.Away.ID,
			KickoffUTC:    ts.UTC(),
			Status:        mapStatus(r.Fixture.Status.Short),
			HomeScore:     r.Goals.Home,
			AwayScore:     r.Goals.Away,
		})
	}
	return out, nil
}

func mapStatus(short string) Status {
	switch short {
	case "1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT":
		return StatusLive
	case "FT", "AET", "PEN":
		return StatusFinal
	default: // NS, TBD, PST, CANC, etc. — treat as not-yet-final/scheduled
		return StatusScheduled
	}
}

func mapStage(round string) Stage {
	if strings.Contains(strings.ToLower(round), "group") {
		return StageGroup
	}
	return StageKnockout
}
