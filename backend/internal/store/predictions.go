package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store/sqlc"
)

// ErrNotFound is returned by single-row reads when the row does not exist.
var ErrNotFound = errors.New("store: not found")

// Prediction is the caller's stored pick for a match (read model for the list).
// Points/PenaltyBonus are nil until the match is scored FINAL.
type Prediction struct {
	MatchID             int64
	HomeScore           int32
	AwayScore           int32
	PenaltyWinnerTeamID *int64
	Points              *int32
	PenaltyBonus        *int32
}

// UpsertPredictionParams is the write surface for a single prediction.
type UpsertPredictionParams struct {
	UserID              int64
	MatchID             int64
	HomeScore           int32
	AwayScore           int32
	PenaltyWinnerTeamID *int64
}

// MatchByID is the minimal match row the prediction handler needs for the
// server-authoritative lock + validation. HomeTeamID/AwayTeamID are nil for
// TBD knockout placeholders.
type MatchByID struct {
	ID         int64
	Stage      Stage
	HomeTeamID *int64
	AwayTeamID *int64
	KickoffUTC time.Time
	Status     MatchStatus
}

// MatchPredictionRow is one user's pick for a match, with their display info.
// Used to reveal others' predictions after a match locks (spec §4).
// Points/PenaltyBonus are nil until the match is scored FINAL.
type MatchPredictionRow struct {
	UserID              int64
	Name                string
	AvatarURL           string
	HomeScore           int32
	AwayScore           int32
	PenaltyWinnerTeamID *int64
	Points              *int32
	PenaltyBonus        *int32
}

// PredictionStore is the predictions write + caller-read surface.
type PredictionStore interface {
	UpsertPrediction(ctx context.Context, p UpsertPredictionParams) error
	ListPredictionsByUser(ctx context.Context, userID int64) ([]Prediction, error)
	ListMatchPredictionsWithUsers(ctx context.Context, matchID int64) ([]MatchPredictionRow, error)
}

var _ PredictionStore = (*SQLStore)(nil)

func (s *SQLStore) UpsertPrediction(ctx context.Context, p UpsertPredictionParams) error {
	if err := s.q.UpsertPrediction(ctx, sqlc.UpsertPredictionParams{
		UserID:              p.UserID,
		MatchID:             p.MatchID,
		HomeScore:           p.HomeScore,
		AwayScore:           p.AwayScore,
		PenaltyWinnerTeamID: nullI64(p.PenaltyWinnerTeamID),
	}); err != nil {
		return fmt.Errorf("store: upsert prediction: %w", err)
	}
	return nil
}

func (s *SQLStore) ListPredictionsByUser(ctx context.Context, userID int64) ([]Prediction, error) {
	rows, err := s.q.ListPredictionsByUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("store: list predictions: %w", err)
	}
	out := make([]Prediction, 0, len(rows))
	for _, r := range rows {
		out = append(out, Prediction{
			MatchID:             r.MatchID,
			HomeScore:           r.HomeScore,
			AwayScore:           r.AwayScore,
			PenaltyWinnerTeamID: ptrI64(r.PenaltyWinnerTeamID),
			Points:              ptrI32(r.Points),
			PenaltyBonus:        ptrI32(r.PenaltyBonus),
		})
	}
	return out, nil
}

func (s *SQLStore) ListMatchPredictionsWithUsers(ctx context.Context, matchID int64) ([]MatchPredictionRow, error) {
	rows, err := s.q.ListMatchPredictionsWithUsers(ctx, matchID)
	if err != nil {
		return nil, fmt.Errorf("store: list match predictions: %w", err)
	}
	out := make([]MatchPredictionRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, MatchPredictionRow{
			UserID:              r.UserID,
			Name:                r.Name,
			AvatarURL:           r.AvatarUrl,
			HomeScore:           r.HomeScore,
			AwayScore:           r.AwayScore,
			PenaltyWinnerTeamID: ptrI64(r.PenaltyWinnerTeamID),
			Points:              ptrI32(r.Points),
			PenaltyBonus:        ptrI32(r.PenaltyBonus),
		})
	}
	return out, nil
}

func (s *SQLStore) GetMatchByID(ctx context.Context, id int64) (MatchByID, error) {
	r, err := s.q.GetMatchByID(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return MatchByID{}, ErrNotFound
	}
	if err != nil {
		return MatchByID{}, fmt.Errorf("store: get match: %w", err)
	}
	return MatchByID{
		ID:         r.ID,
		Stage:      Stage(r.Stage),
		HomeTeamID: ptrI64(r.HomeTeamID),
		AwayTeamID: ptrI64(r.AwayTeamID),
		KickoffUTC: r.KickoffUtc,
		Status:     MatchStatus(r.Status),
	}, nil
}

// ptrI64 converts a nullable sqlc column to *int64.
func ptrI64(n sql.NullInt64) *int64 {
	if !n.Valid {
		return nil
	}
	v := n.Int64
	return &v
}

// ptrI32 converts a nullable sqlc column to *int32.
func ptrI32(n sql.NullInt32) *int32 {
	if !n.Valid {
		return nil
	}
	v := n.Int32
	return &v
}
