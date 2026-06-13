package sportsapi

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// Client fetches teams and fixtures. Callers depend on this interface so the
// syncer can be tested with a fake.
type Client interface {
	FetchTeams(ctx context.Context) ([]Team, error)
	FetchFixtures(ctx context.Context) ([]Fixture, error)
}

// HTTPClient talks to API-Football (api-sports.io), league 1, season 2026.
type HTTPClient struct {
	BaseURL string
	APIKey  string
	League  string
	Season  string
	HTTP    *http.Client
}

func NewHTTPClient(baseURL, apiKey string) *HTTPClient {
	return &HTTPClient{
		BaseURL: baseURL, APIKey: apiKey, League: "1", Season: "2026",
		HTTP: &http.Client{Timeout: 20 * time.Second},
	}
}

func (c *HTTPClient) FetchTeams(ctx context.Context) ([]Team, error) {
	b, err := c.get(ctx, "/teams")
	if err != nil {
		return nil, err
	}
	return parseTeams(b)
}

func (c *HTTPClient) FetchFixtures(ctx context.Context) ([]Fixture, error) {
	b, err := c.get(ctx, "/fixtures")
	if err != nil {
		return nil, err
	}
	return parseFixtures(b)
}

func (c *HTTPClient) get(ctx context.Context, path string) ([]byte, error) {
	u := fmt.Sprintf("%s%s?league=%s&season=%s",
		c.BaseURL, path, url.QueryEscape(c.League), url.QueryEscape(c.Season))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-apisports-key", c.APIKey)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("sportsapi: GET %s: %w", path, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("sportsapi: read %s: %w", path, err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("sportsapi: GET %s status %d: %s", path, resp.StatusCode, truncate(body))
	}
	return body, nil
}

func truncate(b []byte) string {
	const max = 200
	if len(b) > max {
		return string(b[:max])
	}
	return string(b)
}

// Compile-time guard.
var _ Client = (*HTTPClient)(nil)
