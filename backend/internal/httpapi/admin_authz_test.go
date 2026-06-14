package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/sayonetech/worldcup-predictor/backend/internal/auth"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

// adminAuthzDeps wires all the admin fakes into a Deps suitable for NewRouter authz tests.
func adminAuthzDeps() (*Deps, *auth.SessionManager) {
	fs := newFakeStore()
	// seed a regular user (id=1) and an admin user (id=2)
	_, _ = fs.UpsertUser(context.Background(), store.UpsertUserParams{Email: "user@sayonetech.com"})
	adminU, _ := fs.UpsertUser(context.Background(), store.UpsertUserParams{Email: "admin@sayonetech.com", Role: store.RoleAdmin})
	_ = fs.SetUserRole(context.Background(), adminU.ID, store.RoleAdmin)
	sm := auth.NewSessionManager("test-secret")
	d := &Deps{
		Store:              fs,
		Sessions:           sm,
		AdminMatches:       &fakeAdminMatchStore{teamOK: true, createID: 1, deleted: true, matchOK: true},
		AdminUsers:         &fakeAdminUserStore{adminCount: 2, roleByID: map[int64]store.Role{1: store.RoleUser}},
		Results:            newFakeResultsStore(groupMatch(1, 1, 2), nil),
		AllowedEmailDomain: "sayonetech.com",
	}
	return d, sm
}

// sessionCookie builds a valid session cookie for the given user id.
func sessionCookie(sm *auth.SessionManager, userID int64) *http.Cookie {
	return &http.Cookie{
		Name:  sessionCookieName,
		Value: sm.Encode(auth.Session{UserID: userID}, sessionTTL),
	}
}

// TestAdminRoutes_NoSession_Returns401 verifies that all admin endpoints return
// 401 when there is no session cookie (unauthenticated access).
func TestAdminRoutes_NoSession_Returns401(t *testing.T) {
	d, _ := adminAuthzDeps()
	r := NewRouter(d, false)

	cases := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodGet, "/api/admin/matches", ""},
		{http.MethodPost, "/api/admin/matches", `{"home_team_id":1,"away_team_id":2,"kickoff_utc":"2026-06-20T18:00:00Z","stage":"group"}`},
		{http.MethodPut, "/api/admin/matches/1", `{"home_team_id":1,"away_team_id":2,"kickoff_utc":"2026-06-20T18:00:00Z","stage":"group"}`},
		{http.MethodPut, "/api/admin/matches/1/result", `{"home_score":1,"away_score":0}`},
		{http.MethodDelete, "/api/admin/matches/1", ""},
		{http.MethodGet, "/api/admin/users", ""},
		{http.MethodPost, "/api/admin/users/1/role", `{"role":"admin"}`},
		{http.MethodGet, "/api/admin/settings", ""},
		{http.MethodPut, "/api/admin/settings", `{"results_cron":"0 4 * * *"}`},
		{http.MethodPost, "/api/admin/recompute", ""},
	}

	for _, tc := range cases {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			var body *strings.Reader
			if tc.body != "" {
				body = strings.NewReader(tc.body)
			} else {
				body = strings.NewReader("")
			}
			req := httptest.NewRequest(tc.method, tc.path, body)
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != http.StatusUnauthorized {
				t.Errorf("%s %s: status = %d, want 401", tc.method, tc.path, rec.Code)
			}
		})
	}
}

// TestAdminRoutes_NonAdmin_Returns403 verifies that all admin endpoints return
// 403 when a regular (non-admin) user is authenticated.
func TestAdminRoutes_NonAdmin_Returns403(t *testing.T) {
	d, sm := adminAuthzDeps()
	r := NewRouter(d, false)
	// user id=1 is a regular user (RoleUser)
	cookie := sessionCookie(sm, 1)

	cases := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodGet, "/api/admin/matches", ""},
		{http.MethodPost, "/api/admin/matches", `{"home_team_id":1,"away_team_id":2,"kickoff_utc":"2026-06-20T18:00:00Z","stage":"group"}`},
		{http.MethodPut, "/api/admin/matches/1", `{"home_team_id":1,"away_team_id":2,"kickoff_utc":"2026-06-20T18:00:00Z","stage":"group"}`},
		{http.MethodPut, "/api/admin/matches/1/result", `{"home_score":1,"away_score":0}`},
		{http.MethodDelete, "/api/admin/matches/1", ""},
		{http.MethodGet, "/api/admin/users", ""},
		{http.MethodPost, "/api/admin/users/1/role", `{"role":"admin"}`},
		{http.MethodGet, "/api/admin/settings", ""},
		{http.MethodPut, "/api/admin/settings", `{"results_cron":"0 4 * * *"}`},
		{http.MethodPost, "/api/admin/recompute", ""},
	}

	for _, tc := range cases {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			var body *strings.Reader
			if tc.body != "" {
				body = strings.NewReader(tc.body)
			} else {
				body = strings.NewReader("")
			}
			req := httptest.NewRequest(tc.method, tc.path, body)
			req.AddCookie(cookie)
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != http.StatusForbidden {
				t.Errorf("%s %s: status = %d, want 403", tc.method, tc.path, rec.Code)
			}
		})
	}
}
