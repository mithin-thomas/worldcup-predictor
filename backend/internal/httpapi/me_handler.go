package httpapi

import (
	"net/http"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

type meResponse struct {
	ID        int64  `json:"id"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	Role      string `json:"role"`
	// Debug is true in non-production builds; the SPA uses it to reveal
	// debug-only admin tools (e.g. the manual job-run controls).
	Debug bool `json:"debug"`
}

func (d *Deps) userResponse(u store.User) meResponse {
	return meResponse{ID: u.ID, Email: u.Email, Name: u.Name, AvatarURL: u.AvatarURL, Role: string(u.Role), Debug: d.Debug}
}

// GetMe returns the authenticated user (RequireAuth populated the context).
func (d *Deps) GetMe(w http.ResponseWriter, r *http.Request) {
	u, ok := userFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	writeJSON(w, http.StatusOK, d.userResponse(u))
}
