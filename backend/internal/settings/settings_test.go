package settings

import (
	"context"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Task 2: validator tests
// ---------------------------------------------------------------------------

func TestIsKey(t *testing.T) {
	if !IsKey(KeyResultsCron) || !IsKey(KeyWeeklyCron) || !IsKey(KeyBonusLockAt) {
		t.Fatal("known keys must be valid")
	}
	if IsKey("nope") || IsKey("") {
		t.Fatal("unknown key must be invalid")
	}
	if len(Keys) != 3 {
		t.Fatalf("Keys = %d, want 3", len(Keys))
	}
}

func TestValidate(t *testing.T) {
	good := map[string]string{
		KeyResultsCron: "0 3,8,13 * * *",
		KeyWeeklyCron:  "30 13 * * 1",
		KeyBonusLockAt: "2026-06-28T23:59:00+05:30",
	}
	for k, v := range good {
		if err := Validate(k, v); err != nil {
			t.Errorf("Validate(%s,%q) unexpected error: %v", k, v, err)
		}
	}
	bad := map[string]string{
		KeyResultsCron: "not a cron",
		KeyWeeklyCron:  "61 99 * * *",
		KeyBonusLockAt: "28-06-2026",
	}
	for k, v := range bad {
		if err := Validate(k, v); err == nil {
			t.Errorf("Validate(%s,%q) expected error", k, v)
		}
	}
	if err := Validate("unknown", "x"); err == nil {
		t.Error("unknown key must error")
	}
}

func TestValidateCron_StandardFiveField(t *testing.T) {
	cases := []struct {
		name  string
		expr  string
		valid bool
	}{
		{"simple nightly", "0 3 * * *", true},
		{"multiple hours", "0 3,8,13 * * *", true},
		{"weekly monday", "30 13 * * 1", true},
		{"empty", "", false},
		{"six fields", "0 0 3 * * *", false}, // 6-field not accepted by standard parser
		{"bad minute", "99 3 * * *", false},
		{"words", "not a cron", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateCron(tc.expr)
			if tc.valid && err != nil {
				t.Errorf("ValidateCron(%q) unexpected error: %v", tc.expr, err)
			}
			if !tc.valid && err == nil {
				t.Errorf("ValidateCron(%q) expected error, got nil", tc.expr)
			}
		})
	}
}

func TestValidateLockAt(t *testing.T) {
	cases := []struct {
		name  string
		v     string
		valid bool
	}{
		{"valid IST offset", "2026-06-28T23:59:00+05:30", true},
		{"valid UTC", "2026-06-28T18:29:00Z", true},
		{"date only", "2026-06-28", false},
		{"dd-mm-yyyy", "28-06-2026", false},
		{"empty", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateLockAt(tc.v)
			if tc.valid && err != nil {
				t.Errorf("ValidateLockAt(%q) unexpected error: %v", tc.v, err)
			}
			if !tc.valid && err == nil {
				t.Errorf("ValidateLockAt(%q) expected error, got nil", tc.v)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Task 3: Service tests
// ---------------------------------------------------------------------------

// memStore is an in-memory fake Store for unit tests (no DB needed).
type memStore struct{ m map[string]string }

func (s *memStore) GetSetting(_ context.Context, k string) (string, bool, error) {
	v, ok := s.m[k]
	return v, ok, nil
}
func (s *memStore) UpsertSetting(_ context.Context, k, v string) error {
	s.m[k] = v
	return nil
}
func (s *memStore) ListSettings(_ context.Context) (map[string]string, error) {
	// return a copy so callers can't mutate internal state
	out := make(map[string]string, len(s.m))
	for k, v := range s.m {
		out[k] = v
	}
	return out, nil
}

func TestServiceEnsureSeeded_InsertsOnlyMissingKeys(t *testing.T) {
	// bonus_lock_at is already in the DB; results_cron and weekly_cron are missing.
	st := &memStore{m: map[string]string{
		KeyBonusLockAt: "2026-06-28T23:59:00+05:30",
	}}
	svc := &Service{Store: st, Defaults: map[string]string{
		KeyResultsCron: "0 3,8,13 * * *",
		KeyWeeklyCron:  "30 13 * * 1",
		KeyBonusLockAt: "2099-01-01T00:00:00+05:30",
	}}
	if err := svc.EnsureSeeded(context.Background()); err != nil {
		t.Fatal(err)
	}
	// Missing keys should be seeded from defaults.
	if st.m[KeyResultsCron] != "0 3,8,13 * * *" {
		t.Errorf("results_cron not seeded, got %q", st.m[KeyResultsCron])
	}
	if st.m[KeyWeeklyCron] != "30 13 * * 1" {
		t.Errorf("weekly_cron not seeded, got %q", st.m[KeyWeeklyCron])
	}
	// Pre-existing value must NOT be overwritten.
	if st.m[KeyBonusLockAt] != "2026-06-28T23:59:00+05:30" {
		t.Errorf("bonus_lock_at must not be overwritten, got %q", st.m[KeyBonusLockAt])
	}
}

func TestServiceGet_ReturnsDBValue(t *testing.T) {
	st := &memStore{m: map[string]string{KeyResultsCron: "0 5 * * *"}}
	svc := &Service{Store: st, Defaults: map[string]string{KeyResultsCron: "0 3 * * *"}}
	v, err := svc.Get(context.Background(), KeyResultsCron)
	if err != nil {
		t.Fatal(err)
	}
	if v != "0 5 * * *" {
		t.Errorf("Get returned %q, want DB value", v)
	}
}

func TestServiceGet_FallsBackToDefault(t *testing.T) {
	st := &memStore{m: map[string]string{}}
	svc := &Service{Store: st, Defaults: map[string]string{KeyResultsCron: "0 3 * * *"}}
	v, err := svc.Get(context.Background(), KeyResultsCron)
	if err != nil {
		t.Fatal(err)
	}
	if v != "0 3 * * *" {
		t.Errorf("Get returned %q, want default", v)
	}
}

func TestServiceAll_ReturnsMergedMap(t *testing.T) {
	st := &memStore{m: map[string]string{KeyResultsCron: "0 5 * * *"}}
	svc := &Service{Store: st, Defaults: map[string]string{
		KeyResultsCron: "0 3 * * *",
		KeyWeeklyCron:  "30 13 * * 1",
		KeyBonusLockAt: "2026-06-28T23:59:00+05:30",
	}}
	all, err := svc.All(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 3 {
		t.Errorf("All() len = %d, want 3", len(all))
	}
	if all[KeyResultsCron] != "0 5 * * *" {
		t.Errorf("results_cron: got %q, want DB value", all[KeyResultsCron])
	}
	if all[KeyWeeklyCron] != "30 13 * * 1" {
		t.Errorf("weekly_cron: got %q, want default", all[KeyWeeklyCron])
	}
}

func TestServiceBonusLockAt_ParsesStoredValue(t *testing.T) {
	st := &memStore{m: map[string]string{KeyBonusLockAt: "2026-06-28T23:59:00+05:30"}}
	svc := &Service{Store: st, Defaults: map[string]string{}}
	got, err := svc.BonusLockAt(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	want, _ := time.Parse(time.RFC3339, "2026-06-28T23:59:00+05:30")
	if !got.Equal(want) {
		t.Errorf("BonusLockAt = %v, want %v", got, want)
	}
}

func TestServiceSetAll_ValidateAllThenWrite(t *testing.T) {
	// A bad results_cron must prevent any write (including valid weekly_cron).
	st := &memStore{m: map[string]string{
		KeyResultsCron: "0 3,8,13 * * *",
		KeyWeeklyCron:  "30 13 * * 1",
		KeyBonusLockAt: "2026-06-28T23:59:00+05:30",
	}}
	svc := &Service{Store: st, Defaults: map[string]string{}}
	err := svc.SetAll(context.Background(), map[string]string{
		KeyWeeklyCron:  "0 0 * * 1", // valid
		KeyResultsCron: "bad",       // invalid
	})
	if err == nil {
		t.Fatal("SetAll with bad cron must return error")
	}
	// The valid weekly_cron must NOT have been written.
	if st.m[KeyWeeklyCron] == "0 0 * * 1" {
		t.Error("SetAll must not write any key when one is invalid")
	}
}

func TestServiceSetAll_UnknownKeyRejected(t *testing.T) {
	st := &memStore{m: map[string]string{}}
	svc := &Service{Store: st, Defaults: map[string]string{}}
	err := svc.SetAll(context.Background(), map[string]string{"unknown_key": "v"})
	if err == nil {
		t.Error("SetAll with unknown key must error")
	}
}

func TestServiceSetAll_WritesAllOnSuccess(t *testing.T) {
	st := &memStore{m: map[string]string{}}
	svc := &Service{Store: st, Defaults: map[string]string{}}
	err := svc.SetAll(context.Background(), map[string]string{
		KeyResultsCron: "0 4 * * *",
		KeyWeeklyCron:  "0 8 * * 1",
	})
	if err != nil {
		t.Fatalf("SetAll returned unexpected error: %v", err)
	}
	if st.m[KeyResultsCron] != "0 4 * * *" {
		t.Errorf("results_cron not written, got %q", st.m[KeyResultsCron])
	}
	if st.m[KeyWeeklyCron] != "0 8 * * 1" {
		t.Errorf("weekly_cron not written, got %q", st.m[KeyWeeklyCron])
	}
}
