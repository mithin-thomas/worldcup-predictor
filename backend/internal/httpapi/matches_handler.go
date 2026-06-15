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

type teamDTO struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Code string `json:"code"`
}

type venueDTO struct {
	Name    string `json:"name"`
	City    string `json:"city"`
	Country string `json:"country"`
}

type matchDTO struct {
	ID          int64     `json:"id"`
	MatchNumber int32     `json:"match_number"`
	Stage       string    `json:"stage"`
	Round       string    `json:"round"`
	Group       string    `json:"group"` // letter, or "" for knockout
	Label       string    `json:"label"` // e.g. "Group A" or "W73 vs W75"
	KickoffUTC  string    `json:"kickoff_utc"`
	KickoffIST  string    `json:"kickoff_ist"`
	Status      string    `json:"status"`
	Locked      bool      `json:"locked"`
	Home        *teamDTO  `json:"home"` // null for placeholder
	Away        *teamDTO  `json:"away"`
	Venue       *venueDTO `json:"venue"`
	HomeScore   *int32    `json:"home_score"`
	AwayScore   *int32    `json:"away_score"`

	Prediction *predictionDTO `json:"prediction"`
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
	u, ok := userFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	preds, err := d.Predictions.ListPredictionsByUser(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load predictions")
		return
	}
	byMatch := make(map[int64]predictionDTO, len(preds))
	for _, p := range preds {
		byMatch[p.MatchID] = predictionDTO{HomeScore: p.HomeScore, AwayScore: p.AwayScore, PenaltyWinnerTeamID: p.PenaltyWinnerTeamID, Points: p.Points, PenaltyBonus: p.PenaltyBonus}
	}
	writeJSON(w, http.StatusOK, matchesResponse{Days: groupByISTDate(rows, now(), byMatch)})
}

func teamDTOf(t *store.TeamRef) *teamDTO {
	if t == nil {
		return nil
	}
	return &teamDTO{ID: t.ID, Name: t.Name, Code: t.Code}
}

// groupByISTDate buckets matches (kickoff-ordered) by their IST calendar date
// and computes locked = now >= kickoff. Pure: testable without HTTP.
func groupByISTDate(rows []store.MatchWithTeams, nowUTC time.Time, preds map[int64]predictionDTO) []dayDTO {
	var days []dayDTO
	idx := map[string]int{}
	for _, m := range rows {
		k := m.KickoffUTC.In(ist)
		date := k.Format("2006-01-02")
		var venue *venueDTO
		if m.Venue != nil {
			venue = &venueDTO{Name: m.Venue.Name, City: m.Venue.City, Country: m.Venue.Country}
		}
		dto := matchDTO{
			ID: m.ID, MatchNumber: m.MatchNumber, Stage: string(m.Stage), Round: m.Round,
			Group: m.GroupLetter, Label: m.MatchLabel,
			KickoffUTC: m.KickoffUTC.UTC().Format(time.RFC3339),
			KickoffIST: k.Format(time.RFC3339),
			Status:     string(m.Status), Locked: !nowUTC.Before(m.KickoffUTC),
			Home: teamDTOf(m.Home), Away: teamDTOf(m.Away), Venue: venue,
			HomeScore: m.HomeScore, AwayScore: m.AwayScore,
		}
		if p, ok := preds[m.ID]; ok {
			pc := p
			dto.Prediction = &pc
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
