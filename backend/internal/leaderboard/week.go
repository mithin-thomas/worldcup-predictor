package leaderboard

import "time"

// LoadIST returns the Asia/Kolkata location, falling back to a fixed +05:30 zone
// if tzdata is unavailable.
func LoadIST() *time.Location {
	loc, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		return time.FixedZone("IST", 5*3600+1800)
	}
	return loc
}

// ISTMonday returns the 00:00 (in loc) Monday of the IST week containing t.
func ISTMonday(loc *time.Location, t time.Time) time.Time {
	lt := t.In(loc)
	y, m, d := lt.Date()
	day := time.Date(y, m, d, 0, 0, 0, 0, loc)
	offset := (int(day.Weekday()) + 6) % 7 // Monday=0
	return day.AddDate(0, 0, -offset)
}

// WeekStartKey is the IST-Monday calendar date as a midnight-UTC time — the
// weekly_results.week_start DATE key. Distinct from istMon.UTC() (the prior UTC
// day at 18:30) so DB reads match writes.
func WeekStartKey(istMon time.Time) time.Time {
	y, m, d := istMon.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}
