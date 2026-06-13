package scoring

import "testing"

func TestComputePoints(t *testing.T) {
	cases := []struct {
		name string
		p    Prediction
		r    Result
		want Score
	}{
		// Not final: never scores, even for a perfect-looking prediction.
		{"not final", Prediction{Home: 1, Away: 1}, Result{Final: false, Home: 1, Away: 1}, Score{}},

		// Exact (5).
		{"exact home win", Prediction{2, 1, nil}, Result{Final: true, Home: 2, Away: 1}, Score{Points: 5}},
		{"exact away win", Prediction{0, 3, nil}, Result{Final: true, Home: 0, Away: 3}, Score{Points: 5}},
		{"exact scoreless draw", Prediction{0, 0, nil}, Result{Final: true, Home: 0, Away: 0}, Score{Points: 5}},
		{"exact scoring draw", Prediction{2, 2, nil}, Result{Final: true, Home: 2, Away: 2}, Score{Points: 5}},
		{"exact high score", Prediction{4, 3, nil}, Result{Final: true, Home: 4, Away: 3}, Score{Points: 5}},

		// Correct result, wrong score (3).
		{"correct home win wrong score", Prediction{2, 1, nil}, Result{Final: true, Home: 3, Away: 1}, Score{Points: 3}},
		{"correct away win wrong score", Prediction{0, 1, nil}, Result{Final: true, Home: 1, Away: 3}, Score{Points: 3}},
		{"correct draw different score", Prediction{1, 1, nil}, Result{Final: true, Home: 2, Away: 2}, Score{Points: 3}},

		// Wrong (0).
		{"wrong home-win vs away-win", Prediction{2, 1, nil}, Result{Final: true, Home: 1, Away: 2}, Score{}},
		{"wrong draw vs decisive", Prediction{1, 1, nil}, Result{Final: true, Home: 2, Away: 1}, Score{}},
		{"wrong decisive vs draw", Prediction{2, 1, nil}, Result{Final: true, Home: 1, Away: 1}, Score{}},

		// sign() edges.
		{"sign 0-0 vs 0-0 exact", Prediction{0, 0, nil}, Result{Final: true, Home: 0, Away: 0}, Score{Points: 5}},
		{"sign 1-1 vs 2-2 correct", Prediction{1, 1, nil}, Result{Final: true, Home: 2, Away: 2}, Score{Points: 3}},
		{"sign 1-1 vs 1-0 wrong", Prediction{1, 1, nil}, Result{Final: true, Home: 1, Away: 0}, Score{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Compute(tc.p, tc.r); got != tc.want {
				t.Errorf("Compute(%+v, %+v) = %+v, want %+v", tc.p, tc.r, got, tc.want)
			}
		})
	}
}

func TestComputeIdempotent(t *testing.T) {
	p := Prediction{Home: 2, Away: 1}
	r := Result{Final: true, Home: 2, Away: 1}
	first := Compute(p, r)
	second := Compute(p, r)
	if first != second {
		t.Fatalf("Compute not idempotent: %+v != %+v", first, second)
	}
}

// pw returns a pointer to a team id, for the penalty-winner fields.
func pw(id int64) *int64 { return &id }

func TestComputePenaltyBonus(t *testing.T) {
	// All cases are knockout matches that went to penalties unless the name says otherwise.
	cases := []struct {
		name string
		p    Prediction
		r    Result
		want Score
	}{
		// Bonus earned: predicted draw, earned points, correct shootout winner.
		{"exact draw + correct winner → +1",
			Prediction{1, 1, pw(7)},
			Result{Final: true, Knockout: true, Home: 1, Away: 1, WentToPenalties: true, PenaltyWinner: pw(7)},
			Score{Points: 5, PenaltyBonus: 1}},
		{"correct-result draw + correct winner → +1",
			Prediction{1, 1, pw(7)},
			Result{Final: true, Knockout: true, Home: 2, Away: 2, WentToPenalties: true, PenaltyWinner: pw(7)},
			Score{Points: 3, PenaltyBonus: 1}},

		// No bonus: every guard.
		{"wrong winner pick → no bonus",
			Prediction{1, 1, pw(7)},
			Result{Final: true, Knockout: true, Home: 1, Away: 1, WentToPenalties: true, PenaltyWinner: pw(8)},
			Score{Points: 5}},
		{"nil winner pick → no bonus",
			Prediction{1, 1, nil},
			Result{Final: true, Knockout: true, Home: 1, Away: 1, WentToPenalties: true, PenaltyWinner: pw(7)},
			Score{Points: 5}},
		{"nil actual winner → no bonus",
			Prediction{1, 1, pw(7)},
			Result{Final: true, Knockout: true, Home: 1, Away: 1, WentToPenalties: true, PenaltyWinner: nil},
			Score{Points: 5}},
		{"not knockout → no bonus",
			Prediction{1, 1, pw(7)},
			Result{Final: true, Knockout: false, Home: 1, Away: 1, WentToPenalties: true, PenaltyWinner: pw(7)},
			Score{Points: 5}},
		{"knockout but no shootout → no bonus",
			Prediction{1, 1, pw(7)},
			Result{Final: true, Knockout: true, Home: 1, Away: 1, WentToPenalties: false, PenaltyWinner: pw(7)},
			Score{Points: 5}},
		{"non-draw prediction → no bonus",
			Prediction{2, 1, pw(7)},
			Result{Final: true, Knockout: true, Home: 1, Away: 1, WentToPenalties: true, PenaltyWinner: pw(7)},
			Score{}}, // points 0 (2-1 vs 1-1 is wrong) and not a draw prediction
		{"points==0 guard (draw pred scores 0) → no bonus",
			Prediction{0, 0, pw(7)},
			Result{Final: true, Knockout: true, Home: 1, Away: 0, WentToPenalties: true, PenaltyWinner: pw(7)},
			Score{}}, // 0-0 vs 1-0 is wrong → points 0, so no bonus despite the draw prediction
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Compute(tc.p, tc.r); got != tc.want {
				t.Errorf("Compute(%+v, %+v) = %+v, want %+v", tc.p, tc.r, got, tc.want)
			}
		})
	}
}
