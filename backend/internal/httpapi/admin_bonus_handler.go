package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/sayonetech/worldcup-predictor/backend/internal/bonus"
)

type putBonusResultsRequest struct {
	Results []struct {
		Category string `json:"category"`
		RefID    int64  `json:"ref_id"`
	} `json:"results"`
}

// PutBonusResults sets actual award outcomes. Admin-only, all environments.
// Validates all entries before writing any (same validate-all-then-write pattern as PutBonus).
// After a successful upsert, it calls d.JobRunner.RunBonusScore to materialise bonus points
// immediately (idempotent). If scoring fails the outcomes are already persisted and the
// handler returns 500 so the admin knows to recompute.
func (d *Deps) PutBonusResults(w http.ResponseWriter, r *http.Request) {
	var req putBonusResultsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	for _, x := range req.Results {
		c := bonus.Category(x.Category)
		if !bonus.Valid(c) {
			writeError(w, http.StatusBadRequest, "invalid category")
			return
		}
		ok, err := d.refExists(r, c, x.RefID)
		if err != nil {
			slog.Error("bonus result ref validation failed", "err", err)
			writeError(w, http.StatusInternalServerError, "validation failed")
			return
		}
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid ref for category")
			return
		}
	}
	for _, x := range req.Results {
		if err := d.Bonus.UpsertBonusResult(r.Context(), x.Category, x.RefID); err != nil {
			slog.Error("could not save bonus outcomes", "err", err)
			writeError(w, http.StatusInternalServerError, "could not save outcomes")
			return
		}
	}

	// Auto-score: materialise bonus_predictions.points from the new outcomes (idempotent).
	// Outcomes are already persisted above; a scoring failure never reverts them.
	if d.JobRunner != nil {
		if _, err := d.JobRunner.RunBonusScore(r.Context()); err != nil {
			slog.Error("auto-score bonus after outcomes save", "err", err)
			writeError(w, http.StatusInternalServerError, "outcomes saved, but scoring failed — run recompute")
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]int{"saved": len(req.Results)})
}

// bonusResultDTO is the per-category row returned by GetBonusResults.
type bonusResultDTO struct {
	Category string `json:"category"`
	Points   int    `json:"points"`
	RefType  string `json:"ref_type"`
	RefID    int64  `json:"ref_id"`
	Label    string `json:"label"`
	Set      bool   `json:"set"`
}

// GetBonusResults returns all 7 award categories (canonical order) with their
// current stored outcome + resolved team/player label. Admin-only.
func (d *Deps) GetBonusResults(w http.ResponseWriter, r *http.Request) {
	stored, err := d.Bonus.ListBonusResults(r.Context())
	if err != nil {
		slog.Error("admin list bonus results", "err", err)
		writeError(w, http.StatusInternalServerError, "could not load outcomes")
		return
	}
	byCat := make(map[string]int64, len(stored))
	for _, s := range stored {
		byCat[s.Category] = s.RefID
	}
	out := make([]bonusResultDTO, 0, len(bonus.Categories))
	for _, c := range bonus.Categories {
		row := bonusResultDTO{
			Category: string(c),
			Points:   bonus.Points(c),
			RefType:  string(bonus.RefTypeOf(c)),
		}
		if refID, ok := byCat[string(c)]; ok {
			row.RefID = refID
			row.Set = true
			row.Label = d.resolveRefLabel(r, c, refID)
		}
		out = append(out, row)
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": out})
}

// resolveRefLabel returns the team/player name for a ref (empty on a stale ref or error).
func (d *Deps) resolveRefLabel(r *http.Request, c bonus.Category, refID int64) string {
	var name string
	var err error
	if bonus.RefTypeOf(c) == bonus.RefTeam {
		name, err = d.Players.TeamNameByID(r.Context(), refID)
	} else {
		name, err = d.Players.PlayerNameByID(r.Context(), refID)
	}
	if err != nil {
		slog.Error("admin bonus result label", "category", c, "ref_id", refID, "err", err)
		return ""
	}
	return name
}
