package sportsapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestHTTPClientFetchesAndMaps(t *testing.T) {
	teamsJSON, _ := os.ReadFile("testdata/teams.json")
	fixturesJSON, _ := os.ReadFile("testdata/fixtures.json")

	var gotKey, gotTeamsQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKey = r.Header.Get("x-apisports-key")
		switch r.URL.Path {
		case "/teams":
			gotTeamsQuery = r.URL.RawQuery
			w.Write(teamsJSON)
		case "/fixtures":
			w.Write(fixturesJSON)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := NewHTTPClient(srv.URL, "test-key")

	teams, err := c.FetchTeams(context.Background())
	if err != nil {
		t.Fatalf("FetchTeams err = %v", err)
	}
	if len(teams) != 2 || teams[0].Name != "Brazil" {
		t.Errorf("teams = %+v", teams)
	}
	if gotKey != "test-key" {
		t.Errorf("auth header = %q, want test-key", gotKey)
	}
	if gotTeamsQuery != "league=1&season=2026" {
		t.Errorf("teams query = %q, want league=1&season=2026", gotTeamsQuery)
	}

	fxs, err := c.FetchFixtures(context.Background())
	if err != nil {
		t.Fatalf("FetchFixtures err = %v", err)
	}
	if len(fxs) != 2 || fxs[0].Stage != StageGroup || fxs[1].Stage != StageKnockout {
		t.Errorf("fixtures = %+v", fxs)
	}
}

func TestHTTPClientNon200IsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		w.Write([]byte(`{"errors":["rate limit"]}`))
	}))
	defer srv.Close()
	if _, err := NewHTTPClient(srv.URL, "k").FetchTeams(context.Background()); err == nil {
		t.Fatal("expected error on 429")
	}
}
