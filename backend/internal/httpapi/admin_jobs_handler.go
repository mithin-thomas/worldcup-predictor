package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

type runJobRequest struct {
	Job string `json:"job"`
}

// PostRunJob is the debug-only manual job trigger (registered only when debug).
// Admin-gated. Supports "results-ingest" and "weekly-winner".
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
	default:
		writeError(w, http.StatusBadRequest, "unknown job")
	}
}
