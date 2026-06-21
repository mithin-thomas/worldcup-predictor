package store

import (
	"testing"
	"time"
)

func i64(v int64) *int64 { return &v }

func TestCelebrationFor(t *testing.T) {
	codes := map[string]bool{"BRA": true}
	kt := time.Date(2026, 6, 19, 18, 0, 0, 0, time.UTC)

	cases := []struct {
		name string
		m    finalMatch
		want *Celebration
	}{
		{"brazil home win", finalMatch{MatchID: 1, HomeID: 9, HomeCode: "BRA", HomeScore: 3, AwayID: 5, AwayCode: "JOR", AwayScore: 1, KickoffUTC: kt},
			&Celebration{MatchID: 1, TeamCode: "BRA", TeamScore: 3, OpponentCode: "JOR", OpponentScore: 1, KickoffUTC: kt}},
		{"brazil away win", finalMatch{MatchID: 2, HomeID: 5, HomeCode: "JOR", HomeScore: 0, AwayID: 9, AwayCode: "BRA", AwayScore: 2, KickoffUTC: kt},
			&Celebration{MatchID: 2, TeamCode: "BRA", TeamScore: 2, OpponentCode: "JOR", OpponentScore: 0, KickoffUTC: kt}},
		{"brazil shootout win on a draw", finalMatch{MatchID: 3, HomeID: 9, HomeCode: "BRA", HomeScore: 1, AwayID: 5, AwayCode: "JOR", AwayScore: 1, PenaltyWinner: i64(9), KickoffUTC: kt},
			&Celebration{MatchID: 3, TeamCode: "BRA", TeamScore: 1, OpponentCode: "JOR", OpponentScore: 1, KickoffUTC: kt}},
		{"brazil loses", finalMatch{MatchID: 4, HomeID: 9, HomeCode: "BRA", HomeScore: 0, AwayID: 5, AwayCode: "JOR", AwayScore: 1, KickoffUTC: kt}, nil},
		{"brazil draw no shootout", finalMatch{MatchID: 5, HomeID: 9, HomeCode: "BRA", HomeScore: 1, AwayID: 5, AwayCode: "JOR", AwayScore: 1, KickoffUTC: kt}, nil},
		{"brazil loses shootout", finalMatch{MatchID: 6, HomeID: 9, HomeCode: "BRA", HomeScore: 1, AwayID: 5, AwayCode: "JOR", AwayScore: 1, PenaltyWinner: i64(5), KickoffUTC: kt}, nil},
		{"non-brazil win", finalMatch{MatchID: 7, HomeID: 5, HomeCode: "JOR", HomeScore: 2, AwayID: 6, AwayCode: "ESP", AwayScore: 1, KickoffUTC: kt}, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := celebrationFor(c.m, codes)
			if c.want == nil {
				if ok {
					t.Fatalf("expected no celebration, got %+v", got)
				}
				return
			}
			if !ok {
				t.Fatalf("expected a celebration, got none")
			}
			if got != *c.want {
				t.Fatalf("got %+v, want %+v", got, *c.want)
			}
		})
	}
}
