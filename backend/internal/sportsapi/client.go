// Package sportsapi is a thin football-data.org v4 client for World Cup results.
package sportsapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

// Match mirrors the football-data.org match object (only the fields we use).
type Match struct {
	ID       int64  `json:"id"`
	UtcDate  string `json:"utcDate"`
	Status   string `json:"status"`
	Stage    string `json:"stage"`
	HomeTeam Team   `json:"homeTeam"`
	AwayTeam Team   `json:"awayTeam"`
	Score    Score  `json:"score"`
}

type Team struct {
	ID int64 `json:"id"`
}

type Score struct {
	Winner   string   `json:"winner"`   // HOME_TEAM | AWAY_TEAM | DRAW
	Duration string   `json:"duration"` // REGULAR | EXTRA_TIME | PENALTY_SHOOTOUT
	FullTime FullTime `json:"fullTime"`
}

type FullTime struct {
	Home *int `json:"home"`
	Away *int `json:"away"`
}

// Client calls football-data.org v4.
type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

func New(baseURL, apiKey string) *Client {
	return &Client{baseURL: baseURL, apiKey: apiKey, http: &http.Client{Timeout: 15 * time.Second}}
}

// ListFinishedMatches returns the WC matches with status=FINISHED in [dateFrom, dateTo] (UTC dates).
func (c *Client) ListFinishedMatches(ctx context.Context, dateFrom, dateTo string) ([]Match, error) {
	q := url.Values{}
	q.Set("dateFrom", dateFrom)
	q.Set("dateTo", dateTo)
	q.Set("status", "FINISHED")
	u := c.baseURL + "/competitions/WC/matches?" + q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, fmt.Errorf("sportsapi: build request: %w", err)
	}
	req.Header.Set("X-Auth-Token", c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("sportsapi: do request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("sportsapi: unexpected status %d", resp.StatusCode)
	}

	var body struct {
		Matches []Match `json:"matches"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("sportsapi: decode: %w", err)
	}
	return body.Matches, nil
}
