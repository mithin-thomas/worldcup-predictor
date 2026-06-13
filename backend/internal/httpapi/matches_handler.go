package httpapi

import (
	"net/http"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

// ist is the display timezone (spec: store UTC, show IST).
var ist = mustLoadIST()

func mustLoadIST() *time.Location {
	loc, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		// Fallback to a fixed +05:30 zone if tzdata is unavailable.
		return time.FixedZone("IST", 5*3600+1800)
	}
	return loc
}

type matchDTO struct {
	ID         int64   `json:"id"`
	Stage      string  `json:"stage"`
	Round      string  `json:"round"`
	KickoffUTC string  `json:"kickoff_utc"`
	KickoffIST string  `json:"kickoff_ist"`
	Status     string  `json:"status"`
	Locked     bool    `json:"locked"`
	Home       teamDTO `json:"home"`
	Away       teamDTO `json:"away"`
	HomeScore  *int32  `json:"home_score"`
	AwayScore  *int32  `json:"away_score"`
}

type teamDTO struct {
	ID      int64  `json:"id"`
	Name    string `json:"name"`
	Code    string `json:"code"`
	LogoURL string `json:"logo_url"`
}

type dayDTO struct {
	Date    string     `json:"date"` // IST calendar date YYYY-MM-DD
	Matches []matchDTO `json:"matches"`
}

type matchesResponse struct {
	Days []dayDTO `json:"days"`
}

// GetMatches returns all matches grouped by IST date with server-computed lock state.
func (d *Deps) GetMatches(w http.ResponseWriter, r *http.Request) {
	rows, err := d.Matches.ListMatchesWithTeams(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load matches")
		return
	}
	writeJSON(w, http.StatusOK, matchesResponse{Days: groupByISTDate(rows, now())})
}

// groupByISTDate buckets matches (already kickoff-ordered) by their IST calendar
// date and computes locked = now >= kickoff. Pure: testable without HTTP.
func groupByISTDate(rows []store.MatchWithTeams, nowUTC time.Time) []dayDTO {
	var days []dayDTO
	idx := map[string]int{}
	for _, m := range rows {
		k := m.KickoffUTC.In(ist)
		date := k.Format("2006-01-02")
		dto := matchDTO{
			ID:         m.ID,
			Stage:      string(m.Stage),
			Round:      m.Round,
			KickoffUTC: m.KickoffUTC.UTC().Format(time.RFC3339),
			KickoffIST: k.Format(time.RFC3339),
			Status:     string(m.Status),
			Locked:     !nowUTC.Before(m.KickoffUTC), // now >= kickoff
			Home:       teamDTO{ID: m.Home.ID, Name: m.Home.Name, Code: m.Home.Code, LogoURL: m.Home.LogoURL},
			Away:       teamDTO{ID: m.Away.ID, Name: m.Away.Name, Code: m.Away.Code, LogoURL: m.Away.LogoURL},
			HomeScore:  m.HomeScore,
			AwayScore:  m.AwayScore,
		}
		if i, ok := idx[date]; ok {
			days[i].Matches = append(days[i].Matches, dto)
		} else {
			idx[date] = len(days)
			days = append(days, dayDTO{Date: date, Matches: []matchDTO{dto}})
		}
	}
	return days
}
