package jobs

import (
	"context"
	"testing"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

type fakeWeeklyStore struct {
	weekly  []store.LeaderboardRow
	gotFrom time.Time
	gotTo   time.Time
	upserts []store.UpsertWeeklyResultParams
}

func (f *fakeWeeklyStore) WeeklyLeaderboard(_ context.Context, from, to time.Time) ([]store.LeaderboardRow, error) {
	f.gotFrom, f.gotTo = from, to
	return f.weekly, nil
}
func (f *fakeWeeklyStore) OverallLeaderboard(context.Context) ([]store.LeaderboardRow, error) {
	return nil, nil
}
func (f *fakeWeeklyStore) ListWeeklyResults(context.Context, time.Time) ([]store.WeeklyResult, error) {
	return nil, nil
}
func (f *fakeWeeklyStore) UpsertWeeklyResults(_ context.Context, ps []store.UpsertWeeklyResultParams) error {
	f.upserts = append(f.upserts, ps...)
	return nil
}

func TestWeeklyWinnerComputesPreviousWeekAndCoWinners(t *testing.T) {
	// now = Mon 2026-06-22 13:30 IST (08:00 UTC) → previous week starts Mon 2026-06-15 00:00 IST.
	now := time.Date(2026, 6, 22, 8, 0, 0, 0, time.UTC)
	fs := &fakeWeeklyStore{weekly: []store.LeaderboardRow{
		{UserID: 1, Points: 12}, {UserID: 2, Points: 12}, {UserID: 3, Points: 5},
	}}
	job := WeeklyWinner{Store: fs, Now: func() time.Time { return now }}

	sum, err := job.Run(context.Background())
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	// window = [2026-06-15 00:00 IST, 2026-06-22 00:00 IST) = UTC 06-14T18:30 .. 06-21T18:30
	if !fs.gotFrom.Equal(time.Date(2026, 6, 14, 18, 30, 0, 0, time.UTC)) ||
		!fs.gotTo.Equal(time.Date(2026, 6, 21, 18, 30, 0, 0, time.UTC)) {
		t.Fatalf("window = [%s, %s)", fs.gotFrom, fs.gotTo)
	}
	// week_start stored as the IST Monday CALENDAR date at midnight UTC (the DATE key).
	wantWeek := time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC)
	winners := map[int64]bool{}
	for _, u := range fs.upserts {
		if !u.WeekStart.Equal(wantWeek) {
			t.Fatalf("week_start = %s, want %s", u.WeekStart, wantWeek)
		}
		winners[u.UserID] = u.IsWinner
	}
	if len(fs.upserts) != 3 || !winners[1] || !winners[2] || winners[3] {
		t.Fatalf("co-winners wrong: %+v", winners)
	}
	if sum.WeekStart != "2026-06-15" || sum.Winners != 2 || sum.Participants != 3 {
		t.Fatalf("summary = %+v", sum)
	}
}

func TestWeeklyWinnerNoWinnerWhenAllZero(t *testing.T) {
	now := time.Date(2026, 6, 22, 8, 0, 0, 0, time.UTC)
	fs := &fakeWeeklyStore{weekly: []store.LeaderboardRow{{UserID: 1, Points: 0}, {UserID: 2, Points: 0}}}
	job := WeeklyWinner{Store: fs, Now: func() time.Time { return now }}
	sum, _ := job.Run(context.Background())
	for _, u := range fs.upserts {
		if u.IsWinner {
			t.Fatalf("no winner expected when top total is 0: %+v", u)
		}
	}
	if sum.Winners != 0 {
		t.Fatalf("winners = %d, want 0", sum.Winners)
	}
}

func TestWeeklyWinnerIdempotent(t *testing.T) {
	now := time.Date(2026, 6, 22, 8, 0, 0, 0, time.UTC)
	fs := &fakeWeeklyStore{weekly: []store.LeaderboardRow{{UserID: 1, Points: 9}, {UserID: 2, Points: 4}}}
	job := WeeklyWinner{Store: fs, Now: func() time.Time { return now }}
	_, _ = job.Run(context.Background())
	first := append([]store.UpsertWeeklyResultParams(nil), fs.upserts...)
	fs.upserts = nil
	_, _ = job.Run(context.Background())
	if len(fs.upserts) != len(first) {
		t.Fatalf("upsert count changed: %d vs %d", len(fs.upserts), len(first))
	}
	for i := range first {
		if fs.upserts[i] != first[i] {
			t.Fatalf("not idempotent at %d: %+v vs %+v", i, fs.upserts[i], first[i])
		}
	}
}
