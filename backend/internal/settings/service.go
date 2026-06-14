package settings

import (
	"context"
	"fmt"
	"time"
)

// Store is the narrow settings-only DB surface the Service needs.
// *store.SQLStore satisfies this interface.
type Store interface {
	GetSetting(ctx context.Context, key string) (string, bool, error)
	UpsertSetting(ctx context.Context, key, value string) error
	ListSettings(ctx context.Context) (map[string]string, error)
}

// Service is the DB-backed settings provider. Defaults are the env/config
// bootstrap values used to seed missing keys on boot; the DB is the runtime truth.
type Service struct {
	Store    Store
	Defaults map[string]string
}

// EnsureSeeded inserts any missing allowlisted key from Defaults (idempotent;
// never overwrites an existing DB value).
func (s *Service) EnsureSeeded(ctx context.Context) error {
	for _, k := range Keys {
		if _, ok, err := s.Store.GetSetting(ctx, k); err != nil {
			return err
		} else if ok {
			continue
		}
		if def, ok := s.Defaults[k]; ok {
			if err := s.Store.UpsertSetting(ctx, k, def); err != nil {
				return err
			}
		}
	}
	return nil
}

// Get returns the DB value for key. If the key is not in the DB it falls back
// to the Defaults map (which is always populated after EnsureSeeded).
func (s *Service) Get(ctx context.Context, key string) (string, error) {
	v, ok, err := s.Store.GetSetting(ctx, key)
	if err != nil {
		return "", err
	}
	if !ok {
		return s.Defaults[key], nil // fallback if somehow unseeded
	}
	return v, nil
}

// All returns the current value for each of the 3 allowlisted keys, falling back
// to Defaults for any key not present in the DB.
func (s *Service) All(ctx context.Context) (map[string]string, error) {
	db, err := s.Store.ListSettings(ctx)
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(Keys))
	for _, k := range Keys {
		if v, ok := db[k]; ok {
			out[k] = v
		} else {
			out[k] = s.Defaults[k]
		}
	}
	return out, nil
}

// BonusLockAt parses the stored bonus_lock_at value and returns it as a time.Time.
func (s *Service) BonusLockAt(ctx context.Context) (time.Time, error) {
	v, err := s.Get(ctx, KeyBonusLockAt)
	if err != nil {
		return time.Time{}, err
	}
	return time.Parse(time.RFC3339, v)
}

// SetAll validates every key+value (allowlist + per-key validator) before writing
// any, then upserts each. A single invalid entry rejects the entire batch.
func (s *Service) SetAll(ctx context.Context, kv map[string]string) error {
	// Phase 1: validate all — if any fail, write nothing.
	for k, v := range kv {
		if !IsKey(k) {
			return fmt.Errorf("unknown setting key: %s", k)
		}
		if err := Validate(k, v); err != nil {
			return err
		}
	}
	// Phase 2: write all (validation passed).
	for k, v := range kv {
		if err := s.Store.UpsertSetting(ctx, k, v); err != nil {
			return err
		}
	}
	return nil
}
