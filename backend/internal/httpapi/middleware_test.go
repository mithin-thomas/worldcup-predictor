package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/auth"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

func TestMaxBodyBytes_OversizeRejected(t *testing.T) {
	const cap = 16 // tiny cap for the test
	var decoded bool
	h := maxBodyBytes(cap)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var v map[string]any
		if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		decoded = true
		w.WriteHeader(200)
	}))
	big := strings.NewReader(`{"x":"` + strings.Repeat("a", 100) + `"}`)
	req := httptest.NewRequest(http.MethodPut, "/api/x", big)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("oversize body should 400, got %d", rec.Code)
	}
	if decoded {
		t.Error("decode must not succeed on an oversize body")
	}
}

// hasSessionCookie reports whether the recorder has a Set-Cookie for the session.
func hasSessionCookie(rec *httptest.ResponseRecorder) bool {
	for _, c := range rec.Result().Cookies() {
		if c.Name == sessionCookieName {
			return true
		}
	}
	return false
}

func TestRequireAuth_SlidingRefresh_ReissuesNearExpiry(t *testing.T) {
	sm := auth.NewSessionManager("test-secret")
	fs := newFakeStore()
	u, _ := fs.UpsertUser(context.Background(), store.UpsertUserParams{Email: "a@sayonetech.com"})
	d := &Deps{Store: fs, Sessions: sm}

	// Capture the real instant once; freeze httpapi.now to the same value so
	// the comparison uses a consistent clock independent of wall-clock drift.
	frozen := time.Now().UTC()
	old := now
	now = func() time.Time { return frozen }
	t.Cleanup(func() { now = old })

	// Token expiring in 2 days from frozen: 2d < sessionTTL(7d)-sessionRefreshThreshold(24h)=6d
	// so the sliding refresh should fire.
	stale := sm.Encode(auth.Session{UserID: u.ID}, 2*24*time.Hour)

	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: stale})
	rec := httptest.NewRecorder()
	d.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })).ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("near-expiry session should pass RequireAuth, got %d", rec.Code)
	}
	if !hasSessionCookie(rec) {
		t.Error("near-expiry session must be re-issued (Set-Cookie present for sessionCookieName)")
	}
}

func TestRequireAuth_FreshSession_NotReissued(t *testing.T) {
	sm := auth.NewSessionManager("test-secret")
	fs := newFakeStore()
	u, _ := fs.UpsertUser(context.Background(), store.UpsertUserParams{Email: "b@sayonetech.com"})
	d := &Deps{Store: fs, Sessions: sm}

	frozen := time.Now().UTC()
	old := now
	now = func() time.Time { return frozen }
	t.Cleanup(func() { now = old })

	// Token expiring in full sessionTTL (7d): 7d is NOT < 6d, so no re-issue.
	fresh := sm.Encode(auth.Session{UserID: u.ID}, sessionTTL)

	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: fresh})
	rec := httptest.NewRecorder()
	d.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })).ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("fresh session should pass RequireAuth, got %d", rec.Code)
	}
	if hasSessionCookie(rec) {
		t.Error("fresh full-TTL session must NOT be re-issued (no Set-Cookie)")
	}
}

func TestRequireAuth_ExpiredSession_Still401(t *testing.T) {
	sm := auth.NewSessionManager("test-secret")
	fs := newFakeStore()
	d := &Deps{Store: fs, Sessions: sm}

	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "invalid.token"})
	rec := httptest.NewRecorder()
	d.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("invalid/expired session should be 401, got %d", rec.Code)
	}
}

func TestMaxBodyBytes_NormalBodyPasses(t *testing.T) {
	const cap int64 = 1 << 20 // 1 MiB
	var decoded bool
	h := maxBodyBytes(cap)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var v map[string]any
		if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		decoded = true
		w.WriteHeader(200)
	}))
	req := httptest.NewRequest(http.MethodPost, "/api/x", strings.NewReader(`{"key":"value"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("normal body should pass, got %d", rec.Code)
	}
	if !decoded {
		t.Error("normal body must decode successfully")
	}
}
