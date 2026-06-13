package sportsapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

const sampleJSON = `{"matches":[
  {"id":1001,"utcDate":"2026-06-13T16:00:00Z","status":"FINISHED","stage":"GROUP_STAGE",
   "homeTeam":{"id":759},"awayTeam":{"id":760},
   "score":{"winner":"HOME_TEAM","duration":"REGULAR","fullTime":{"home":4,"away":1}}},
  {"id":1002,"utcDate":"2026-07-04T18:00:00Z","status":"FINISHED","stage":"LAST_16",
   "homeTeam":{"id":770},"awayTeam":{"id":771},
   "score":{"winner":"AWAY_TEAM","duration":"PENALTY_SHOOTOUT","fullTime":{"home":1,"away":1}}}
]}`

func TestListFinishedMatchesParsesAndSendsAuthHeader(t *testing.T) {
	var gotPath, gotToken string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path + "?" + r.URL.RawQuery
		gotToken = r.Header.Get("X-Auth-Token")
		_, _ = w.Write([]byte(sampleJSON))
	}))
	defer srv.Close()

	c := New(srv.URL, "secret-key")
	matches, err := c.ListFinishedMatches(context.Background(), "2026-06-12", "2026-06-13")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if gotToken != "secret-key" {
		t.Errorf("X-Auth-Token = %q, want secret-key", gotToken)
	}
	if gotPath != "/competitions/WC/matches?dateFrom=2026-06-12&dateTo=2026-06-13&status=FINISHED" {
		t.Errorf("path = %q", gotPath)
	}
	if len(matches) != 2 || matches[0].ID != 1001 || matches[0].HomeTeam.ID != 759 {
		t.Fatalf("matches = %+v", matches)
	}
}

func TestListFinishedMatchesNon2xxIsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()
	if _, err := New(srv.URL, "k").ListFinishedMatches(context.Background(), "a", "b"); err == nil {
		t.Fatal("expected error on 403")
	}
}

func intp(v int) *int { return &v }

func TestToResult(t *testing.T) {
	cases := []struct {
		name string
		in   Match
		want Result
	}{
		{"group final", Match{ID: 1, Status: "FINISHED", Stage: "GROUP_STAGE",
			Score: Score{Winner: "HOME_TEAM", Duration: "REGULAR", FullTime: FullTime{Home: intp(4), Away: intp(1)}}},
			Result{Final: true, Knockout: false, Home: 4, Away: 1, WentToPenalties: false, WinnerSide: "HOME_TEAM"}},
		{"knockout shootout", Match{ID: 2, Status: "FINISHED", Stage: "LAST_16",
			Score: Score{Winner: "AWAY_TEAM", Duration: "PENALTY_SHOOTOUT", FullTime: FullTime{Home: intp(1), Away: intp(1)}}},
			Result{Final: true, Knockout: true, Home: 1, Away: 1, WentToPenalties: true, WinnerSide: "AWAY_TEAM"}},
		{"knockout extra-time no shootout", Match{ID: 3, Status: "FINISHED", Stage: "QUARTER_FINALS",
			Score: Score{Winner: "HOME_TEAM", Duration: "EXTRA_TIME", FullTime: FullTime{Home: intp(2), Away: intp(1)}}},
			Result{Final: true, Knockout: true, Home: 2, Away: 1, WentToPenalties: false, WinnerSide: "HOME_TEAM"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got, ok := ToResult(tc.in); !ok || got != tc.want {
				t.Errorf("ToResult(%+v) = %+v, %v; want %+v", tc.in, got, ok, tc.want)
			}
		})
	}
}

func TestToResultSkipsIncomplete(t *testing.T) {
	if _, ok := ToResult(Match{ID: 9, Status: "FINISHED", Stage: "GROUP_STAGE", Score: Score{FullTime: FullTime{}}}); ok {
		t.Fatal("expected ok=false for missing scoreline")
	}
}
