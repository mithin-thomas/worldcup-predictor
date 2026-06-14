package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store/sqlc"
)

// SettingsStore is the settings read/write surface (3 methods only).
type SettingsStore interface {
	GetSetting(ctx context.Context, key string) (string, bool, error)
	UpsertSetting(ctx context.Context, key, value string) error
	ListSettings(ctx context.Context) (map[string]string, error)
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
