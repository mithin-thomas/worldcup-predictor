package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"golang.org/x/time/rate"
)

func TestKeyedLimiter_AllowsThenBlocks(t *testing.T) {
	kl := newKeyedLimiter(rate.Limit(0.0001), 2) // ~never refills; burst 2
	if !kl.Allow("a") || !kl.Allow("a") {
		t.Fatal("first 2 within burst should pass")
	}
	if kl.Allow("a") {
		t.Fatal("3rd should be blocked")
	}
	if !kl.Allow("b") {
		t.Fatal("different key must be isolated")
	}
}

func TestRateLimitIP_429WithRetryAfter(t *testing.T) {
	kl := newKeyedLimiter(rate.Limit(0.0001), 1)
	h := rateLimitIP(kl)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	call := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/auth/google", nil)
		req.RemoteAddr = "1.2.3.4:5555"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	if call().Code != 200 {
		t.Fatal("first should pass")
	}
	rec := call()
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("2nd should be 429, got %d", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Error("429 must set Retry-After")
	}
}

func TestRateLimitWrites_OnlyMutating_PerUser(t *testing.T) {
	kl := newKeyedLimiter(rate.Limit(0.0001), 1)
	h := rateLimitWrites(kl)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	withUser := func(method string, id int64) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/api/x", nil)
		req = ctxUser(req, id) // helper from existing tests: injects store.User{ID:id}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	// GET never limited
	for i := 0; i < 5; i++ {
		if withUser(http.MethodGet, 1).Code != 200 {
			t.Fatal("GET must never be limited")
		}
	}
	// writes limited per user
	if withUser(http.MethodPut, 1).Code != 200 {
		t.Fatal("1st write within burst")
	}
	if withUser(http.MethodPut, 1).Code != http.StatusTooManyRequests {
		t.Fatal("2nd write same user → 429")
	}
	if withUser(http.MethodPut, 2).Code != 200 {
		t.Fatal("different user isolated")
	}
}
