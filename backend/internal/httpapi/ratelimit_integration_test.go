package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/sayonetech/worldcup-predictor/backend/internal/auth"
)

// TestRouterNoFalsePositive_AuthEndpoint confirms that a single POST to
// /api/auth/google is not immediately rate-limited (no false-positive 429).
// The authBurst is 5, so a single call must never return 429.
func TestRouterNoFalsePositive_AuthEndpoint(t *testing.T) {
	d, _ := newTestDeps(fakeVerifier{err: nil})
	srv := NewRouter(d, false)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/google", strings.NewReader(`{"id_token":"x"}`))
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code == http.StatusTooManyRequests {
		t.Fatalf("single auth request must not be 429; got %d body=%s", rec.Code, rec.Body.String())
	}
}

// TestRouterNoFalsePositive_AuthedGet confirms a single authed GET /api/me is
// never rate-limited (rateLimitWrites only fires on mutating methods).
func TestRouterNoFalsePositive_AuthedGet(t *testing.T) {
	v := fakeVerifier{claims: auth.GoogleClaims{
		Email: "dev@sayonetech.com", EmailVerified: true, Name: "Dev", HostedDomain: "sayonetech.com",
	}}
	d, _ := newTestDeps(v)
	srv := NewRouter(d, false)

	// Login to get a session cookie.
	loginRec := httptest.NewRecorder()
	loginReq := httptest.NewRequest(http.MethodPost, "/api/auth/google", strings.NewReader(`{"id_token":"x"}`))
	srv.ServeHTTP(loginRec, loginReq)
	if loginRec.Code != http.StatusOK {
		t.Fatalf("login failed: %d %s", loginRec.Code, loginRec.Body.String())
	}
	cookie := loginRec.Result().Cookies()[0]

	meReq := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	meReq.AddCookie(cookie)
	meRec := httptest.NewRecorder()
	srv.ServeHTTP(meRec, meReq)

	if meRec.Code == http.StatusTooManyRequests {
		t.Fatalf("single authed GET must not be 429; got %d", meRec.Code)
	}
}
