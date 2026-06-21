package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"
)

type celebrationDTO struct {
	MatchID       int64     `json:"match_id"`
	TeamCode      string    `json:"team_code"`
	TeamScore     int32     `json:"team_score"`
	OpponentCode  string    `json:"opponent_code"`
	OpponentScore int32     `json:"opponent_score"`
	KickoffUTC    time.Time `json:"kickoff_utc"`
}

// GetCelebrations returns the authenticated user's unseen celebrated-team wins, newest first.
func (d *Deps) GetCelebrations(w http.ResponseWriter, r *http.Request) {
	u, ok := userFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	cels, err := d.Celebrations.ListPendingCelebrations(r.Context(), u.ID)
	if err != nil {
		slog.Error("list celebrations", "err", err)
		writeError(w, http.StatusInternalServerError, "could not load celebrations")
		return
	}
	out := make([]celebrationDTO, 0, len(cels))
	for _, c := range cels {
		out = append(out, celebrationDTO(c)) // struct conversion (identical fields; json tags ignored)
	}
	writeJSON(w, http.StatusOK, map[string]any{"celebrations": out})
}

type seenRequest struct {
	MatchIDs []int64 `json:"match_ids"`
}

// PostCelebrationsSeen records that the user has seen the given matches' celebrations.
func (d *Deps) PostCelebrationsSeen(w http.ResponseWriter, r *http.Request) {
	u, ok := userFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var req seenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if len(req.MatchIDs) == 0 {
		writeError(w, http.StatusBadRequest, "match_ids required")
		return
	}
	if err := d.Celebrations.MarkCelebrationsSeen(r.Context(), u.ID, req.MatchIDs); err != nil {
		slog.Error("mark celebrations seen", "err", err)
		writeError(w, http.StatusInternalServerError, "could not save")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"seen": len(req.MatchIDs)})
}
