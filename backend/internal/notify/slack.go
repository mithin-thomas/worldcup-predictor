// Package notify sends short operational messages to a Slack Incoming Webhook.
// It is intentionally best-effort: a missing webhook URL or a Slack outage must
// never break a cron run, so Send swallows errors (logging them) and a zero
// WebhookURL makes Send a no-op.
package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"
)

// Slack posts messages to a Slack Incoming Webhook URL.
type Slack struct {
	WebhookURL string
	HTTP       *http.Client
}

// NewSlack builds a Slack notifier with a sane HTTP timeout. Pass an empty url
// to disable notifications (Send becomes a no-op).
func NewSlack(url string) Slack {
	return Slack{WebhookURL: url, HTTP: &http.Client{Timeout: 10 * time.Second}}
}

// Enabled reports whether a webhook URL is configured.
func (s Slack) Enabled() bool { return s.WebhookURL != "" }

// Send posts text to the webhook as a Slack message. It never propagates an
// error to the caller (logs on failure) so a Slack problem can't fail a job.
func (s Slack) Send(ctx context.Context, text string) {
	if s.WebhookURL == "" {
		return
	}
	body, err := json.Marshal(map[string]string{"text": text})
	if err != nil {
		slog.Warn("slack notify: marshal", "err", err)
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.WebhookURL, bytes.NewReader(body))
	if err != nil {
		slog.Warn("slack notify: build request", "err", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	client := s.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		slog.Warn("slack notify: post", "err", err)
		return
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 300 {
		slog.Warn("slack notify: non-2xx response", "status", resp.StatusCode)
	}
}
