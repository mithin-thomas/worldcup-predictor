package httpapi

import (
	"encoding/json"
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
func (d *Deps) PutBonusResults(w http.ResponseWriter, r *http.Request) {
	var req putBonusResultsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	for _, x := range req.Results {
		c := bonus.Category(x.Category)
		if !bonus.Valid(c) {
			writeError(w, http.StatusBadRequest, "unknown category: "+x.Category)
			return
		}
		ok, err := d.refExists(r, c, x.RefID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "validation failed")
			return
		}
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid ref for "+x.Category)
			return
		}
	}
	for _, x := range req.Results {
		if err := d.Bonus.UpsertBonusResult(r.Context(), x.Category, x.RefID); err != nil {
			writeError(w, http.StatusInternalServerError, "could not save outcomes")
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]int{"saved": len(req.Results)})
}
