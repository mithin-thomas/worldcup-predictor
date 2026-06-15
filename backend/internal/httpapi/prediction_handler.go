package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

const maxScore = 99

type predictionRequest struct {
	HomeScore           *int32 `json:"home_score"`
	AwayScore           *int32 `json:"away_score"`
	PenaltyWinnerTeamID *int64 `json:"penalty_winner_team_id"`
}

type predictionDTO struct {
	HomeScore           int32  `json:"home_score"`
	AwayScore           int32  `json:"away_score"`
	PenaltyWinnerTeamID *int64 `json:"penalty_winner_team_id"`
	// Points/PenaltyBonus are nil until the match is scored FINAL.
	Points       *int32 `json:"points"`
	PenaltyBonus *int32 `json:"penalty_bonus"`
}

// PutPrediction creates or updates the caller's prediction for a match.
// The server is authoritative for the kickoff lock and all validation.
func (d *Deps) PutPrediction(w http.ResponseWriter, r *http.Request) {
	u, ok := userFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid match id")
		return
	}

	var req predictionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	m, err := d.Matches.GetMatchByID(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "match not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load match")
		return
	}

	// Server-authoritative kickoff lock: reject at or after kickoff.
	if !now().Before(m.KickoffUTC) {
		writeError(w, http.StatusConflict, "match is locked")
		return
	}

	// Predictions require known teams (TBD knockout placeholders are not predictable).
	if m.HomeTeamID == nil || m.AwayTeamID == nil {
		writeError(w, http.StatusUnprocessableEntity, "teams not yet decided")
		return
	}

	// Score presence + bounds.
	if req.HomeScore == nil || req.AwayScore == nil {
		writeError(w, http.StatusUnprocessableEntity, "home_score and away_score are required")
		return
	}
	if *req.HomeScore < 0 || *req.HomeScore > maxScore || *req.AwayScore < 0 || *req.AwayScore > maxScore {
		writeError(w, http.StatusUnprocessableEntity, "scores must be between 0 and 99")
		return
	}

	// Penalty winner: only on a knockout draw, and only home or away.
	if req.PenaltyWinnerTeamID != nil {
		isDraw := *req.HomeScore == *req.AwayScore
		validTeam := *req.PenaltyWinnerTeamID == *m.HomeTeamID || *req.PenaltyWinnerTeamID == *m.AwayTeamID
		if m.Stage != store.StageKnockout || !isDraw || !validTeam {
			writeError(w, http.StatusUnprocessableEntity, "penalty winner only valid on a knockout draw, and must be a participating team")
			return
		}
	}

	if err := d.Predictions.UpsertPrediction(r.Context(), store.UpsertPredictionParams{
		UserID:              u.ID,
		MatchID:             id,
		HomeScore:           *req.HomeScore,
		AwayScore:           *req.AwayScore,
		PenaltyWinnerTeamID: req.PenaltyWinnerTeamID,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "could not save prediction")
		return
	}

	writeJSON(w, http.StatusOK, predictionDTO{
		HomeScore:           *req.HomeScore,
		AwayScore:           *req.AwayScore,
		PenaltyWinnerTeamID: req.PenaltyWinnerTeamID,
	})
}
