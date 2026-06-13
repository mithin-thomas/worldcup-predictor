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
