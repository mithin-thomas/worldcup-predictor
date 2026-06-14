package bonus

import "testing"

func TestPointsAndRefType(t *testing.T) {
	cases := []struct {
		c   Category
		pts int
		rt  RefType
	}{
		{Winner, 30, RefTeam},
		{RunnerUp, 20, RefTeam},
		{FairPlay, 10, RefTeam},
		{GoldenBall, 10, RefPlayer},
		{GoldenBoot, 10, RefPlayer},
		{GoldenGlove, 10, RefPlayer},
		{YoungPlayer, 10, RefPlayer},
	}
	total := 0
	for _, tc := range cases {
		if got := Points(tc.c); got != tc.pts {
			t.Errorf("Points(%s) = %d, want %d", tc.c, got, tc.pts)
		}
		if got := RefTypeOf(tc.c); got != tc.rt {
			t.Errorf("RefTypeOf(%s) = %s, want %s", tc.c, got, tc.rt)
		}
		total += Points(tc.c)
	}
	if total != 100 {
		t.Errorf("max bonus = %d, want 100", total)
	}
	if len(Categories) != 7 {
		t.Errorf("Categories has %d, want 7", len(Categories))
	}
}

func TestValid(t *testing.T) {
	if !Valid("winner") || Valid("most_assists") || Valid("") {
		t.Error("Valid() wrong")
	}
}

func TestScore(t *testing.T) {
	ref := func(n int64) *int64 { return &n }
	if got := Score(Winner, 9, ref(9)); got != 30 {
		t.Errorf("match winner = %d, want 30", got)
	}
	if got := Score(Winner, 9, ref(10)); got != 0 {
		t.Errorf("mismatch = %d, want 0", got)
	}
	if got := Score(GoldenBoot, 5, nil); got != 0 {
		t.Errorf("no result yet = %d, want 0", got)
	}
	if got := Score(FairPlay, 3, ref(3)); got != 10 {
		t.Errorf("fair play match = %d, want 10", got)
	}
}
