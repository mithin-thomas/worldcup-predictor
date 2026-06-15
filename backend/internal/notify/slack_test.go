package notify

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestSlack_Send_PostsTextToWebhook(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var payload map[string]string
		_ = json.Unmarshal(body, &payload)
		got = payload["text"]
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	s := NewSlack(srv.URL)
	s.Send(context.Background(), "hello cron")

	if got != "hello cron" {
		t.Fatalf("webhook got text %q, want %q", got, "hello cron")
	}
}

func TestSlack_Send_NoopWhenURLEmpty(t *testing.T) {
	var called atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called.Add(1)
	}))
	defer srv.Close()

	// Empty URL → disabled → must not POST anywhere.
	s := NewSlack("")
	if s.Enabled() {
		t.Fatal("Enabled() should be false for empty webhook URL")
	}
	s.Send(context.Background(), "should not send")

	if called.Load() != 0 {
		t.Fatalf("expected no HTTP calls, got %d", called.Load())
	}
}

func TestSlack_Send_SwallowsServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	// A 5xx from Slack must not panic or propagate (best-effort notifier).
	NewSlack(srv.URL).Send(context.Background(), "x")
}
