package leaderboard

import "testing"

func rows(points ...int64) []Row {
	out := make([]Row, len(points))
	for i, p := range points {
		out[i] = Row{UserID: int64(i + 1), Points: p}
	}
	return out
}

func TestRankWeeklyTiesShareRank(t *testing.T) {
	// pre-ordered by points desc; equal points = co-winners share rank.
	r := Rank(rows(10, 10, 7, 5, 5), WeeklySameRank)
	want := []int{1, 1, 3, 4, 4}
	for i := range r {
		if r[i].Rank != want[i] {
			t.Errorf("row %d rank = %d, want %d", i, r[i].Rank, want[i])
		}
	}
}

func TestRankOverallCascadeBreaksTotalTie(t *testing.T) {
	// equal points, different exact counts → distinct ranks (no shared rank).
	in := []Row{
		{UserID: 1, Points: 10, Exact: 2, Correct: 0},
		{UserID: 2, Points: 10, Exact: 1, Correct: 1},
		{UserID: 3, Points: 10, Exact: 1, Correct: 1}, // fully tied with #2 → shares its rank
	}
	r := Rank(in, OverallSameRank)
	if r[0].Rank != 1 || r[1].Rank != 2 || r[2].Rank != 2 {
		t.Fatalf("ranks = %d,%d,%d; want 1,2,2", r[0].Rank, r[1].Rank, r[2].Rank)
	}
}

func TestPage(t *testing.T) {
	r := Rank(rows(9, 8, 7, 6, 5), WeeklySameRank) // 5 rows
	pg, total := Page(r, 2, 2)
	if total != 5 || len(pg) != 2 || pg[0].Rank != 3 || pg[1].Rank != 4 {
		t.Fatalf("page = %+v total=%d", pg, total)
	}
	// out-of-range page → empty slice, real total.
	pg2, total2 := Page(r, 9, 2)
	if total2 != 5 || len(pg2) != 0 {
		t.Fatalf("oob page = %+v total=%d", pg2, total2)
	}
}

func TestOverallSameRank_BonusBreaksTie(t *testing.T) {
	a := Row{Points: 50, Exact: 5, Correct: 5, BonusHits: 3}
	b := Row{Points: 50, Exact: 5, Correct: 5, BonusHits: 1}
	if OverallSameRank(a, b) {
		t.Error("rows tied on total/exact/correct but differing bonus hits must NOT share a rank")
	}
	c := Row{Points: 50, Exact: 5, Correct: 5, BonusHits: 3}
	if !OverallSameRank(a, c) {
		t.Error("identical rows must share a rank")
	}
}

func TestFind(t *testing.T) {
	r := Rank(rows(9, 8, 7), WeeklySameRank) // user ids 1,2,3
	got, ok := Find(r, 3)
	if !ok || got.Rank != 3 || got.Points != 7 {
		t.Fatalf("find = %+v ok=%v", got, ok)
	}
	if _, ok := Find(r, 99); ok {
		t.Fatal("expected not found for unknown user")
	}
}
