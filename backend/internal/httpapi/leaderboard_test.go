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

type fakeLeaderboardStore struct {
	weekly    []store.LeaderboardRow
	overall   []store.LeaderboardRow
	weeklyRes []store.WeeklyResult
	gotFrom   time.Time
	gotTo     time.Time
}

func (f *fakeLeaderboardStore) WeeklyLeaderboard(_ context.Context, from, to time.Time) ([]store.LeaderboardRow, error) {
	f.gotFrom, f.gotTo = from, to
	return f.weekly, nil
}
func (f *fakeLeaderboardStore) OverallLeaderboard(context.Context) ([]store.LeaderboardRow, error) {
	return f.overall, nil
}
func (f *fakeLeaderboardStore) ListWeeklyResults(context.Context, time.Time) ([]store.WeeklyResult, error) {
	return f.weeklyRes, nil
}
func (f *fakeLeaderboardStore) UpsertWeeklyResults(context.Context, []store.UpsertWeeklyResultParams) error {
	return nil
}

func lbDeps(t *testing.T, ls store.LeaderboardStore) (*Deps, *http.Cookie, int64) {
	t.Helper()
	fs := newFakeStore()
	u, _ := fs.UpsertUser(context.Background(), store.UpsertUserParams{Email: "dev@sayonetech.com"})
	sm := auth.NewSessionManager("test-secret")
	d := &Deps{Store: fs, Sessions: sm, Leaderboard: ls}
	return d, &http.Cookie{Name: sessionCookieName, Value: sm.Encode(auth.Session{UserID: u.ID}, time.Hour)}, u.ID
}

func getLB(t *testing.T, d *Deps, cookie *http.Cookie, query string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/leaderboard"+query, nil)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	NewRouter(d, false).ServeHTTP(rec, req)
	return rec
}

func TestLeaderboardRequiresAuth(t *testing.T) {
	d, _, _ := lbDeps(t, &fakeLeaderboardStore{})
	if rec := getLB(t, d, nil, "?period=overall"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestLeaderboardOverallRanksAndMarksMe(t *testing.T) {
	ls := &fakeLeaderboardStore{overall: []store.LeaderboardRow{
		{UserID: 5, Name: "Aaa", Points: 18, Exact: 3, Correct: 1},
		{UserID: 1, Name: "Dev", Points: 18, Exact: 2, Correct: 2}, // same total, fewer exact → rank 2
		{UserID: 9, Name: "Bbb", Points: 7, Exact: 1, Correct: 0},
	}}
	d, cookie, _ := lbDeps(t, ls) // dev user id == 1
	rec := getLB(t, d, cookie, "?period=overall")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
	var resp leaderboardResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Period != "overall" || resp.Total != 3 {
		t.Fatalf("resp = %+v", resp)
	}
	if resp.Rows[0].Rank != 1 || resp.Rows[0].UserID != 5 || resp.Rows[1].Rank != 2 || resp.Rows[1].UserID != 1 {
		t.Fatalf("ranks = %+v", resp.Rows)
	}
	if !resp.Rows[1].IsMe || resp.Me == nil || resp.Me.Rank != 2 || resp.Me.Points != 18 {
		t.Fatalf("me handling = row %+v me %+v", resp.Rows[1], resp.Me)
	}
}

func TestLeaderboardWeeklyWindowAndWinner(t *testing.T) {
	// week=2026-06-15 (a Monday). Window must be [Mon 00:00 IST, next Mon 00:00 IST) in UTC,
	// i.e. 2026-06-14T18:30:00Z .. 2026-06-21T18:30:00Z.
	ls := &fakeLeaderboardStore{
		weekly:    []store.LeaderboardRow{{UserID: 1, Name: "Dev", Points: 8, Exact: 1, Correct: 1}},
		weeklyRes: []store.WeeklyResult{{UserID: 1, Points: 8, IsWinner: true}},
	}
	d, cookie, _ := lbDeps(t, ls)
	rec := getLB(t, d, cookie, "?period=week&week=2026-06-15")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
	wantFrom := time.Date(2026, 6, 14, 18, 30, 0, 0, time.UTC)
	wantTo := time.Date(2026, 6, 21, 18, 30, 0, 0, time.UTC)
	if !ls.gotFrom.Equal(wantFrom) || !ls.gotTo.Equal(wantTo) {
		t.Fatalf("window = [%s, %s); want [%s, %s)", ls.gotFrom, ls.gotTo, wantFrom, wantTo)
	}
	var resp leaderboardResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Week != "2026-06-15" || len(resp.Rows) != 1 || !resp.Rows[0].IsWinner {
		t.Fatalf("weekly resp = %+v", resp)
	}
}

func TestLeaderboardBadParams(t *testing.T) {
	d, cookie, _ := lbDeps(t, &fakeLeaderboardStore{})
	for _, q := range []string{"?period=nope", "?period=week&week=bad-date"} {
		if rec := getLB(t, d, cookie, q); rec.Code != http.StatusBadRequest {
			t.Fatalf("query %s: status = %d, want 400", q, rec.Code)
		}
	}
}
