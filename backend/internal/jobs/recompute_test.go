package jobs

import (
	"context"
	"testing"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

// fakeRecomputeStore records every SetPredictionScore call; exposes no method
// to write match results or weekly_results — structural invariant.
type fakeRecomputeStore struct {
	matches     []store.FinalMatch
	predictions map[int64][]store.PredictionToScore // matchID → preds

	scoreWrites []scoreWrite // records (id, points, penaltyBonus)
}

type scoreWrite struct {
	id           int64
	points       int32
	penaltyBonus int32
}

func (f *fakeRecomputeStore) ListFinalMatches(_ context.Context) ([]store.FinalMatch, error) {
	return f.matches, nil
}
func (f *fakeRecomputeStore) ListPredictionsForMatch(_ context.Context, matchID int64) ([]store.PredictionToScore, error) {
	return f.predictions[matchID], nil
}
func (f *fakeRecomputeStore) SetPredictionScore(_ context.Context, id int64, points, penaltyBonus int32) error {
	f.scoreWrites = append(f.scoreWrites, scoreWrite{id: id, points: points, penaltyBonus: penaltyBonus})
	return nil
}

// recomputeBonusFake is a minimal BonusScoreStore for recompute tests.
// Uses different field names than the existing fakeBonusScoreStore in
// bonus_score_test.go (same package) to avoid redeclaration conflicts.
type recomputeBonusFake struct {
	bonusPreds   []store.BonusPredictionRow
	bonusResults []store.BonusResult
	bonusWrites  int
}

func (f *recomputeBonusFake) ListAllBonusPredictions(_ context.Context) ([]store.BonusPredictionRow, error) {
	return f.bonusPreds, nil
}
func (f *recomputeBonusFake) ListBonusResults(_ context.Context) ([]store.BonusResult, error) {
	return f.bonusResults, nil
}
func (f *recomputeBonusFake) SetBonusPredictionPoints(_ context.Context, _ int64, _ int64) error {
	f.bonusWrites++
	return nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func ptrI64(v int64) *int64 { return &v }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// TestRecompute_ScoresExactAndCorrectResult verifies that scoring.Compute is
// called with real logic (exact→5, correct result→3, wrong→0) and that the
// store.SetPredictionScore is called with those values.
func TestRecompute_ScoresExactAndCorrectResult(t *testing.T) {
	matchID := int64(1)
	fakeStore := &fakeRecomputeStore{
		matches: []store.FinalMatch{
			{ID: matchID, Stage: store.StageGroup, HomeScore: 2, AwayScore: 1},
		},
		predictions: map[int64][]store.PredictionToScore{
			matchID: {
				{ID: 10, HomeScore: 2, AwayScore: 1}, // exact → 5
				{ID: 11, HomeScore: 3, AwayScore: 0}, // correct result (home wins) → 3
				{ID: 12, HomeScore: 0, AwayScore: 2}, // wrong (away wins predicted) → 0
			},
		},
	}
	fakeBonus := &recomputeBonusFake{}
	job := Recompute{
		Store: fakeStore,
		Bonus: BonusScore{Store: fakeBonus},
	}
	summary, err := job.Run(context.Background())
	if err != nil {
		t.Fatalf("Run() error: %v", err)
	}
	if summary.MatchesRescored != 1 {
		t.Errorf("MatchesRescored = %d, want 1", summary.MatchesRescored)
	}
	if summary.PredictionsUpdated != 3 {
		t.Errorf("PredictionsUpdated = %d, want 3", summary.PredictionsUpdated)
	}

	// Assert score writes via real scoring.Compute values.
	want := map[int64][2]int32{
		10: {5, 0}, // exact
		11: {3, 0}, // correct result
		12: {0, 0}, // wrong
	}
	for _, sw := range fakeStore.scoreWrites {
		exp, ok := want[sw.id]
		if !ok {
			t.Errorf("unexpected score write for id=%d", sw.id)
			continue
		}
		if sw.points != exp[0] || sw.penaltyBonus != exp[1] {
			t.Errorf("id=%d: got points=%d bonus=%d, want points=%d bonus=%d",
				sw.id, sw.points, sw.penaltyBonus, exp[0], exp[1])
		}
	}
}

// TestRecompute_KnockoutPenaltyBonus verifies the +1 bonus: knockout + went_to_penalties
// + user predicted draw + prediction earned points + correct shootout winner.
// Result: 1-1 (extra time draw, went to penalties, home team wins shootout).
func TestRecompute_KnockoutPenaltyBonus(t *testing.T) {
	winnerID := int64(42)
	matchID := int64(2)
	fakeStore := &fakeRecomputeStore{
		matches: []store.FinalMatch{
			{
				ID: matchID, Stage: store.StageKnockout,
				HomeScore: 1, AwayScore: 1,
				WentToPenalties:     true,
				PenaltyWinnerTeamID: &winnerID,
			},
		},
		predictions: map[int64][]store.PredictionToScore{
			matchID: {
				// Draw predicted (different scoreline from result) + correct shootout winner → 3 + 1 bonus.
				{ID: 20, HomeScore: 0, AwayScore: 0, PenaltyWinnerTeamID: &winnerID},
				// Draw predicted (different scoreline) but WRONG shootout winner → 3, 0 bonus.
				{ID: 21, HomeScore: 0, AwayScore: 0, PenaltyWinnerTeamID: ptrI64(99)},
				// Wrong prediction (home wins) → 0, 0 bonus.
				{ID: 22, HomeScore: 2, AwayScore: 0},
			},
		},
	}
	fakeBonus := &recomputeBonusFake{}
	job := Recompute{Store: fakeStore, Bonus: BonusScore{Store: fakeBonus}}
	_, err := job.Run(context.Background())
	if err != nil {
		t.Fatalf("Run() error: %v", err)
	}

	want := map[int64][2]int32{
		20: {3, 1}, // correct draw (different score) + right shootout winner
		21: {3, 0}, // correct draw (different score) + wrong shootout winner
		22: {0, 0}, // wrong prediction
	}
	for _, sw := range fakeStore.scoreWrites {
		exp, ok := want[sw.id]
		if !ok {
			t.Errorf("unexpected score write for id=%d", sw.id)
			continue
		}
		if sw.points != exp[0] || sw.penaltyBonus != exp[1] {
			t.Errorf("id=%d: got points=%d bonus=%d, want points=%d bonus=%d",
				sw.id, sw.points, sw.penaltyBonus, exp[0], exp[1])
		}
	}
}

// TestRecompute_Idempotent verifies that running the job twice produces the same
// score writes (absolute SET, never increment). The second run overwrites with the
// same values — not double-counted.
func TestRecompute_Idempotent(t *testing.T) {
	matchID := int64(3)
	fakeStore := &fakeRecomputeStore{
		matches: []store.FinalMatch{
			{ID: matchID, Stage: store.StageGroup, HomeScore: 1, AwayScore: 0},
		},
		predictions: map[int64][]store.PredictionToScore{
			matchID: {
				{ID: 30, HomeScore: 1, AwayScore: 0}, // exact → 5
			},
		},
	}
	fakeBonus := &recomputeBonusFake{}
	job := Recompute{Store: fakeStore, Bonus: BonusScore{Store: fakeBonus}}

	sum1, err := job.Run(context.Background())
	if err != nil {
		t.Fatalf("first Run() error: %v", err)
	}
	sum2, err := job.Run(context.Background())
	if err != nil {
		t.Fatalf("second Run() error: %v", err)
	}

	if sum1.MatchesRescored != sum2.MatchesRescored ||
		sum1.PredictionsUpdated != sum2.PredictionsUpdated {
		t.Errorf("idempotency broken: run1=%+v run2=%+v", sum1, sum2)
	}

	// Each run writes one score. Check all writes have the same (idempotent) value.
	for _, sw := range fakeStore.scoreWrites {
		if sw.points != 5 || sw.penaltyBonus != 0 {
			t.Errorf("score write id=%d: got points=%d bonus=%d, want 5/0",
				sw.id, sw.points, sw.penaltyBonus)
		}
	}
}

// TestRecompute_NoWeeklyResultsWrite structurally asserts that the RecomputeStore
// interface has no method to write weekly_results or match results. Any attempt to
// add such a call to recompute.go would fail to compile because the interface (and
// these fakes) do not expose those methods. We verify that only re-score and bonus
// writes occurred.
func TestRecompute_NoWeeklyResultsWrite(t *testing.T) {
	matchID := int64(4)
	fakeStore := &fakeRecomputeStore{
		matches: []store.FinalMatch{
			{ID: matchID, Stage: store.StageGroup, HomeScore: 2, AwayScore: 2},
		},
		predictions: map[int64][]store.PredictionToScore{
			matchID: {
				{ID: 40, HomeScore: 2, AwayScore: 2}, // exact → 5
			},
		},
	}
	bonusStore := &recomputeBonusFake{
		bonusPreds: []store.BonusPredictionRow{
			{ID: 100, Category: "winner", RefID: 7},
		},
		bonusResults: []store.BonusResult{
			{Category: "winner", RefID: 7},
		},
	}
	job := Recompute{Store: fakeStore, Bonus: BonusScore{Store: bonusStore}}
	summary, err := job.Run(context.Background())
	if err != nil {
		t.Fatalf("Run() error: %v", err)
	}

	// Exactly 1 prediction score write (no match result writes, no weekly_results writes).
	if len(fakeStore.scoreWrites) != 1 {
		t.Errorf("expected 1 score write, got %d", len(fakeStore.scoreWrites))
	}
	// Bonus was materialized.
	if summary.BonusUpdated != 1 {
		t.Errorf("BonusUpdated = %d, want 1", summary.BonusUpdated)
	}
	// bonusStore.bonusWrites == 1 confirms SetBonusPredictionPoints was called.
	if bonusStore.bonusWrites != 1 {
		t.Errorf("bonus writes = %d, want 1", bonusStore.bonusWrites)
	}
}

// TestRecompute_MultipleMatches verifies correct MatchesRescored and
// PredictionsUpdated counts across multiple final matches.
func TestRecompute_MultipleMatches(t *testing.T) {
	fakeStore := &fakeRecomputeStore{
		matches: []store.FinalMatch{
			{ID: 1, Stage: store.StageGroup, HomeScore: 1, AwayScore: 0},
			{ID: 2, Stage: store.StageGroup, HomeScore: 2, AwayScore: 2},
		},
		predictions: map[int64][]store.PredictionToScore{
			1: {
				{ID: 101, HomeScore: 1, AwayScore: 0}, // exact → 5
				{ID: 102, HomeScore: 2, AwayScore: 1}, // correct result → 3
			},
			2: {
				{ID: 103, HomeScore: 2, AwayScore: 2}, // exact draw → 5
			},
		},
	}
	fakeBonus := &recomputeBonusFake{}
	job := Recompute{Store: fakeStore, Bonus: BonusScore{Store: fakeBonus}}
	summary, err := job.Run(context.Background())
	if err != nil {
		t.Fatalf("Run() error: %v", err)
	}
	if summary.MatchesRescored != 2 {
		t.Errorf("MatchesRescored = %d, want 2", summary.MatchesRescored)
	}
	if summary.PredictionsUpdated != 3 {
		t.Errorf("PredictionsUpdated = %d, want 3", summary.PredictionsUpdated)
	}
}

// TestRecompute_EmptyFinalMatches verifies that a run with no final matches
// returns a zero summary and still runs the bonus pass.
func TestRecompute_EmptyFinalMatches(t *testing.T) {
	fakeStore := &fakeRecomputeStore{
		matches:     []store.FinalMatch{},
		predictions: map[int64][]store.PredictionToScore{},
	}
	fakeBonus := &recomputeBonusFake{}
	job := Recompute{Store: fakeStore, Bonus: BonusScore{Store: fakeBonus}}
	summary, err := job.Run(context.Background())
	if err != nil {
		t.Fatalf("Run() error: %v", err)
	}
	if summary.MatchesRescored != 0 {
		t.Errorf("MatchesRescored = %d, want 0", summary.MatchesRescored)
	}
	if summary.PredictionsUpdated != 0 {
		t.Errorf("PredictionsUpdated = %d, want 0", summary.PredictionsUpdated)
	}
}
