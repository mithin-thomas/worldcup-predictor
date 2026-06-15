package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

type adminUserDTO struct {
	ID              int64  `json:"id"`
	Email           string `json:"email"`
	Name            string `json:"name"`
	AvatarURL       string `json:"avatar_url"`
	Role            string `json:"role"`
	PredictionCount int64  `json:"prediction_count"`
	TotalPoints     int64  `json:"total_points"`
}

// GetAdminUsers returns the full user list for admin management.
func (d *Deps) GetAdminUsers(w http.ResponseWriter, r *http.Request) {
	users, err := d.AdminUsers.ListUsers(r.Context())
	if err != nil {
		slog.Error("admin list users", "err", err)
		writeError(w, http.StatusInternalServerError, "could not load users")
		return
	}
	dtos := make([]adminUserDTO, 0, len(users))
	for _, u := range users {
		dtos = append(dtos, adminUserDTO{
			ID:              u.ID,
			Email:           u.Email,
			Name:            u.Name,
			AvatarURL:       u.AvatarURL,
			Role:            string(u.Role),
			PredictionCount: u.PredictionCount,
			TotalPoints:     u.TotalPoints,
		})
	}
	writeJSON(w, http.StatusOK, dtos)
}

type setRoleRequest struct {
	Role string `json:"role"`
}

// PostUserRole promotes or demotes a user. Guards: cannot demote self; cannot
// demote the last admin; unknown user → 404; bad role → 400.
func (d *Deps) PostUserRole(w http.ResponseWriter, r *http.Request) {
	targetID, ok := adminMatchID(w, r) // reuses the :id parser
	if !ok {
		return
	}
	var req setRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	role := store.Role(req.Role)
	if role != store.RoleAdmin && role != store.RoleUser {
		writeError(w, http.StatusBadRequest, "role must be admin or user")
		return
	}

	caller, _ := userFromContext(r.Context())
	if targetID == caller.ID {
		writeError(w, http.StatusBadRequest, "cannot change your own role")
		return
	}

	current, err := d.AdminUsers.GetUserRole(r.Context(), targetID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	if err != nil {
		slog.Error("admin get user role", "err", err)
		writeError(w, http.StatusInternalServerError, "could not get user role")
		return
	}

	// Prevent demoting the last remaining admin.
	if current == store.RoleAdmin && role == store.RoleUser {
		n, err := d.AdminUsers.CountAdmins(r.Context())
		if err != nil {
			slog.Error("admin count admins", "err", err)
			writeError(w, http.StatusInternalServerError, "could not count admins")
			return
		}
		if n <= 1 {
			writeError(w, http.StatusBadRequest, "cannot remove the last admin")
			return
		}
	}

	if err := d.AdminUsers.SetUserRole(r.Context(), targetID, role); err != nil {
		slog.Error("admin set user role", "err", err)
		writeError(w, http.StatusInternalServerError, "could not update role")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": targetID, "role": role})
}
