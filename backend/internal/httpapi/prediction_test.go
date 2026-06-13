package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/auth"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

// fakePredMatchStore serves a single match for GetMatchByID and records nothing else.
type fakePredMatchStore struct {
	match store.MatchByID
	found bool
}

func (f fakePredMatchStore) ListMatchesWithTeams(context.Context) ([]store.MatchWithTeams, error) {
	return nil, nil
}
func (f fakePredMatchStore) GetMatchByID(_ context.Context, id int64) (store.MatchByID, error) {
	if !f.found || id != f.match.ID {
		return store.MatchByID{}, store.ErrNotFound
	}
	return f.match, nil
}

// fakePredStore records the last upsert and returns canned list rows.
type fakePredStore struct {
	upserts []store.UpsertPredictionParams
	list    []store.Prediction
}

func (f *fakePredStore) UpsertPrediction(_ context.Context, p store.UpsertPredictionParams) error {
	f.upserts = append(f.upserts, p)
	return nil
}
func (f *fakePredStore) ListPredictionsByUser(context.Context, int64) ([]store.Prediction, error) {
	return f.list, nil
}

func i64(v int64) *int64 { return &v }

// predDeps wires an authed user + the given match + a fresh prediction store.
func predDeps(t *testing.T, m store.MatchByID, found bool) (*Deps, *http.Cookie, *fakePredStore) {
	t.Helper()
	fs := newFakeStore() // auth_test.go
	u, _ := fs.UpsertUser(context.Background(), store.UpsertUserParams{Email: "dev@sayonetech.com"})
	sm := auth.NewSessionManager("test-secret")
	ps := &fakePredStore{}
	d := &Deps{
		Store:       fs,
		Matches:     fakePredMatchStore{match: m, found: found},
		Predictions: ps,
		Sessions:    sm,
	}
	return d, &http.Cookie{Name: sessionCookieName, Value: sm.Encode(auth.Session{UserID: u.ID}, time.Hour)}, ps
}

func doPut(t *testing.T, d *Deps, cookie *http.Cookie, id, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, "/api/matches/"+id+"/prediction", strings.NewReader(body))
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	NewRouter(d, false).ServeHTTP(rec, req)
	return rec
}

// A group match (known teams) kicking off well in the future, with a fixed clock.
func futureGroupMatch() store.MatchByID {
	return store.MatchByID{
		ID: 1, Stage: store.StageGroup, HomeTeamID: i64(1), AwayTeamID: i64(2),
		KickoffUTC: time.Date(2026, 6, 20, 0, 0, 0, 0, time.UTC), Status: store.StatusScheduled,
	}
}

func withClock(t *testing.T, at time.Time) {
	t.Helper()
	old := now
	now = func() time.Time { return at }
	t.Cleanup(func() { now = old })
}

func TestPutPredictionRequiresAuth(t *testing.T) {
	d, _, _ := predDeps(t, futureGroupMatch(), true)
	rec := doPut(t, d, nil, "1", `{"home_score":1,"away_score":0}`)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestPutPredictionCreatesBeforeKickoff(t *testing.T) {
	withClock(t, time.Date(2026, 6, 12, 0, 0, 0, 0, time.UTC))
	d, cookie, ps := predDeps(t, futureGroupMatch(), true)
	rec := doPut(t, d, cookie, "1", `{"home_score":2,"away_score":1}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if len(ps.upserts) != 1 || ps.upserts[0].HomeScore != 2 || ps.upserts[0].AwayScore != 1 || ps.upserts[0].MatchID != 1 {
		t.Fatalf("upsert = %+v", ps.upserts)
	}
	var resp predictionDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.HomeScore != 2 || resp.AwayScore != 1 || resp.PenaltyWinnerTeamID != nil {
		t.Fatalf("resp = %+v", resp)
	}
}

func TestPutPredictionRejectedAtKickoff(t *testing.T) {
	withClock(t, time.Date(2026, 6, 20, 0, 0, 0, 0, time.UTC))
	d, cookie, ps := predDeps(t, futureGroupMatch(), true)
	rec := doPut(t, d, cookie, "1", `{"home_score":1,"away_score":1}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
	if len(ps.upserts) != 0 {
		t.Fatalf("locked write must not upsert, got %+v", ps.upserts)
	}
}

func TestPutPredictionUnknownMatch404(t *testing.T) {
	withClock(t, time.Date(2026, 6, 12, 0, 0, 0, 0, time.UTC))
	d, cookie, _ := predDeps(t, futureGroupMatch(), false)
	rec := doPut(t, d, cookie, "999", `{"home_score":1,"away_score":0}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestPutPredictionTBDTeams422(t *testing.T) {
	withClock(t, time.Date(2026, 6, 12, 0, 0, 0, 0, time.UTC))
	m := store.MatchByID{ID: 1, Stage: store.StageKnockout, HomeTeamID: nil, AwayTeamID: nil,
		KickoffUTC: time.Date(2026, 7, 4, 0, 0, 0, 0, time.UTC), Status: store.StatusScheduled}
	d, cookie, ps := predDeps(t, m, true)
	rec := doPut(t, d, cookie, "1", `{"home_score":1,"away_score":1}`)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
	if len(ps.upserts) != 0 {
		t.Fatalf("TBD write must not upsert")
	}
}

func TestPutPredictionScoreBounds422(t *testing.T) {
	withClock(t, time.Date(2026, 6, 12, 0, 0, 0, 0, time.UTC))
	for _, body := range []string{
		`{"home_score":-1,"away_score":0}`,
		`{"home_score":100,"away_score":0}`,
		`{"away_score":0}`, // missing home_score
	} {
		d, cookie, ps := predDeps(t, futureGroupMatch(), true)
		rec := doPut(t, d, cookie, "1", body)
		if rec.Code != http.StatusUnprocessableEntity {
			t.Fatalf("body %s: status = %d, want 422", body, rec.Code)
		}
		if len(ps.upserts) != 0 {
			t.Fatalf("body %s: must not upsert", body)
		}
	}
}

func TestPutPredictionPenaltyWinnerOnKnockoutDraw(t *testing.T) {
	withClock(t, time.Date(2026, 6, 12, 0, 0, 0, 0, time.UTC))
	m := store.MatchByID{ID: 1, Stage: store.StageKnockout, HomeTeamID: i64(1), AwayTeamID: i64(2),
		KickoffUTC: time.Date(2026, 7, 4, 0, 0, 0, 0, time.UTC), Status: store.StatusScheduled}
	d, cookie, ps := predDeps(t, m, true)
	rec := doPut(t, d, cookie, "1", `{"home_score":1,"away_score":1,"penalty_winner_team_id":2}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if ps.upserts[0].PenaltyWinnerTeamID == nil || *ps.upserts[0].PenaltyWinnerTeamID != 2 {
		t.Fatalf("penalty winner not stored: %+v", ps.upserts[0])
	}
}

func TestPutPredictionPenaltyWinnerRejected(t *testing.T) {
	withClock(t, time.Date(2026, 6, 12, 0, 0, 0, 0, time.UTC))
	cases := map[string]struct {
		match store.MatchByID
		body  string
	}{
		"group match cannot pick winner": {futureGroupMatch(), `{"home_score":1,"away_score":1,"penalty_winner_team_id":1}`},
		"knockout non-draw cannot pick":  {store.MatchByID{ID: 1, Stage: store.StageKnockout, HomeTeamID: i64(1), AwayTeamID: i64(2), KickoffUTC: time.Date(2026, 7, 4, 0, 0, 0, 0, time.UTC)}, `{"home_score":2,"away_score":1,"penalty_winner_team_id":1}`},
		"winner must be home or away":    {store.MatchByID{ID: 1, Stage: store.StageKnockout, HomeTeamID: i64(1), AwayTeamID: i64(2), KickoffUTC: time.Date(2026, 7, 4, 0, 0, 0, 0, time.UTC)}, `{"home_score":1,"away_score":1,"penalty_winner_team_id":9}`},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			d, cookie, ps := predDeps(t, tc.match, true)
			rec := doPut(t, d, cookie, "1", tc.body)
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("status = %d, want 422", rec.Code)
			}
			if len(ps.upserts) != 0 {
				t.Fatalf("must not upsert")
			}
		})
	}
}
