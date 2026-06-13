package sportsapi

import (
	"testing"
	"time"
)

func TestMapStatus(t *testing.T) {
	cases := map[string]Status{
		"NS": StatusScheduled, "TBD": StatusScheduled,
		"1H": StatusLive, "HT": StatusLive, "2H": StatusLive, "ET": StatusLive, "P": StatusLive, "LIVE": StatusLive,
		"FT": StatusFinal, "AET": StatusFinal, "PEN": StatusFinal,
	}
	for short, want := range cases {
		if got := mapStatus(short); got != want {
			t.Errorf("mapStatus(%q) = %q, want %q", short, got, want)
		}
	}
	if got := mapStatus("WTF"); got != StatusScheduled {
		t.Errorf("mapStatus(unknown) = %q, want scheduled (safe default)", got)
	}
}

func TestMapStage(t *testing.T) {
	if got := mapStage("Group A - 1"); got != StageGroup {
		t.Errorf("mapStage(group round) = %q, want group", got)
	}
	for _, r := range []string{"Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final", "3rd Place Final"} {
		if got := mapStage(r); got != StageKnockout {
			t.Errorf("mapStage(%q) = %q, want knockout", r, got)
		}
	}
}

func TestParseFixturesResponseMapsFields(t *testing.T) {
	js := []byte(`{"response":[{
		"fixture":{"id":1001,"date":"2026-06-11T19:00:00+00:00","status":{"short":"NS"}},
		"league":{"round":"Group A - 1"},
		"teams":{"home":{"id":10},"away":{"id":20}},
		"goals":{"home":null,"away":null}
	}]}`)
	fxs, err := parseFixtures(js)
	if err != nil {
		t.Fatalf("parseFixtures err = %v", err)
	}
	if len(fxs) != 1 {
		t.Fatalf("got %d fixtures, want 1", len(fxs))
	}
	f := fxs[0]
	if f.APIFixtureID != 1001 || f.HomeAPITeamID != 10 || f.AwayAPITeamID != 20 {
		t.Errorf("ids wrong: %+v", f)
	}
	if f.Stage != StageGroup || f.Status != StatusScheduled {
		t.Errorf("stage/status wrong: %+v", f)
	}
	if !f.KickoffUTC.Equal(mustTime(t, "2026-06-11T19:00:00Z")) {
		t.Errorf("kickoff = %v, want 2026-06-11T19:00:00Z (UTC)", f.KickoffUTC)
	}
	if f.HomeScore != nil || f.AwayScore != nil {
		t.Errorf("scores should be nil for NS fixture: %+v", f)
	}
}

func TestParseTeamsResponse(t *testing.T) {
	js := []byte(`{"response":[{"team":{"id":10,"name":"Brazil","code":"BRA","logo":"https://x/10.png"}}]}`)
	teams, err := parseTeams(js)
	if err != nil {
		t.Fatalf("parseTeams err = %v", err)
	}
	if len(teams) != 1 || teams[0].APITeamID != 10 || teams[0].Name != "Brazil" || teams[0].Code != "BRA" {
		t.Errorf("team mapping wrong: %+v", teams)
	}
}

func mustTime(t *testing.T, s string) time.Time {
	t.Helper()
	ts, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatal(err)
	}
	return ts
}

func TestParseSurfacesAPIErrors(t *testing.T) {
	// API-Football returns HTTP 200 with an `errors` object when a request is
	// rejected (e.g. plan/quota). Both parsers must surface that as an error.
	planErr := []byte(`{"errors":{"plan":"Free plans do not have access to this season, try from 2022 to 2024."},"response":[]}`)

	if _, err := parseTeams(planErr); err == nil {
		t.Error("parseTeams: expected error for API errors object, got nil")
	}
	if _, err := parseFixtures(planErr); err == nil {
		t.Error("parseFixtures: expected error for API errors object, got nil")
	}

	// Empty errors (`[]`) must NOT be treated as an error.
	ok := []byte(`{"errors":[],"response":[]}`)
	if _, err := parseTeams(ok); err != nil {
		t.Errorf("parseTeams: empty errors should be fine, got %v", err)
	}
}
