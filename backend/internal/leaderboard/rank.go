// Package leaderboard holds pure ranking + pagination for the leaderboards.
// It has no I/O; the handler maps store rows in and DTOs out.
package leaderboard

// Row is one user's standing (pre-ordered by the SQL query: the §5.1 cascade).
type Row struct {
	UserID    int64
	Name      string
	AvatarURL string
	Points    int64
	Exact     int64
	Correct   int64
	BonusHits int64 // §5.1 fourth tier: most correct bonus picks (weekly leaves this 0)
	IsWinner  bool
}

// Ranked is a Row with its computed 1-based rank.
type Ranked struct {
	Row
	Rank int
}

// WeeklySameRank: co-winners share a rank on equal total points (§3.5).
func WeeklySameRank(a, b Row) bool { return a.Points == b.Points }

// OverallSameRank: §5.1 — same rank only when total, exact, correct, and bonus
// hits all tie (four-tier cascade: total → exact → correct → bonus hits).
func OverallSameRank(a, b Row) bool {
	return a.Points == b.Points && a.Exact == b.Exact &&
		a.Correct == b.Correct && a.BonusHits == b.BonusHits
}

// Rank assigns 1-based competition ranks to PRE-ORDERED rows (e.g. 1,1,3).
func Rank(rows []Row, sameRank func(a, b Row) bool) []Ranked {
	out := make([]Ranked, len(rows))
	rank := 0
	for i, r := range rows {
		if i == 0 || !sameRank(rows[i-1], r) {
			rank = i + 1
		}
		out[i] = Ranked{Row: r, Rank: rank}
	}
	return out
}

// Page returns the 1-based page slice of size pageSize, plus the total count.
func Page(rows []Ranked, page, pageSize int) ([]Ranked, int) {
	total := len(rows)
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	start := (page - 1) * pageSize
	if start >= total {
		return []Ranked{}, total
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	return rows[start:end], total
}

// Find returns the ranked row for userID (and true) if present.
func Find(rows []Ranked, userID int64) (Ranked, bool) {
	for _, r := range rows {
		if r.UserID == userID {
			return r, true
		}
	}
	return Ranked{}, false
}
