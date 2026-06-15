package main

import (
	"strings"
	"testing"

	"github.com/sayonetech/worldcup-predictor/backend/internal/jobs"
)

func TestJobMessage(t *testing.T) {
	tests := []struct {
		name        string
		summary     any
		wantTitle   string
		wantInDetai []string
	}{
		{
			name:        "results ingest",
			summary:     jobs.Summary{Fetched: 9, Updated: 9, Skipped: 0, PredictionsScored: 27},
			wantTitle:   "Match results sync",
			wantInDetai: []string{"9 found", "9 result(s) applied", "27 prediction(s) scored"},
		},
		{
			name:        "results ingest with skips",
			summary:     jobs.Summary{Fetched: 5, Updated: 3, Skipped: 2, PredictionsScored: 4},
			wantTitle:   "Match results sync",
			wantInDetai: []string{"2 skipped"},
		},
		{
			name:        "weekly winner",
			summary:     jobs.WeeklySummary{WeekStart: "2026-06-08", Participants: 3, Winners: 1},
			wantTitle:   "Weekly winner",
			wantInDetai: []string{"2026-06-08", "1 winner(s)", "3 participant(s)"},
		},
		{
			name:        "bonus score",
			summary:     jobs.BonusSummary{Scored: 7},
			wantTitle:   "Tournament bonus scoring",
			wantInDetai: []string{"7 pick(s) updated"},
		},
		{
			// An unhandled summary type must fall back safely and NOT serialise
			// its fields into the Slack message (no struct dump leaks).
			name:        "unknown summary type falls back safely",
			summary:     struct{ Secret string }{Secret: "leak-me"},
			wantTitle:   "Background job",
			wantInDetai: []string{"Completed"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			title, detail := jobMessage(tt.summary)
			if title != tt.wantTitle {
				t.Fatalf("title = %q, want %q", title, tt.wantTitle)
			}
			for _, want := range tt.wantInDetai {
				if !strings.Contains(detail, want) {
					t.Fatalf("detail %q missing %q", detail, want)
				}
			}
			// Detail must not be the raw Go struct dump.
			if strings.Contains(detail, "{") {
				t.Fatalf("detail looks like a raw struct: %q", detail)
			}
		})
	}
}
