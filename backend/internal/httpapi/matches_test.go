package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/auth"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

type fakeMatchStore struct{ matches []store.MatchWithTeams }

func (f fakeMatchStore) ListMatchesWithTeams(context.Context) ([]store.MatchWithTeams, error) {
	return f.matches, nil
}

func authedMatchesDeps(t *testing.T, matches []store.MatchWithTeams) (*Deps, *http.Cookie) {
	t.Helper()
	fs := newFakeStore() // from auth_test.go
	u, _ := fs.UpsertUser(context.Background(), store.UpsertUserParams{Email: "dev@sayonetech.com"})
	sm := auth.NewSessionManager("test-secret")
	d := &Deps{Store: fs, Matches: fakeMatchStore{matches: matches}, Sessions: sm, AllowedEmailDomain: "sayonetech.com"}
	return d, &http.Cookie{Name: sessionCookieName, Value: sm.Encode(auth.Session{UserID: u.ID}, time.Hour)}
}

func TestGetMatchesRequiresAuth(t *testing.T) {
	d := &Deps{Matches: fakeMatchStore{}, Sessions: auth.NewSessionManager("test-secret")}
	rec := httptest.NewRecorder()
	NewRouter(d, false).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/matches", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestGetMatchesGroupVenueLockAndPlaceholder(t *testing.T) {
	fixedNow := time.Date(2026, 6, 12, 0, 0, 0, 0, time.UTC)
	old := now
	now = func() time.Time { return fixedNow }
	defer func() { now = old }()

	group := store.MatchWithTeams{
		ID: 1, MatchNumber: 1, Stage: store.StageGroup, Round: "Group Stage", GroupLetter: "A",
		MatchLabel: "Group A", KickoffUTC: time.Date(2026, 6, 11, 21, 0, 0, 0, time.UTC), Status: store.StatusScheduled,
		Home:  &store.TeamRef{ID: 1, Name: "Mexico", Code: "MEX"},
		Away:  &store.TeamRef{ID: 2, Name: "South Africa", Code: "RSA"},
		Venue: &store.VenueRef{Name: "Estadio Azteca", City: "Mexico City", Country: "Mexico"},
	}
	placeholder := store.MatchWithTeams{
		ID: 89, MatchNumber: 89, Stage: store.StageKnockout, Round: "Round of 16", MatchLabel: "W73 vs W75",
		KickoffUTC: time.Date(2026, 7, 4, 18, 0, 0, 0, time.UTC), Status: store.StatusScheduled,
		Venue: &store.VenueRef{Name: "NRG Stadium", City: "Houston", Country: "USA"},
	}

	d, cookie := authedMatchesDeps(t, []store.MatchWithTeams{group, placeholder})
	req := httptest.NewRequest(http.MethodGet, "/api/matches", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	NewRouter(d, false).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	var resp matchesResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Days) != 2 {
		t.Fatalf("days = %d, want 2", len(resp.Days))
	}
	g := resp.Days[0].Matches[0]
	if g.Group != "A" || g.Venue == nil || g.Venue.Name != "Estadio Azteca" || g.Home == nil || g.Home.Code != "MEX" || !g.Locked {
		t.Errorf("group dto = %+v", g)
	}
	p := resp.Days[1].Matches[0]
	if p.Home != nil || p.Away != nil || p.Label != "W73 vs W75" || p.Locked {
		t.Errorf("placeholder dto = %+v", p)
	}
}
