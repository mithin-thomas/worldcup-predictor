package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
