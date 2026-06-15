package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/sayonetech/worldcup-predictor/backend/internal/auth"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

type googleLoginRequest struct {
	IDToken string `json:"id_token"`
}

// PostAuthGoogle verifies a Google ID token, gates on the domain, upserts the
// user, sets the session cookie, and returns the user.
func (d *Deps) PostAuthGoogle(w http.ResponseWriter, r *http.Request) {
	var body googleLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.IDToken == "" {
		writeError(w, http.StatusBadRequest, "id_token required")
		return
	}

	claims, err := d.Verifier.Verify(r.Context(), body.IDToken)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid Google token")
		return
	}
	if err := auth.CheckDomain(claims, d.AllowedEmailDomain); err != nil {
		writeError(w, http.StatusForbidden, "sign-in restricted to "+d.AllowedEmailDomain)
		return
	}

	u, err := d.Store.UpsertUser(r.Context(), store.UpsertUserParams{
		Email:     claims.Email,
		Name:      claims.Name,
		AvatarURL: claims.Picture,
		Role:      store.RoleUser, // seed-admin promotion handled at startup (Task 6)
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not provision user")
		return
	}

	d.setSessionCookie(w, u.ID)
	writeJSON(w, http.StatusOK, d.userResponse(u))
}

// PostAuthLogout clears the session cookie.
func (d *Deps) PostAuthLogout(w http.ResponseWriter, _ *http.Request) {
	d.clearSessionCookie(w)
	writeJSON(w, http.StatusOK, map[string]string{"status": "logged out"})
}
