package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store/sqlc"
)

// MatchForResult is the match row the ingest needs to align + guard a result write.
type MatchForResult struct {
	ID             int64
	Stage          Stage
	HomeTeamID     *int64
	AwayTeamID     *int64
	KickoffUTC     time.Time
	Status         MatchStatus
	ManualOverride bool
	APIFixtureID   *int64
}

// UpdateMatchResultParams writes a settled result + stamps the API fixture id.
type UpdateMatchResultParams struct {
	ID                  int64
	Status              MatchStatus
	HomeScore           int32
	AwayScore           int32
	WentToPenalties     bool
	PenaltyWinnerTeamID *int64
	APIFixtureID        *int64
}

// PredictionToScore is one prediction the ingest will recompute.
type PredictionToScore struct {
	ID                  int64
	HomeScore           int32
	AwayScore           int32
	PenaltyWinnerTeamID *int64
}

// ResultsStore is the results-ingest read/write surface. WithTx runs the closure
// against a transaction-bound store (commit on nil error, else rollback).
type ResultsStore interface {
	FindMatchByAPIFixtureID(ctx context.Context, apiFixtureID int64) (MatchForResult, error)
	FindMatchByKickoffAndTeams(ctx context.Context, kickoffUTC time.Time, homeID, awayID int64) (MatchForResult, error)
	FindMatchByID(ctx context.Context, id int64) (MatchForResult, error)
	ListTeamsByCode(ctx context.Context) (map[string]int64, error)
	UpdateMatchResult(ctx context.Context, p UpdateMatchResultParams) error
	ListPredictionsForMatch(ctx context.Context, matchID int64) ([]PredictionToScore, error)
	SetPredictionScore(ctx context.Context, predictionID int64, points, penaltyBonus int32) error
	SetMatchManualOverride(ctx context.Context, id int64) error
	WithTx(ctx context.Context, fn func(ResultsStore) error) error
}

var _ ResultsStore = (*SQLStore)(nil)

func matchForResult(id int64, stage sqlc.MatchesStage, home, away sql.NullInt64,
	kickoff time.Time, status sqlc.MatchesStatus, override bool, apiID sql.NullInt64) MatchForResult {
	return MatchForResult{
		ID: id, Stage: Stage(stage), HomeTeamID: ptrI64(home), AwayTeamID: ptrI64(away),
		KickoffUTC: kickoff, Status: MatchStatus(status), ManualOverride: override, APIFixtureID: ptrI64(apiID),
	}
}

func (s *SQLStore) FindMatchByAPIFixtureID(ctx context.Context, apiFixtureID int64) (MatchForResult, error) {
	r, err := s.q.FindMatchByAPIFixtureID(ctx, sql.NullInt64{Int64: apiFixtureID, Valid: true})
	if errors.Is(err, sql.ErrNoRows) {
		return MatchForResult{}, ErrNotFound
	}
	if err != nil {
		return MatchForResult{}, fmt.Errorf("store: find match by api id: %w", err)
	}
	return matchForResult(r.ID, r.Stage, r.HomeTeamID, r.AwayTeamID, r.KickoffUtc, r.Status, r.ManualOverride, r.ApiFixtureID), nil
}

func (s *SQLStore) FindMatchByID(ctx context.Context, id int64) (MatchForResult, error) {
	r, err := s.q.GetMatchByID(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return MatchForResult{}, ErrNotFound
	}
	if err != nil {
		return MatchForResult{}, fmt.Errorf("store: find match by id: %w", err)
	}
	// GetMatchByID does not select manual_override or api_fixture_id; those are
	// not needed by the admin result-correction path (ManualOverride is set via
	// SetMatchManualOverride; APIFixtureID preserved as nil for admin-created rows).
	return matchForResult(r.ID, r.Stage, r.HomeTeamID, r.AwayTeamID, r.KickoffUtc, r.Status, false, sql.NullInt64{}), nil
}

func (s *SQLStore) FindMatchByKickoffAndTeams(ctx context.Context, kickoffUTC time.Time, homeID, awayID int64) (MatchForResult, error) {
	r, err := s.q.FindMatchByKickoffAndTeams(ctx, sqlc.FindMatchByKickoffAndTeamsParams{
		KickoffUtc: kickoffUTC,
		HomeTeamID: sql.NullInt64{Int64: homeID, Valid: true},
		AwayTeamID: sql.NullInt64{Int64: awayID, Valid: true},
	})
	if errors.Is(err, sql.ErrNoRows) {
		return MatchForResult{}, ErrNotFound
	}
	if err != nil {
		return MatchForResult{}, fmt.Errorf("store: find match by kickoff/teams: %w", err)
	}
	return matchForResult(r.ID, r.Stage, r.HomeTeamID, r.AwayTeamID, r.KickoffUtc, r.Status, r.ManualOverride, r.ApiFixtureID), nil
}

func (s *SQLStore) ListTeamsByCode(ctx context.Context) (map[string]int64, error) {
	rows, err := s.q.ListTeamsByCode(ctx)
	if err != nil {
		return nil, fmt.Errorf("store: list teams by code: %w", err)
	}
	out := make(map[string]int64, len(rows))
	for _, r := range rows {
		out[r.Code] = r.ID
	}
	return out, nil
}

func (s *SQLStore) UpdateMatchResult(ctx context.Context, p UpdateMatchResultParams) error {
	if err := s.q.UpdateMatchResult(ctx, sqlc.UpdateMatchResultParams{
		Status:              sqlc.MatchesStatus(p.Status),
		HomeScore:           sql.NullInt32{Int32: p.HomeScore, Valid: true},
		AwayScore:           sql.NullInt32{Int32: p.AwayScore, Valid: true},
		WentToPenalties:     p.WentToPenalties,
		PenaltyWinnerTeamID: nullI64(p.PenaltyWinnerTeamID),
		ApiFixtureID:        nullI64(p.APIFixtureID),
		ID:                  p.ID,
	}); err != nil {
		return fmt.Errorf("store: update match result: %w", err)
	}
	return nil
}

func (s *SQLStore) ListPredictionsForMatch(ctx context.Context, matchID int64) ([]PredictionToScore, error) {
	rows, err := s.q.ListPredictionsForMatch(ctx, matchID)
	if err != nil {
		return nil, fmt.Errorf("store: list predictions for match: %w", err)
	}
	out := make([]PredictionToScore, 0, len(rows))
	for _, r := range rows {
		out = append(out, PredictionToScore{
			ID: r.ID, HomeScore: r.HomeScore, AwayScore: r.AwayScore,
			PenaltyWinnerTeamID: ptrI64(r.PenaltyWinnerTeamID),
		})
	}
	return out, nil
}

func (s *SQLStore) SetPredictionScore(ctx context.Context, predictionID int64, points, penaltyBonus int32) error {
	if err := s.q.SetPredictionScore(ctx, sqlc.SetPredictionScoreParams{
		Points:       sql.NullInt32{Int32: points, Valid: true},
		PenaltyBonus: sql.NullInt32{Int32: penaltyBonus, Valid: true},
		ID:           predictionID,
	}); err != nil {
		return fmt.Errorf("store: set prediction score: %w", err)
	}
	return nil
}

func (s *SQLStore) SetMatchManualOverride(ctx context.Context, id int64) error {
	if err := s.q.SetMatchManualOverride(ctx, id); err != nil {
		return fmt.Errorf("store: set match manual override: %w", err)
	}
	return nil
}

// WithTx runs fn against a transaction-bound store; commits on success, else rolls back.
func (s *SQLStore) WithTx(ctx context.Context, fn func(ResultsStore) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: begin tx: %w", err)
	}
	txStore := &SQLStore{db: s.db, q: s.q.WithTx(tx)}
	if err := fn(txStore); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}
