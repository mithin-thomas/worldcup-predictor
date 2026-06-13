package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDocsServesScalarUI(t *testing.T) {
	srv := NewRouter(&Deps{}, false)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/docs", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "api-reference") || !strings.Contains(body, "/openapi.yaml") {
		t.Errorf("docs HTML missing Scalar wiring: %s", body)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("Content-Type = %q, want text/html", ct)
	}
}

func TestOpenAPISpecServed(t *testing.T) {
	srv := NewRouter(&Deps{}, false)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/openapi.yaml", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "openapi: 3.1") || !strings.Contains(body, "SayScore API") {
		t.Errorf("spec body unexpected: %s", body[:min(120, len(body))])
	}
}
