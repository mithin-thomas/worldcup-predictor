package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store/sqlc"
)

// FinalMatch holds the scoreline fields needed by the recompute job for every
// match that has status='final'. Scores are non-null in practice on FINAL rows;
// the columns are nullable in the schema, so NULL is treated as 0.
type FinalMatch struct {
	ID                  int64
	Stage               Stage
	HomeTeamID          *int64
	AwayTeamID          *int64
	HomeScore           int32
	AwayScore           int32
	WentToPenalties     bool
	PenaltyWinnerTeamID *int64
}

// SettingsStore is the settings read/write surface.
type SettingsStore interface {
	GetSetting(ctx context.Context, key string) (string, bool, error)
	UpsertSetting(ctx context.Context, key, value string) error
	ListSettings(ctx context.Context) (map[string]string, error)
	ListFinalMatches(ctx context.Context) ([]FinalMatch, error)
}

var _ SettingsStore = (*SQLStore)(nil)

// GetSetting returns the value for key. If the row does not exist it returns
// ("", false, nil). Any other error is wrapped.
func (s *SQLStore) GetSetting(ctx context.Context, key string) (string, bool, error) {
	v, err := s.q.GetSetting(ctx, key)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("store: get setting %q: %w", key, err)
	}
	return v, true, nil
}

// UpsertSetting inserts or updates the value for key.
func (s *SQLStore) UpsertSetting(ctx context.Context, key, value string) error {
	if err := s.q.UpsertSetting(ctx, sqlc.UpsertSettingParams{Key: key, Value: value}); err != nil {
		return fmt.Errorf("store: upsert setting %q: %w", key, err)
	}
	return nil
}

// ListSettings returns all settings rows as a map[key]value.
func (s *SQLStore) ListSettings(ctx context.Context) (map[string]string, error) {
	rows, err := s.q.ListSettings(ctx)
	if err != nil {
		return nil, fmt.Errorf("store: list settings: %w", err)
	}
	out := make(map[string]string, len(rows))
	for _, r := range rows {
		out[r.Key] = r.Value
	}
	return out, nil
}

// ListFinalMatches returns every match with status='final' with its scoreline.
// Nullable score columns are mapped to 0 when NULL (FINAL matches always have
// scores; absent values are treated as 0 to keep the recompute safe).
func (s *SQLStore) ListFinalMatches(ctx context.Context) ([]FinalMatch, error) {
	rows, err := s.q.ListFinalMatches(ctx)
	if err != nil {
		return nil, fmt.Errorf("store: list final matches: %w", err)
	}
	out := make([]FinalMatch, 0, len(rows))
	for _, r := range rows {
		var homeScore, awayScore int32
		if r.HomeScore.Valid {
			homeScore = r.HomeScore.Int32
		}
		if r.AwayScore.Valid {
			awayScore = r.AwayScore.Int32
		}
		out = append(out, FinalMatch{
			ID:                  r.ID,
			Stage:               Stage(r.Stage),
			HomeTeamID:          ptrI64(r.HomeTeamID),
			AwayTeamID:          ptrI64(r.AwayTeamID),
			HomeScore:           homeScore,
			AwayScore:           awayScore,
			WentToPenalties:     r.WentToPenalties,
			PenaltyWinnerTeamID: ptrI64(r.PenaltyWinnerTeamID),
		})
	}
	return out, nil
}
