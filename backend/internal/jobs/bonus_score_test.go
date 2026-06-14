package jobs

import (
	"context"
	"testing"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

type fakeBonusScoreStore struct {
	preds   []store.BonusPredictionRow
	results []store.BonusResult
	set     map[int64]int64 // prediction id -> points
}

func (f *fakeBonusScoreStore) ListAllBonusPredictions(context.Context) ([]store.BonusPredictionRow, error) {
	return f.preds, nil
}
func (f *fakeBonusScoreStore) ListBonusResults(context.Context) ([]store.BonusResult, error) {
	return f.results, nil
}
func (f *fakeBonusScoreStore) SetBonusPredictionPoints(_ context.Context, id, pts int64) error {
	if f.set == nil {
		f.set = map[int64]int64{}
	}
	f.set[id] = pts
	return nil
}

func TestBonusScore_MaterializesAndIsIdempotent(t *testing.T) {
	st := &fakeBonusScoreStore{
		preds: []store.BonusPredictionRow{
			{ID: 1, Category: "winner", RefID: 9},       // correct -> 30
			{ID: 2, Category: "winner", RefID: 10},      // wrong -> 0
			{ID: 3, Category: "golden_boot", RefID: 42}, // correct -> 10
		},
		results: []store.BonusResult{
			{Category: "winner", RefID: 9},
			{Category: "golden_boot", RefID: 42},
		},
	}
	j := BonusScore{Store: st}
	if _, err := j.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	want := map[int64]int64{1: 30, 2: 0, 3: 10}
	for id, w := range want {
		if st.set[id] != w {
			t.Errorf("pred %d points = %d, want %d", id, st.set[id], w)
		}
	}
	// run again -> identical (idempotent)
	st.set = nil
	if _, err := j.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	for id, w := range want {
		if st.set[id] != w {
			t.Errorf("re-run pred %d points = %d, want %d", id, st.set[id], w)
		}
	}
}

func TestBonusScore_NoResultsAllZero(t *testing.T) {
	st := &fakeBonusScoreStore{
		preds: []store.BonusPredictionRow{
			{ID: 1, Category: "winner", RefID: 9},
		},
		results: nil, // no results yet
	}
	j := BonusScore{Store: st}
	if _, err := j.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	if st.set[1] != 0 {
		t.Errorf("with no results pred 1 points = %d, want 0", st.set[1])
	}
}

func TestBonusScore_EmptyPredsSucceeds(t *testing.T) {
	st := &fakeBonusScoreStore{preds: nil, results: nil}
	j := BonusScore{Store: st}
	sum, err := j.Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if sum.Scored != 0 {
		t.Errorf("scored = %d, want 0", sum.Scored)
	}
}
