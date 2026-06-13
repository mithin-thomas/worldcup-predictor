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

type fakeMatchStore struct {
	matches []store.MatchWithTeams
}

func (f fakeMatchStore) UpsertTeam(context.Context, store.UpsertTeamParams) error   { return nil }
func (f fakeMatchStore) GetTeamIDByAPIID(context.Context, int64) (int64, error)     { return 0, nil }
func (f fakeMatchStore) UpsertMatch(context.Context, store.UpsertMatchParams) error { return nil }
func (f fakeMatchStore) ListMatchesWithTeams(context.Context) ([]store.MatchWithTeams, error) {
	return f.matches, nil
}

func matchAt(id int64, kickoff time.Time) store.MatchWithTeams {
	return store.MatchWithTeams{
		ID: id, APIFixtureID: id, Stage: store.StageGroup, Round: "Group A - 1",
		KickoffUTC: kickoff, Status: store.StatusScheduled,
		Home: store.TeamRef{ID: 1, Name: "Brazil", Code: "BRA"},
		Away: store.TeamRef{ID: 2, Name: "Argentina", Code: "ARG"},
	}
}

// authedMatchesDeps builds a Deps with a fake match store and a valid session cookie for a user.
func authedMatchesDeps(t *testing.T, matches []store.MatchWithTeams) (*Deps, *http.Cookie) {
	t.Helper()
	fs := newFakeStore() // from auth_test.go
	u, _ := fs.UpsertUser(context.Background(), store.UpsertUserParams{Email: "dev@sayonetech.com"})
	sm := auth.NewSessionManager("test-secret")
	d := &Deps{Store: fs, Matches: fakeMatchStore{matches: matches}, Sessions: sm, AllowedEmailDomain: "sayonetech.com"}
	cookie := &http.Cookie{Name: sessionCookieName, Value: sm.Encode(auth.Session{UserID: u.ID}, time.Hour)}
	return d, cookie
}

func TestGetMatchesRequiresAuth(t *testing.T) {
	d := &Deps{Matches: fakeMatchStore{}, Sessions: auth.NewSessionManager("test-secret")}
	srv := NewRouter(d, false)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/matches", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestGetMatchesGroupsByISTDateAndComputesLock(t *testing.T) {
	// Fix the clock: 2026-06-11 20:00 UTC.
	fixedNow := time.Date(2026, 6, 11, 20, 0, 0, 0, time.UTC)
	old := now
	now = func() time.Time { return fixedNow }
	defer func() { now = old }()

	// A: 19:00 UTC (before now) -> locked; IST 2026-06-12 00:30 -> date 2026-06-12
	// B: next day 13:00 UTC (after now) -> not locked; IST 2026-06-12 18:30 -> date 2026-06-12
	// C: 2026-06-20 10:00 UTC -> IST 2026-06-20 15:30 -> distinct date 2026-06-20
	a := matchAt(1001, time.Date(2026, 6, 11, 19, 0, 0, 0, time.UTC))
	b := matchAt(1002, time.Date(2026, 6, 12, 13, 0, 0, 0, time.UTC))
	c := matchAt(1003, time.Date(2026, 6, 20, 10, 0, 0, 0, time.UTC))

	d, cookie := authedMatchesDeps(t, []store.MatchWithTeams{a, b, c})
	srv := NewRouter(d, false)

	req := httptest.NewRequest(http.MethodGet, "/api/matches", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var resp struct {
		Days []struct {
			Date    string `json:"date"`
			Matches []struct {
				ID         int64  `json:"id"`
				Locked     bool   `json:"locked"`
				KickoffIST string `json:"kickoff_ist"`
			} `json:"matches"`
		} `json:"days"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v (body=%s)", err, rec.Body.String())
	}

	if len(resp.Days) != 2 {
		t.Fatalf("days = %d, want 2 distinct IST dates; body=%s", len(resp.Days), rec.Body.String())
	}
	if resp.Days[0].Date != "2026-06-12" || len(resp.Days[0].Matches) != 2 {
		t.Errorf("day0 = %q with %d matches, want 2026-06-12 with 2", resp.Days[0].Date, len(resp.Days[0].Matches))
	}
	if resp.Days[1].Date != "2026-06-20" || len(resp.Days[1].Matches) != 1 {
		t.Errorf("day1 = %q with %d matches, want 2026-06-20 with 1", resp.Days[1].Date, len(resp.Days[1].Matches))
	}
	if !resp.Days[0].Matches[0].Locked {
		t.Errorf("match A (1001) should be locked (kickoff 19:00Z < now 20:00Z)")
	}
	if resp.Days[0].Matches[1].Locked {
		t.Errorf("match B (1002) should NOT be locked (kickoff next day)")
	}
}
