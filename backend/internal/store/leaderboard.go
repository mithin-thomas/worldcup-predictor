package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store/sqlc"
)

// LeaderboardRow is one user's summed standing (ordered by the query).
type LeaderboardRow struct {
	UserID    int64
	Name      string
	AvatarURL string
	Points    int64
	Exact     int64
	Correct   int64
	BonusHits int64 // §5.1 fourth tier; populated by OverallLeaderboard only (weekly=0)
}

// Winner is one past weekly champion (a weekly_results row with is_winner=1).
type Winner struct {
	WeekStart time.Time
	UserID    int64
	Name      string
	AvatarURL string
	Points    int64
	PrizePaid bool
	PaidAt    *time.Time
}

// WeeklyResult is a stored weekly_results row (for surfacing is_winner).
type WeeklyResult struct {
	UserID   int64
	Points   int32
	IsWinner bool
}

// UpsertWeeklyResultParams writes one user's weekly standing + winner flag.
type UpsertWeeklyResultParams struct {
	UserID    int64
	WeekStart time.Time
	Points    int32
	IsWinner  bool
}

// LeaderboardStore is the read surface for leaderboards + the weekly-winner write.
type LeaderboardStore interface {
	WeeklyLeaderboard(ctx context.Context, from, to time.Time) ([]LeaderboardRow, error)
	OverallLeaderboard(ctx context.Context) ([]LeaderboardRow, error)
	ListWeeklyResults(ctx context.Context, weekStart time.Time) ([]WeeklyResult, error)
	UpsertWeeklyResults(ctx context.Context, ps []UpsertWeeklyResultParams) error
	ListWinners(ctx context.Context) ([]Winner, error)
	MarkWinnerPaid(ctx context.Context, weekStart time.Time, userID int64, paid bool, paidAt *time.Time) (bool, error)
}

var _ LeaderboardStore = (*SQLStore)(nil)

func (s *SQLStore) WeeklyLeaderboard(ctx context.Context, from, to time.Time) ([]LeaderboardRow, error) {
	rows, err := s.q.WeeklyLeaderboard(ctx, sqlc.WeeklyLeaderboardParams{KickoffUtc: from, KickoffUtc_2: to})
	if err != nil {
		return nil, fmt.Errorf("store: weekly leaderboard: %w", err)
	}
	out := make([]LeaderboardRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, LeaderboardRow{UserID: r.UserID, Name: r.Name, AvatarURL: r.AvatarUrl, Points: r.Points, Exact: r.ExactCount, Correct: r.CorrectCount})
	}
	return out, nil
}

func (s *SQLStore) OverallLeaderboard(ctx context.Context) ([]LeaderboardRow, error) {
	rows, err := s.q.OverallLeaderboard(ctx)
	if err != nil {
		return nil, fmt.Errorf("store: overall leaderboard: %w", err)
	}
	out := make([]LeaderboardRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, LeaderboardRow{
			UserID: r.UserID, Name: r.Name, AvatarURL: r.AvatarUrl,
			Points: r.Points, Exact: r.ExactCount, Correct: r.CorrectCount,
			BonusHits: r.BonusHits,
		})
	}
	return out, nil
}

func (s *SQLStore) ListWeeklyResults(ctx context.Context, weekStart time.Time) ([]WeeklyResult, error) {
	rows, err := s.q.ListWeeklyResults(ctx, weekStart)
	if err != nil {
		return nil, fmt.Errorf("store: list weekly results: %w", err)
	}
	out := make([]WeeklyResult, 0, len(rows))
	for _, r := range rows {
		out = append(out, WeeklyResult{UserID: r.UserID, Points: r.Points, IsWinner: r.IsWinner})
	}
	return out, nil
}

func (s *SQLStore) UpsertWeeklyResults(ctx context.Context, ps []UpsertWeeklyResultParams) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: begin weekly tx: %w", err)
	}
	q := s.q.WithTx(tx)
	for _, p := range ps {
		if err := q.UpsertWeeklyResult(ctx, sqlc.UpsertWeeklyResultParams{
			UserID: p.UserID, WeekStart: p.WeekStart, Points: p.Points, IsWinner: p.IsWinner,
		}); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("store: upsert weekly result: %w", err)
		}
	}
	return tx.Commit()
}

func (s *SQLStore) ListWinners(ctx context.Context) ([]Winner, error) {
	rows, err := s.q.ListWinners(ctx)
	if err != nil {
		return nil, fmt.Errorf("store: list winners: %w", err)
	}
	out := make([]Winner, 0, len(rows))
	for _, r := range rows {
		w := Winner{
			WeekStart: r.WeekStart,
			UserID:    r.UserID,
			Name:      r.Name,
			AvatarURL: r.AvatarUrl,
			Points:    int64(r.Points),
			PrizePaid: r.PrizePaid,
		}
		if r.PaidAt.Valid {
			t := r.PaidAt.Time
			w.PaidAt = &t
		}
		out = append(out, w)
	}
	return out, nil
}

func (s *SQLStore) MarkWinnerPaid(ctx context.Context, weekStart time.Time, userID int64, paid bool, paidAt *time.Time) (bool, error) {
	var nt sql.NullTime
	if paidAt != nil {
		nt = sql.NullTime{Time: *paidAt, Valid: true}
	}
	n, err := s.q.MarkWinnerPaid(ctx, sqlc.MarkWinnerPaidParams{
		PrizePaid: paid,
		PaidAt:    nt,
		WeekStart: weekStart,
		UserID:    userID,
	})
	if err != nil {
		return false, fmt.Errorf("store: mark winner paid: %w", err)
	}
	return n > 0, nil
}
