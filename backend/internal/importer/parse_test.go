package importer

import (
	"strings"
	"testing"
	"time"
)

func TestParseKickoffUTC(t *testing.T) {
	cases := map[string]string{
		"2026-06-11 15:00:00-06": "2026-06-11T21:00:00Z",
		"2026-06-24 15:00:00-07": "2026-06-24T22:00:00Z",
		"2026-07-04 13:00:00-05": "2026-07-04T18:00:00Z",
		"2026-07-19 15:00:00-04": "2026-07-19T19:00:00Z",
	}
	for in, want := range cases {
		got, err := parseKickoffUTC(in)
		if err != nil {
			t.Fatalf("parseKickoffUTC(%q) err = %v", in, err)
		}
		if got.Format(time.RFC3339) != want {
			t.Errorf("parseKickoffUTC(%q) = %s, want %s", in, got.Format(time.RFC3339), want)
		}
		if got.Location() != time.UTC {
			t.Errorf("parseKickoffUTC(%q) not in UTC", in)
		}
	}
	if _, err := parseKickoffUTC("not-a-time"); err == nil {
		t.Error("expected error for bad timestamp")
	}
}

func TestStageFromID(t *testing.T) {
	if stageFromID(1) != StageGroup {
		t.Errorf("stage 1 should be group")
	}
	for _, id := range []int64{2, 3, 4, 5, 6, 7} {
		if stageFromID(id) != StageKnockout {
			t.Errorf("stage %d should be knockout", id)
		}
	}
}

func TestParseBool(t *testing.T) {
	for _, s := range []string{"True", "true", "TRUE", "1"} {
		if !parseBool(s) {
			t.Errorf("parseBool(%q) = false, want true", s)
		}
	}
	for _, s := range []string{"False", "false", "0", ""} {
		if parseBool(s) {
			t.Errorf("parseBool(%q) = true, want false", s)
		}
	}
}

func TestParseTeams(t *testing.T) {
	csv := "id,team_name,fifa_code,group_letter,is_placeholder\n" +
		"1,Mexico,MEX,A,False\n" +
		"47,Playoff Winner,TBD,,True\n"
	teams, err := parseTeams(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("parseTeams err = %v", err)
	}
	if len(teams) != 2 {
		t.Fatalf("got %d teams, want 2", len(teams))
	}
	if teams[0].SourceID != 1 || teams[0].Name != "Mexico" || teams[0].FifaCode != "MEX" || teams[0].GroupLetter != "A" || teams[0].IsPlaceholder {
		t.Errorf("team0 = %+v", teams[0])
	}
	if !teams[1].IsPlaceholder {
		t.Errorf("team1 should be placeholder: %+v", teams[1])
	}
}

func TestParseVenues(t *testing.T) {
	csv := "id,city_name,country,venue_name,region_cluster,airport_code\n" +
		"15,Mexico City,Mexico,Estadio Azteca,Central,MEX\n"
	vs, err := parseVenues(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("parseVenues err = %v", err)
	}
	if len(vs) != 1 || vs[0].SourceID != 15 || vs[0].VenueName != "Estadio Azteca" || vs[0].CityName != "Mexico City" {
		t.Errorf("venues = %+v", vs)
	}
}

func TestParseStages(t *testing.T) {
	csv := "id,stage_name,stage_order\n1,Group Stage,1\n3,Round of 16,3\n"
	st, err := parseStages(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("parseStages err = %v", err)
	}
	if st[1] != "Group Stage" || st[3] != "Round of 16" {
		t.Errorf("stages map = %+v", st)
	}
}

func TestParsePlayers(t *testing.T) {
	t.Run("valid rows", func(t *testing.T) {
		input := "source_id,team_fifa_code,name,position\n" +
			"1001,MEX,Guillermo Ochoa,Goalkeeper\n" +
			"2001,RSA,Ronwen Williams,\n"
		players, err := parsePlayers(strings.NewReader(input))
		if err != nil {
			t.Fatalf("parsePlayers err = %v", err)
		}
		if len(players) != 2 {
			t.Fatalf("got %d players, want 2", len(players))
		}
		if players[0].SourceID != 1001 || players[0].TeamFifaCode != "MEX" || players[0].Name != "Guillermo Ochoa" || players[0].Position != "Goalkeeper" {
			t.Errorf("player[0] = %+v", players[0])
		}
		if players[1].SourceID != 2001 || players[1].TeamFifaCode != "RSA" || players[1].Name != "Ronwen Williams" || players[1].Position != "" {
			t.Errorf("player[1] = %+v", players[1])
		}
	})

	t.Run("header only yields empty slice", func(t *testing.T) {
		players, err := parsePlayers(strings.NewReader("source_id,team_fifa_code,name,position\n"))
		if err != nil {
			t.Fatalf("err = %v", err)
		}
		if len(players) != 0 {
			t.Errorf("want empty, got %d", len(players))
		}
	})

	t.Run("short row returns error", func(t *testing.T) {
		input := "source_id,team_fifa_code,name,position\n1001,MEX,Ochoa\n" // only 3 fields
		_, err := parsePlayers(strings.NewReader(input))
		if err == nil {
			t.Error("expected error for short row, got nil")
		}
	})
}

func TestParseMatchesHandlesPlaceholdersAndGroup(t *testing.T) {
	stages := map[int64]string{1: "Group Stage", 3: "Round of 16"}
	csv := "id,match_number,home_team_id,away_team_id,city_id,stage_id,kickoff_at,match_label\n" +
		"1,1,1,2,15,1,2026-06-11 15:00:00-06,Group A\n" +
		"89,89,,,4,3,2026-07-04 13:00:00-05,W73 vs W75\n"
	ms, err := parseMatches(strings.NewReader(csv), stages)
	if err != nil {
		t.Fatalf("parseMatches err = %v", err)
	}
	if len(ms) != 2 {
		t.Fatalf("got %d matches, want 2", len(ms))
	}
	g := ms[0]
	if g.HomeTeamID == nil || *g.HomeTeamID != 1 || g.AwayTeamID == nil || *g.AwayTeamID != 2 {
		t.Errorf("group match teams = %+v", g)
	}
	if g.VenueID == nil || *g.VenueID != 15 || g.Stage != StageGroup || g.Round != "Group Stage" || g.GroupLetter != "A" {
		t.Errorf("group match fields = %+v", g)
	}
	if g.KickoffUTC.Format(time.RFC3339) != "2026-06-11T21:00:00Z" {
		t.Errorf("group kickoff = %s", g.KickoffUTC.Format(time.RFC3339))
	}
	k := ms[1]
	if k.HomeTeamID != nil || k.AwayTeamID != nil {
		t.Errorf("placeholder teams should be nil: %+v", k)
	}
	if k.Stage != StageKnockout || k.GroupLetter != "" || k.MatchLabel != "W73 vs W75" || k.Round != "Round of 16" {
		t.Errorf("knockout fields = %+v", k)
	}
}
