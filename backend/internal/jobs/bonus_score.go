package jobs

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/sayonetech/worldcup-predictor/backend/internal/bonus"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

// BonusScoreStore is the subset of the store the bonus-score job needs.
type BonusScoreStore interface {
	ListAllBonusPredictions(ctx context.Context) ([]store.BonusPredictionRow, error)
	ListBonusResults(ctx context.Context) ([]store.BonusResult, error)
	SetBonusPredictionPoints(ctx context.Context, id, points int64) error
}

// BonusScore materialises bonus_predictions.points from bonus_results (idempotent SET).
type BonusScore struct{ Store BonusScoreStore }

// BonusSummary is the output of a BonusScore run.
type BonusSummary struct{ Scored int }

// Run materializes bonus_predictions.points from bonus_results (idempotent SET).
// It recomputes and SETs — never increments — so running it twice is safe.
func (j BonusScore) Run(ctx context.Context) (BonusSummary, error) {
	results, err := j.Store.ListBonusResults(ctx)
	if err != nil {
		return BonusSummary{}, fmt.Errorf("jobs: list bonus results: %w", err)
	}
	byCat := make(map[string]int64, len(results))
	for _, r := range results {
		byCat[r.Category] = r.RefID
	}
	preds, err := j.Store.ListAllBonusPredictions(ctx)
	if err != nil {
		return BonusSummary{}, fmt.Errorf("jobs: list bonus predictions: %w", err)
	}
	n := 0
	for _, p := range preds {
		var resultRef *int64
		if rid, ok := byCat[p.Category]; ok {
			resultRef = &rid
		}
		pts := int64(bonus.Score(bonus.Category(p.Category), p.RefID, resultRef))
		if err := j.Store.SetBonusPredictionPoints(ctx, p.ID, pts); err != nil {
			return BonusSummary{}, fmt.Errorf("jobs: set bonus points id=%d: %w", p.ID, err)
		}
		n++
	}
	slog.Info("bonus-score complete", "scored", n)
	return BonusSummary{Scored: n}, nil
}
