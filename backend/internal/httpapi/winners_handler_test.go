package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

type fakeWinnersStore struct {
	winners []store.Winner
	marked  struct {
		week   time.Time
		user   int64
		paid   bool
		hasNow bool
	}
	affected bool
}

func (f *fakeWinnersStore) WeeklyLeaderboard(context.Context, time.Time, time.Time) ([]store.LeaderboardRow, error) {
	return nil, nil
}
func (f *fakeWinnersStore) OverallLeaderboard(context.Context) ([]store.LeaderboardRow, error) {
	return nil, nil
}
func (f *fakeWinnersStore) ListWeeklyResults(context.Context, time.Time) ([]store.WeeklyResult, error) {
	return nil, nil
}
func (f *fakeWinnersStore) UpsertWeeklyResults(context.Context, []store.UpsertWeeklyResultParams) error {
	return nil
}
func (f *fakeWinnersStore) ListWinners(context.Context) ([]store.Winner, error) {
	return f.winners, nil
}
func (f *fakeWinnersStore) MarkWinnerPaid(_ context.Context, week time.Time, user int64, paid bool, paidAt *time.Time) (bool, error) {
	f.marked.week, f.marked.user, f.marked.paid, f.marked.hasNow = week, user, paid, paidAt != nil
	return f.affected, nil
}

func date(s string) time.Time {
	t, _ := time.Parse("2006-01-02", s)
	return t
}

func TestGetWinners_GroupsByWeekNewestFirst(t *testing.T) {
	st := &fakeWinnersStore{winners: []store.Winner{
		{WeekStart: date("2026-06-08"), UserID: 5, Name: "Alice", Points: 18, PrizePaid: true},
		{WeekStart: date("2026-06-08"), UserID: 6, Name: "Bob", Points: 18, PrizePaid: false},
		{WeekStart: date("2026-06-01"), UserID: 7, Name: "Cara", Points: 11, PrizePaid: false},
	}}
	d := &Deps{Leaderboard: st}
	req := httptest.NewRequest(http.MethodGet, "/api/winners", nil)
	req = req.WithContext(context.WithValue(req.Context(), userCtxKey, store.User{ID: 5}))
	rec := httptest.NewRecorder()
	d.GetWinners(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got struct {
		Weeks []struct {
			WeekStart string `json:"week_start"`
			Winners   []struct {
				UserID    int64  `json:"user_id"`
				Name      string `json:"name"`
				Points    int64  `json:"points"`
				PrizePaid bool   `json:"prize_paid"`
			} `json:"winners"`
		} `json:"weeks"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.Weeks) != 2 {
		t.Fatalf("weeks = %d, want 2", len(got.Weeks))
	}
	if got.Weeks[0].WeekStart != "2026-06-08" {
		t.Errorf("first week = %q, want 2026-06-08 (newest first)", got.Weeks[0].WeekStart)
	}
	if len(got.Weeks[0].Winners) != 2 {
		t.Errorf("co-winners = %d, want 2", len(got.Weeks[0].Winners))
	}
	if !got.Weeks[0].Winners[0].PrizePaid {
		t.Errorf("Alice should be prize_paid")
	}
}

func TestGetWinners_EmptyReturnsEmptyArray(t *testing.T) {
	d := &Deps{Leaderboard: &fakeWinnersStore{}}
	req := httptest.NewRequest(http.MethodGet, "/api/winners", nil)
	req = req.WithContext(context.WithValue(req.Context(), userCtxKey, store.User{ID: 5}))
	rec := httptest.NewRecorder()
	d.GetWinners(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got map[string]json.RawMessage
	_ = json.NewDecoder(rec.Body).Decode(&got)
	if string(got["weeks"]) != "[]" {
		t.Errorf("weeks = %s, want []", got["weeks"])
	}
}

func TestPutWinnerPaid_SetsPaid(t *testing.T) {
	st := &fakeWinnersStore{affected: true}
	d := &Deps{Leaderboard: st}
	body := `{"week_start":"2026-06-08","user_id":5,"paid":true}`
	req := httptest.NewRequest(http.MethodPut, "/api/admin/winners/paid", strings.NewReader(body))
	rec := httptest.NewRecorder()
	d.PutWinnerPaid(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !st.marked.paid || !st.marked.hasNow {
		t.Errorf("paid=true should set prize_paid and a non-nil paid_at; got paid=%v hasNow=%v", st.marked.paid, st.marked.hasNow)
	}
	if st.marked.user != 5 || st.marked.week.Format("2006-01-02") != "2026-06-08" {
		t.Errorf("wrong target: week=%s user=%d", st.marked.week.Format("2006-01-02"), st.marked.user)
	}
}

func TestPutWinnerPaid_UnpaidClearsPaidAt(t *testing.T) {
	st := &fakeWinnersStore{affected: true}
	d := &Deps{Leaderboard: st}
	body := `{"week_start":"2026-06-08","user_id":5,"paid":false}`
	req := httptest.NewRequest(http.MethodPut, "/api/admin/winners/paid", strings.NewReader(body))
	rec := httptest.NewRecorder()
	d.PutWinnerPaid(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if st.marked.paid || st.marked.hasNow {
		t.Errorf("paid=false should clear prize_paid and pass nil paid_at; got paid=%v hasNow=%v", st.marked.paid, st.marked.hasNow)
	}
}

func TestPutWinnerPaid_NotFound(t *testing.T) {
	d := &Deps{Leaderboard: &fakeWinnersStore{affected: false}}
	body := `{"week_start":"2026-06-08","user_id":999,"paid":true}`
	req := httptest.NewRequest(http.MethodPut, "/api/admin/winners/paid", strings.NewReader(body))
	rec := httptest.NewRecorder()
	d.PutWinnerPaid(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestPutWinnerPaid_BadInput(t *testing.T) {
	d := &Deps{Leaderboard: &fakeWinnersStore{affected: true}}
	for _, body := range []string{
		`{"week_start":"08-06-2026","user_id":5,"paid":true}`, // bad date format
		`{"week_start":"2026-06-08","user_id":0,"paid":true}`, // zero user
		`not json`,
	} {
		req := httptest.NewRequest(http.MethodPut, "/api/admin/winners/paid", strings.NewReader(body))
		rec := httptest.NewRecorder()
		d.PutWinnerPaid(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("body %q: status = %d, want 400", body, rec.Code)
		}
	}
}
