package leaderboard

import (
	"testing"
	"time"
)

func TestISTMondayAndWeekStartKey(t *testing.T) {
	loc := LoadIST()
	// 2026-06-17 is a Wednesday IST → that week's Monday is 2026-06-15.
	wed := time.Date(2026, 6, 17, 9, 0, 0, 0, loc)
	mon := ISTMonday(loc, wed)
	if mon.Year() != 2026 || mon.Month() != 6 || mon.Day() != 15 || mon.Hour() != 0 {
		t.Fatalf("ISTMonday = %s, want 2026-06-15 00:00 IST", mon)
	}
	// window start instant (UTC) = 2026-06-14T18:30Z
	if !mon.UTC().Equal(time.Date(2026, 6, 14, 18, 30, 0, 0, time.UTC)) {
		t.Fatalf("mon.UTC() = %s, want 2026-06-14T18:30Z", mon.UTC())
	}
	// DATE key = 2026-06-15 00:00 UTC
	if !WeekStartKey(mon).Equal(time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("WeekStartKey = %s, want 2026-06-15T00:00Z", WeekStartKey(mon))
	}
	// A UTC instant near midnight maps to the right IST week (now()-style input).
	utcNow := time.Date(2026, 6, 22, 8, 0, 0, 0, time.UTC) // 13:30 IST Mon 2026-06-22
	if m2 := ISTMonday(loc, utcNow); m2.Day() != 22 {
		t.Fatalf("ISTMonday(utc) day = %d, want 22", m2.Day())
	}
}
