package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/sayonetech/worldcup-predictor/backend/internal/settings"
)

// GetAdminSettings returns all runtime-editable settings as a JSON object.
// Admin-only; errors loading the settings store yield 500.
func (d *Deps) GetAdminSettings(w http.ResponseWriter, r *http.Request) {
	all, err := d.Settings.All(r.Context())
	if err != nil {
		slog.Error("admin settings list", "err", err)
		writeError(w, http.StatusInternalServerError, "could not load settings")
		return
	}
	writeJSON(w, http.StatusOK, all)
}

// PutAdminSettings validates and persists a partial or full map of settings.
//
// 400 = validation error (unknown key, bad cron, bad timestamp) — no writes occur.
// 500 = store failure after validation passed.
func (d *Deps) PutAdminSettings(w http.ResponseWriter, r *http.Request) {
	var body map[string]string
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if len(body) == 0 {
		writeError(w, http.StatusBadRequest, "no settings provided")
		return
	}

	// Validate all keys+values in the handler before touching the store.
	// This keeps 400 (user error) vs 500 (store failure) clean.
	for k, v := range body {
		if !settings.IsKey(k) {
			writeError(w, http.StatusBadRequest, "unknown setting key: "+k)
			return
		}
		if err := settings.Validate(k, v); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}

	// Validation passed — write to store. Any error here is a store failure → 500.
	if err := d.Settings.SetAll(r.Context(), body); err != nil {
		slog.Error("admin settings set", "err", err)
		writeError(w, http.StatusInternalServerError, "could not save settings")
		return
	}

	// Return the full updated settings map.
	all, err := d.Settings.All(r.Context())
	if err != nil {
		slog.Error("admin settings reload after set", "err", err)
		writeError(w, http.StatusInternalServerError, "saved, but could not reload settings")
		return
	}
	writeJSON(w, http.StatusOK, all)
}

// PostRecompute triggers an idempotent re-derivation of all materialized points
// from stored match results. Never writes match results or weekly_results.
// Admin-only; errors → 500.
func (d *Deps) PostRecompute(w http.ResponseWriter, r *http.Request) {
	summary, err := d.Recompute.Run(r.Context())
	if err != nil {
		slog.Error("admin recompute", "err", err)
		writeError(w, http.StatusInternalServerError, "recompute failed")
		return
	}
	writeJSON(w, http.StatusOK, summary)
}
