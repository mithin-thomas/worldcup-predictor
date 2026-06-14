package jobs

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/sayonetech/worldcup-predictor/backend/internal/scoring"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

// RecomputeStore is the read/re-score surface recompute needs.
// By construction it exposes no method to write match results or
// weekly_results — so the job structurally cannot touch those tables.
type RecomputeStore interface {
	ListFinalMatches(ctx context.Context) ([]store.FinalMatch, error)
	ListPredictionsForMatch(ctx context.Context, matchID int64) ([]store.PredictionToScore, error)
	SetPredictionScore(ctx context.Context, predictionID int64, points, penaltyBonus int32) error
}

// Recompute re-derives all materialized points from stored results,
// idempotently. It re-scores every FINAL match's predictions via
// scoring.Compute, then re-materializes bonus points via BonusScore.
// It never writes match results or weekly_results.
type Recompute struct {
	Store RecomputeStore
	Bonus BonusScore // reuse the M7 bonus materialiser
}

// RecomputeSummary is the output of a Recompute run.
type RecomputeSummary struct {
	MatchesRescored    int `json:"matches_rescored"`
	PredictionsUpdated int `json:"predictions_updated"`
	BonusUpdated       int `json:"bonus_updated"`
}

// Run re-scores every FINAL match's predictions then re-materializes bonus
// points. It is idempotent: running twice yields identical stored points.
func (j Recompute) Run(ctx context.Context) (RecomputeSummary, error) {
	matches, err := j.Store.ListFinalMatches(ctx)
	if err != nil {
		return RecomputeSummary{}, fmt.Errorf("jobs: list final matches: %w", err)
	}

	sum := RecomputeSummary{}
	for _, m := range matches {
		preds, err := j.Store.ListPredictionsForMatch(ctx, m.ID)
		if err != nil {
			return RecomputeSummary{}, fmt.Errorf("jobs: list predictions match=%d: %w", m.ID, err)
		}

		res := scoring.Result{
			Final:           true,
			Knockout:        m.Stage == store.StageKnockout,
			Home:            int(m.HomeScore),
			Away:            int(m.AwayScore),
			WentToPenalties: m.WentToPenalties,
			PenaltyWinner:   m.PenaltyWinnerTeamID,
		}

		for _, p := range preds {
			sc := scoring.Compute(
				scoring.Prediction{
					Home:          int(p.HomeScore),
					Away:          int(p.AwayScore),
					PenaltyWinner: p.PenaltyWinnerTeamID,
				},
				res,
			)
			if err := j.Store.SetPredictionScore(ctx, p.ID, int32(sc.Points), int32(sc.PenaltyBonus)); err != nil {
				return RecomputeSummary{}, fmt.Errorf("jobs: set score pred=%d: %w", p.ID, err)
			}
			sum.PredictionsUpdated++
		}
		sum.MatchesRescored++
	}

	bs, err := j.Bonus.Run(ctx)
	if err != nil {
		return RecomputeSummary{}, fmt.Errorf("jobs: recompute bonus: %w", err)
	}
	sum.BonusUpdated = bs.Scored

	slog.Info("recompute complete",
		"matches", sum.MatchesRescored,
		"predictions", sum.PredictionsUpdated,
		"bonus", sum.BonusUpdated,
	)
	return sum, nil
}
