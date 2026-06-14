// Package jobs hosts the scheduled background jobs. results_ingest pulls FINISHED
// matches from the results API and recomputes points idempotently.
package jobs

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/scoring"
	"github.com/sayonetech/worldcup-predictor/backend/internal/sportsapi"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

// Fetcher is the slice of the football-data client the job needs (for fakes).
type Fetcher interface {
	ListFinishedMatches(ctx context.Context, dateFrom, dateTo string) ([]sportsapi.Match, error)
}

// ResultsIngest fetches finished matches, aligns them to seeded matches, updates
// results, and recomputes affected predictions' points.
type ResultsIngest struct {
	API   Fetcher
	Store store.ResultsStore
	Now   func() time.Time
	Alias map[int64]string // football-data team id -> FIFA code
}

// Summary is a run report (logged).
type Summary struct {
	Fetched           int
	Updated           int
	Skipped           int
	PredictionsScored int
}

// Run executes one ingest pass. API errors abort the run (the next cron retries);
// per-match alignment failures and manual_override matches are skipped, not fatal.
func (j ResultsIngest) Run(ctx context.Context) (Summary, error) {
	now := j.Now().UTC()
	from := now.AddDate(0, 0, -2).Format("2006-01-02")
	to := now.Format("2006-01-02")

	matches, err := j.API.ListFinishedMatches(ctx, from, to)
	if err != nil {
		return Summary{}, fmt.Errorf("jobs: list finished: %w", err)
	}
	teamsByCode, err := j.Store.ListTeamsByCode(ctx)
	if err != nil {
		return Summary{}, fmt.Errorf("jobs: teams by code: %w", err)
	}

	sum := Summary{Fetched: len(matches)}
	for _, m := range matches {
		res, ok := sportsapi.ToResult(m)
		if !ok {
			continue
		}
		homeID, ok1 := j.resolveTeam(m.HomeTeam.ID, teamsByCode)
		awayID, ok2 := j.resolveTeam(m.AwayTeam.ID, teamsByCode)
		if !ok1 || !ok2 {
			slog.Warn("ingest: unaligned teams", "fd_match", m.ID)
			sum.Skipped++
			continue
		}
		seeded, err := j.findSeeded(ctx, m.ID, m.UtcDate, homeID, awayID)
		if errors.Is(err, store.ErrNotFound) {
			slog.Warn("ingest: no seeded match", "fd_match", m.ID)
			sum.Skipped++
			continue
		}
		if err != nil {
			return sum, fmt.Errorf("jobs: find seeded: %w", err)
		}
		if seeded.ManualOverride {
			sum.Skipped++
			continue
		}

		penWinner := penaltyWinnerID(res, homeID, awayID)
		apiID := m.ID
		scored := 0
		if err := j.Store.WithTx(ctx, func(tx store.ResultsStore) error {
			if err := tx.UpdateMatchResult(ctx, store.UpdateMatchResultParams{
				ID: seeded.ID, Status: store.StatusFinal,
				HomeScore: int32(res.Home), AwayScore: int32(res.Away),
				WentToPenalties: res.WentToPenalties, PenaltyWinnerTeamID: penWinner, APIFixtureID: &apiID,
			}); err != nil {
				return err
			}
			preds, err := tx.ListPredictionsForMatch(ctx, seeded.ID)
			if err != nil {
				return err
			}
			for _, p := range preds {
				sc := scoring.Compute(
					scoring.Prediction{Home: int(p.HomeScore), Away: int(p.AwayScore), PenaltyWinner: p.PenaltyWinnerTeamID},
					scoring.Result{Final: true, Knockout: res.Knockout, Home: res.Home, Away: res.Away,
						WentToPenalties: res.WentToPenalties, PenaltyWinner: penWinner},
				)
				if err := tx.SetPredictionScore(ctx, p.ID, int32(sc.Points), int32(sc.PenaltyBonus)); err != nil {
					return err
				}
				scored++
			}
			return nil
		}); err != nil {
			return sum, fmt.Errorf("jobs: tx for match %d: %w", seeded.ID, err)
		}
		sum.Updated++
		sum.PredictionsScored += scored
	}
	slog.Info("results-ingest complete", "fetched", sum.Fetched, "updated", sum.Updated, "skipped", sum.Skipped, "scored", sum.PredictionsScored)
	return sum, nil
}

func (j ResultsIngest) resolveTeam(fdTeamID int64, byCode map[string]int64) (int64, bool) {
	code, ok := j.Alias[fdTeamID]
	if !ok {
		return 0, false
	}
	id, ok := byCode[code]
	return id, ok
}

func (j ResultsIngest) findSeeded(ctx context.Context, fdMatchID int64, utcDate string, homeID, awayID int64) (store.MatchForResult, error) {
	if m, err := j.Store.FindMatchByAPIFixtureID(ctx, fdMatchID); err == nil {
		return m, nil
	} else if !errors.Is(err, store.ErrNotFound) {
		return store.MatchForResult{}, err
	}
	kickoff, err := time.Parse(time.RFC3339, utcDate)
	if err != nil {
		return store.MatchForResult{}, store.ErrNotFound
	}
	return j.Store.FindMatchByKickoffAndTeams(ctx, kickoff.UTC(), homeID, awayID)
}

// penaltyWinnerID resolves the shootout winner to a concrete seeded team id, or nil.
func penaltyWinnerID(res sportsapi.Result, homeID, awayID int64) *int64 {
	if !res.WentToPenalties {
		return nil
	}
	switch res.WinnerSide {
	case "HOME_TEAM":
		return &homeID
	case "AWAY_TEAM":
		return &awayID
	default:
		return nil
	}
}
