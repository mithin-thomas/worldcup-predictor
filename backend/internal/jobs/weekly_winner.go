package jobs

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

var istLoc = mustIST()

func mustIST() *time.Location {
	loc, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		return time.FixedZone("IST", 5*3600+1800)
	}
	return loc
}

// WeeklyWinner materializes the previous completed IST week into weekly_results
// and marks co-winners. Idempotent: it SETs each row (never increments).
type WeeklyWinner struct {
	Store store.LeaderboardStore
	Now   func() time.Time
}

// WeeklySummary is the run report (logged).
type WeeklySummary struct {
	WeekStart    string
	Participants int
	Winners      int
}

// Run computes the previous IST week's standings and upserts weekly_results.
func (j WeeklyWinner) Run(ctx context.Context) (WeeklySummary, error) {
	nowIST := j.Now().In(istLoc)
	y, m, d := nowIST.Date()
	today := time.Date(y, m, d, 0, 0, 0, 0, istLoc)
	offset := (int(today.Weekday()) + 6) % 7 // Monday=0
	thisMonday := today.AddDate(0, 0, -offset)
	weekStart := thisMonday.AddDate(0, 0, -7) // previous week's IST Monday

	from := weekStart.UTC() // window start instant (IST Mon 00:00 → e.g. …18:30Z)
	to := thisMonday.UTC()  // window end instant (exclusive)
	wy, wm, wd := weekStart.Date()
	weekStartDate := time.Date(wy, wm, wd, 0, 0, 0, 0, time.UTC) // IST calendar Monday as the DATE key

	rows, err := j.Store.WeeklyLeaderboard(ctx, from, to)
	if err != nil {
		return WeeklySummary{}, fmt.Errorf("jobs: weekly leaderboard: %w", err)
	}

	var top int64
	for _, r := range rows {
		if r.Points > top {
			top = r.Points
		}
	}

	winners := 0
	for _, r := range rows {
		isWinner := top > 0 && r.Points == top
		if isWinner {
			winners++
		}
		if err := j.Store.UpsertWeeklyResult(ctx, store.UpsertWeeklyResultParams{
			UserID: r.UserID, WeekStart: weekStartDate, Points: int32(r.Points), IsWinner: isWinner,
		}); err != nil {
			return WeeklySummary{}, fmt.Errorf("jobs: upsert weekly result: %w", err)
		}
	}

	sum := WeeklySummary{WeekStart: weekStart.Format("2006-01-02"), Participants: len(rows), Winners: winners}
	slog.Info("weekly-winner complete", "week_start", sum.WeekStart, "participants", sum.Participants, "winners", sum.Winners)
	return sum, nil
}
