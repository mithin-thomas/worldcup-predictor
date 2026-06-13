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

func (f fakeMatchStore) GetMatchByID(context.Context, int64) (store.MatchByID, error) {
	return store.MatchByID{}, store.ErrNotFound
}

// fakeListPredStore returns canned predictions and counts how many times it is called.
type fakeListPredStore struct {
	preds []store.Prediction
	calls int
}

func (f *fakeListPredStore) UpsertPrediction(context.Context, store.UpsertPredictionParams) error {
	return nil
}
func (f *fakeListPredStore) ListPredictionsByUser(context.Context, int64) ([]store.Prediction, error) {
	f.calls++
	return f.preds, nil
}

func authedMatchesDeps(t *testing.T, matches []store.MatchWithTeams, preds []store.Prediction) (*Deps, *http.Cookie, *fakeListPredStore) {
	t.Helper()
	fs := newFakeStore()
	u, _ := fs.UpsertUser(context.Background(), store.UpsertUserParams{Email: "dev@sayonetech.com"})
	sm := auth.NewSessionManager("test-secret")
	ps := &fakeListPredStore{preds: preds}
	d := &Deps{Store: fs, Matches: fakeMatchStore{matches: matches}, Predictions: ps, Sessions: sm, AllowedEmailDomain: "sayonetech.com"}
	return d, &http.Cookie{Name: sessionCookieName, Value: sm.Encode(auth.Session{UserID: u.ID}, time.Hour)}, ps
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

	d, cookie, _ := authedMatchesDeps(t, []store.MatchWithTeams{group, placeholder}, nil)
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

func TestGetMatchesAttachesCallerPrediction(t *testing.T) {
	fixedNow := time.Date(2026, 6, 12, 0, 0, 0, 0, time.UTC)
	old := now
	now = func() time.Time { return fixedNow }
	defer func() { now = old }()

	m1 := store.MatchWithTeams{
		ID: 1, MatchNumber: 1, Stage: store.StageGroup, GroupLetter: "A", MatchLabel: "Group A",
		KickoffUTC: time.Date(2026, 6, 20, 0, 0, 0, 0, time.UTC), Status: store.StatusScheduled,
		Home: &store.TeamRef{ID: 1, Name: "Mexico", Code: "MEX"}, Away: &store.TeamRef{ID: 2, Name: "South Africa", Code: "RSA"},
	}
	m2 := store.MatchWithTeams{
		ID: 2, MatchNumber: 2, Stage: store.StageGroup, GroupLetter: "A", MatchLabel: "Group A",
		KickoffUTC: time.Date(2026, 6, 21, 0, 0, 0, 0, time.UTC), Status: store.StatusScheduled,
		Home: &store.TeamRef{ID: 3, Name: "France", Code: "FRA"}, Away: &store.TeamRef{ID: 4, Name: "Spain", Code: "ESP"},
	}
	preds := []store.Prediction{{MatchID: 1, HomeScore: 2, AwayScore: 1}}

	d, cookie, ps := authedMatchesDeps(t, []store.MatchWithTeams{m1, m2}, preds)
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
	// Predictions loaded exactly once (no N+1).
	if ps.calls != 1 {
		t.Fatalf("ListPredictionsByUser called %d times, want 1", ps.calls)
	}
	var withPred, withoutPred *matchDTO
	for i := range resp.Days {
		for j := range resp.Days[i].Matches {
			mm := &resp.Days[i].Matches[j]
			switch mm.ID {
			case 1:
				withPred = mm
			case 2:
				withoutPred = mm
			}
		}
	}
	if withPred == nil || withPred.Prediction == nil || withPred.Prediction.HomeScore != 2 || withPred.Prediction.AwayScore != 1 {
		t.Fatalf("match 1 prediction = %+v", withPred)
	}
	if withoutPred == nil || withoutPred.Prediction != nil {
		t.Fatalf("match 2 should have no prediction, got %+v", withoutPred)
	}
}
