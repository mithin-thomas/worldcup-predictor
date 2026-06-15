package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

type runJobRequest struct {
	Job string `json:"job"`
}

// PostRunJob is the admin-only manual job trigger, registered in all environments.
// Admin-gated. Supports "results-ingest", "weekly-winner", and "bonus-score".
func (d *Deps) PostRunJob(w http.ResponseWriter, r *http.Request) {
	var req runJobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	switch req.Job {
	case "results-ingest":
		if d.JobRunner == nil {
			writeError(w, http.StatusServiceUnavailable, "job runner not configured")
			return
		}
		summary, err := d.JobRunner.RunResultsIngest(r.Context())
		if err != nil {
			slog.Error("admin job failed", "job", req.Job, "err", err)
			writeError(w, http.StatusInternalServerError, "job failed")
			return
		}
		writeJSON(w, http.StatusOK, summary)
	case "weekly-winner":
		if d.JobRunner == nil {
			writeError(w, http.StatusServiceUnavailable, "job runner not configured")
			return
		}
		summary, err := d.JobRunner.RunWeeklyWinner(r.Context())
		if err != nil {
			slog.Error("admin job failed", "job", req.Job, "err", err)
			writeError(w, http.StatusInternalServerError, "job failed")
			return
		}
		writeJSON(w, http.StatusOK, summary)
	case "bonus-score":
		if d.JobRunner == nil {
			writeError(w, http.StatusServiceUnavailable, "job runner not configured")
			return
		}
		summary, err := d.JobRunner.RunBonusScore(r.Context())
		if err != nil {
			slog.Error("admin job failed", "job", req.Job, "err", err)
			writeError(w, http.StatusInternalServerError, "job failed")
			return
		}
		writeJSON(w, http.StatusOK, summary)
	default:
		writeError(w, http.StatusBadRequest, "unknown job")
	}
}
