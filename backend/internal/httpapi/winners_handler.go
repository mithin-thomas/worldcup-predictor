package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"
)

type winnerDTO struct {
	UserID    int64  `json:"user_id"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	Points    int64  `json:"points"`
	PrizePaid bool   `json:"prize_paid"`
}

type winnerWeekDTO struct {
	WeekStart string      `json:"week_start"`
	Winners   []winnerDTO `json:"winners"`
}

type winnersResponse struct {
	Weeks []winnerWeekDTO `json:"weeks"`
}

// GetWinners returns past weekly champions grouped by week, newest first.
// Visible to all authenticated users (payout status is transparent).
func (d *Deps) GetWinners(w http.ResponseWriter, r *http.Request) {
	rows, err := d.Leaderboard.ListWinners(r.Context())
	if err != nil {
		slog.Error("list winners", "err", err)
		writeError(w, http.StatusInternalServerError, "could not load winners")
		return
	}
	weeks := make([]winnerWeekDTO, 0)
	for _, row := range rows {
		key := row.WeekStart.UTC().Format("2006-01-02")
		if len(weeks) == 0 || weeks[len(weeks)-1].WeekStart != key {
			weeks = append(weeks, winnerWeekDTO{WeekStart: key, Winners: []winnerDTO{}})
		}
		cur := &weeks[len(weeks)-1]
		cur.Winners = append(cur.Winners, winnerDTO{
			UserID: row.UserID, Name: row.Name, AvatarURL: row.AvatarURL,
			Points: row.Points, PrizePaid: row.PrizePaid,
		})
	}
	writeJSON(w, http.StatusOK, winnersResponse{Weeks: weeks})
}

type markPaidRequest struct {
	WeekStart string `json:"week_start"`
	UserID    int64  `json:"user_id"`
	Paid      bool   `json:"paid"`
}

// PutWinnerPaid toggles a weekly winner's prize payout status. Admin-only
// (RequireAdmin), registered in all environments.
func (d *Deps) PutWinnerPaid(w http.ResponseWriter, r *http.Request) {
	var req markPaidRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	week, err := time.Parse("2006-01-02", req.WeekStart)
	if err != nil {
		writeError(w, http.StatusBadRequest, "week_start must be YYYY-MM-DD")
		return
	}
	if req.UserID <= 0 {
		writeError(w, http.StatusBadRequest, "user_id is required")
		return
	}
	var paidAt *time.Time
	if req.Paid {
		t := now()
		paidAt = &t
	}
	ok, err := d.Leaderboard.MarkWinnerPaid(r.Context(), week, req.UserID, req.Paid, paidAt)
	if err != nil {
		slog.Error("mark winner paid", "err", err)
		writeError(w, http.StatusInternalServerError, "could not update payout")
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "winner not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"week_start": req.WeekStart, "user_id": req.UserID, "prize_paid": req.Paid,
	})
}
