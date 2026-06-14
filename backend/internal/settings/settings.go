// Package settings owns the runtime-configurable admin settings: the allowlisted
// keys, their pure validators, and (in service.go) a DB-backed Service with
// env-default seeding. No HTTP here, no I/O.
package settings

import (
	"fmt"
	"time"

	"github.com/robfig/cron/v3"
)

const (
	KeyResultsCron = "results_cron"
	KeyWeeklyCron  = "weekly_cron"
	KeyBonusLockAt = "bonus_lock_at"
)

// Keys is the canonical allowlist (and display order).
var Keys = []string{KeyResultsCron, KeyWeeklyCron, KeyBonusLockAt}

// IsKey returns true if k is an allowlisted setting key.
func IsKey(k string) bool {
	for _, kk := range Keys {
		if kk == k {
			return true
		}
	}
	return false
}

// cronParser matches the standard 5-field spec the schedulers use.
// cron.New() with no parser option uses the standard 5-field parser —
// this matches what main.go passes to c.AddFunc, so validation == what the
// scheduler accepts.
var cronParser = cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)

// ValidateCron parses v with the same 5-field parser the schedulers use.
func ValidateCron(v string) error {
	if _, err := cronParser.Parse(v); err != nil {
		return fmt.Errorf("invalid cron expression: %w", err)
	}
	return nil
}

// ValidateLockAt parses v as an RFC3339 timestamp.
func ValidateLockAt(v string) error {
	if _, err := time.Parse(time.RFC3339, v); err != nil {
		return fmt.Errorf("invalid timestamp (want RFC3339): %w", err)
	}
	return nil
}

// Validate checks an allowlisted key + its value.
func Validate(key, value string) error {
	switch key {
	case KeyResultsCron, KeyWeeklyCron:
		return ValidateCron(value)
	case KeyBonusLockAt:
		return ValidateLockAt(value)
	default:
		return fmt.Errorf("unknown setting key: %s", key)
	}
}
