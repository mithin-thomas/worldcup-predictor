package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/sayonetech/worldcup-predictor/backend/internal/scoring"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

// adminMatchDTO is the JSON shape returned by GET /api/admin/matches.
type adminMatchDTO struct {
	ID                  int64  `json:"id"`
	MatchNumber         int32  `json:"match_number"`
	Stage               string `json:"stage"`
	Round               string `json:"round"`
	HomeTeamID          *int64 `json:"home_team_id"`
	HomeTeam            string `json:"home_team"`
	HomeCode            string `json:"home_code"`
	AwayTeamID          *int64 `json:"away_team_id"`
	AwayTeam            string `json:"away_team"`
	AwayCode            string `json:"away_code"`
	KickoffUTC          string `json:"kickoff_utc"`
	Status              string `json:"status"`
	HomeScore           *int64 `json:"home_score,omitempty"`
	AwayScore           *int64 `json:"away_score,omitempty"`
	WentToPenalties     bool   `json:"went_to_penalties"`
	PenaltyWinnerTeamID *int64 `json:"penalty_winner_team_id,omitempty"`
	ManualOverride      bool   `json:"manual_override"`
}

// GetAdminMatches returns the full match list for admin management.
func (d *Deps) GetAdminMatches(w http.ResponseWriter, r *http.Request) {
	rows, err := d.AdminMatches.ListMatchesForAdmin(r.Context())
	if err != nil {
		slog.Error("admin list matches", "err", err)
		writeError(w, http.StatusInternalServerError, "could not load matches")
		return
	}
	dtos := make([]adminMatchDTO, 0, len(rows))
	for _, m := range rows {
		dtos = append(dtos, adminMatchDTO{
			ID:                  m.ID,
			MatchNumber:         m.MatchNumber,
			Stage:               m.Stage,
			Round:               m.Round,
			HomeTeamID:          m.HomeTeamID,
			HomeTeam:            m.HomeTeam,
			HomeCode:            m.HomeCode,
			AwayTeamID:          m.AwayTeamID,
			AwayTeam:            m.AwayTeam,
			AwayCode:            m.AwayCode,
			KickoffUTC:          m.KickoffUTC.UTC().Format(time.RFC3339),
			Status:              m.Status,
			HomeScore:           m.HomeScore,
			AwayScore:           m.AwayScore,
			WentToPenalties:     m.WentToPenalties,
			PenaltyWinnerTeamID: m.PenaltyWinnerTeamID,
			ManualOverride:      m.ManualOverride,
		})
	}
	writeJSON(w, http.StatusOK, dtos)
}

type createMatchRequest struct {
	HomeTeamID  int64  `json:"home_team_id"`
	AwayTeamID  int64  `json:"away_team_id"`
	KickoffUTC  string `json:"kickoff_utc"`
	Stage       string `json:"stage"`
	Round       string `json:"round"`
	MatchNumber int32  `json:"match_number"`
}

// PostAdminMatch creates a new fixture. Sets manual_override=1.
func (d *Deps) PostAdminMatch(w http.ResponseWriter, r *http.Request) {
	var req createMatchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	kickoff, ok := d.validateMatchInput(w, r, req.HomeTeamID, req.AwayTeamID, req.KickoffUTC, req.Stage)
	if !ok {
		return
	}
	id, err := d.AdminMatches.CreateMatch(r.Context(), store.CreateMatchParams{
		MatchNumber: req.MatchNumber,
		Stage:       req.Stage,
		Round:       req.Round,
		HomeTeamID:  req.HomeTeamID,
		AwayTeamID:  req.AwayTeamID,
		KickoffUTC:  kickoff,
	})
	if err != nil {
		slog.Error("admin create match", "err", err)
		writeError(w, http.StatusInternalServerError, "could not create match")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]int64{"id": id})
}

// PutAdminMatch edits fixture detail (not scores). Sets manual_override=1. 404 if absent.
func (d *Deps) PutAdminMatch(w http.ResponseWriter, r *http.Request) {
	id, ok := adminMatchID(w, r)
	if !ok {
		return
	}
	exists, err := d.AdminMatches.MatchExists(r.Context(), id)
	if err != nil {
		slog.Error("admin match exists", "err", err)
		writeError(w, http.StatusInternalServerError, "could not check match")
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, "match not found")
		return
	}
	var req createMatchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	kickoff, ok2 := d.validateMatchInput(w, r, req.HomeTeamID, req.AwayTeamID, req.KickoffUTC, req.Stage)
	if !ok2 {
		return
	}
	if err := d.AdminMatches.UpdateMatchDetail(r.Context(), store.UpdateMatchDetailParams{
		ID:         id,
		HomeTeamID: req.HomeTeamID,
		AwayTeamID: req.AwayTeamID,
		KickoffUTC: kickoff,
		Stage:      req.Stage,
		Round:      req.Round,
	}); err != nil {
		slog.Error("admin update match", "err", err)
		writeError(w, http.StatusInternalServerError, "could not update match")
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"id": id})
}

// DeleteAdminMatch deletes a match (predictions cascade). 404 if absent.
func (d *Deps) DeleteAdminMatch(w http.ResponseWriter, r *http.Request) {
	id, ok := adminMatchID(w, r)
	if !ok {
		return
	}
	deleted, err := d.AdminMatches.DeleteMatch(r.Context(), id)
	if err != nil {
		slog.Error("admin delete match", "err", err)
		writeError(w, http.StatusInternalServerError, "could not delete match")
		return
	}
	if !deleted {
		writeError(w, http.StatusNotFound, "match not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// matchResultRequest is the body for PUT /api/admin/matches/:id/result.
type matchResultRequest struct {
	HomeScore           int    `json:"home_score"`
	AwayScore           int    `json:"away_score"`
	WentToPenalties     bool   `json:"went_to_penalties"`
	PenaltyWinnerTeamID *int64 `json:"penalty_winner_team_id"`
}

// PutAdminMatchResult sets/corrects a match result and immediately re-scores all
// predictions in one transaction (idempotent, mirrors the M5 ingest). Sets
// manual_override=1. Preserves the existing api_fixture_id to prevent data loss.
func (d *Deps) PutAdminMatchResult(w http.ResponseWriter, r *http.Request) {
	id, ok := adminMatchID(w, r)
	if !ok {
		return
	}
	var req matchResultRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.HomeScore < 0 || req.AwayScore < 0 {
		writeError(w, http.StatusBadRequest, "scores must be non-negative")
		return
	}

	// Load the match to know stage and team IDs for validation and scoring.
	m, err := d.Results.FindMatchByID(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "match not found")
		return
	}
	if err != nil {
		slog.Error("admin result load match", "err", err)
		writeError(w, http.StatusInternalServerError, "could not load match")
		return
	}

	// Result entry is allowed once a match has kicked off (covers manual entry for a
	// played-but-not-yet-ingested match), but finalizing a future match is rejected
	// because doing so would also set manual_override and permanently lock ingest out.
	if now().Before(m.KickoffUTC) {
		writeError(w, http.StatusBadRequest, "match has not kicked off yet")
		return
	}

	knockout := m.Stage == store.StageKnockout

	if req.WentToPenalties {
		if !knockout {
			writeError(w, http.StatusBadRequest, "only knockout matches can go to penalties")
			return
		}
		if req.PenaltyWinnerTeamID == nil {
			writeError(w, http.StatusBadRequest, "penalty winner must be the home or away team")
			return
		}
		homeOK := m.HomeTeamID != nil && *req.PenaltyWinnerTeamID == *m.HomeTeamID
		awayOK := m.AwayTeamID != nil && *req.PenaltyWinnerTeamID == *m.AwayTeamID
		if !homeOK && !awayOK {
			writeError(w, http.StatusBadRequest, "penalty winner must be the home or away team")
			return
		}
	}

	txErr := d.Results.WithTx(r.Context(), func(tx store.ResultsStore) error {
		// Preserve api_fixture_id to avoid NULLing a synced match's identifier.
		if err := tx.UpdateMatchResult(r.Context(), store.UpdateMatchResultParams{
			ID:                  id,
			Status:              store.StatusFinal,
			HomeScore:           int32(req.HomeScore),
			AwayScore:           int32(req.AwayScore),
			WentToPenalties:     req.WentToPenalties,
			PenaltyWinnerTeamID: req.PenaltyWinnerTeamID,
			APIFixtureID:        m.APIFixtureID, // preserved from existing row
		}); err != nil {
			return err
		}

		preds, err := tx.ListPredictionsForMatch(r.Context(), id)
		if err != nil {
			return err
		}

		for _, p := range preds {
			sc := scoring.Compute(
				scoring.Prediction{
					Home:          int(p.HomeScore),
					Away:          int(p.AwayScore),
					PenaltyWinner: p.PenaltyWinnerTeamID,
				},
				scoring.Result{
					Final:           true,
					Knockout:        knockout,
					Home:            req.HomeScore,
					Away:            req.AwayScore,
					WentToPenalties: req.WentToPenalties,
					PenaltyWinner:   req.PenaltyWinnerTeamID,
				},
			)
			if err := tx.SetPredictionScore(r.Context(), p.ID, int32(sc.Points), int32(sc.PenaltyBonus)); err != nil {
				return err
			}
		}

		// Mark manual_override so the ingest job never overwrites this correction.
		return tx.SetMatchManualOverride(r.Context(), id)
	})
	if txErr != nil {
		slog.Error("admin result tx", "err", txErr)
		writeError(w, http.StatusInternalServerError, "could not save result")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "final"})
}

// validateMatchInput validates team existence, kickoff format, and stage.
// Returns the parsed kickoff time and true on success; writes an error and
// returns false on any validation failure.
func (d *Deps) validateMatchInput(w http.ResponseWriter, r *http.Request, home, away int64, kickoffStr, stage string) (time.Time, bool) {
	if home == away {
		writeError(w, http.StatusBadRequest, "home and away teams must differ")
		return time.Time{}, false
	}
	if stage != "group" && stage != "knockout" {
		writeError(w, http.StatusBadRequest, "stage must be group or knockout")
		return time.Time{}, false
	}
	kickoff, err := time.Parse(time.RFC3339, kickoffStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "kickoff_utc must be RFC3339")
		return time.Time{}, false
	}
	for _, id := range []int64{home, away} {
		ok, err := d.AdminMatches.TeamExists(r.Context(), id)
		if err != nil {
			slog.Error("admin team exists check", "err", err)
			writeError(w, http.StatusInternalServerError, "validation failed")
			return time.Time{}, false
		}
		if !ok {
			writeError(w, http.StatusBadRequest, "unknown team")
			return time.Time{}, false
		}
	}
	return kickoff, true
}

// adminMatchID parses the chi {id} URL param as a positive int64.
func adminMatchID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid id")
		return 0, false
	}
	return id, true
}
