package store

import (
	"context"
	"fmt"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store/sqlc"
)

// CelebratedTeamCodes is the allowlist of team codes that trigger a victory
// celebration. Brazil only, for now; extend here to add more.
var CelebratedTeamCodes = map[string]bool{"BRA": true}

// Celebration is a celebrated-team win the user has not yet seen.
type Celebration struct {
	MatchID       int64
	TeamCode      string
	TeamScore     int32
	OpponentCode  string
	OpponentScore int32
	KickoffUTC    time.Time
}

// CelebrationStore is the handler-facing slice of the data layer for celebrations.
type CelebrationStore interface {
	ListPendingCelebrations(ctx context.Context, userID int64) ([]Celebration, error)
	MarkCelebrationsSeen(ctx context.Context, userID int64, matchIDs []int64) error
}

var _ CelebrationStore = (*SQLStore)(nil)

// finalMatch is the pure-Go view of one finalized match used by celebrationFor.
type finalMatch struct {
	MatchID       int64
	HomeID        int64
	HomeCode      string
	HomeScore     int32
	AwayID        int64
	AwayCode      string
	AwayScore     int32
	PenaltyWinner *int64 // shootout winner team id (set only on a regulation draw)
	KickoffUTC    time.Time
}

// celebrationFor decides whether a finalized match is a celebrated-team win and,
// if so, returns the Celebration to show. Winner = higher score; on a regulation
// draw the shootout winner (PenaltyWinner) wins. Pure: no I/O.
func celebrationFor(m finalMatch, codes map[string]bool) (Celebration, bool) {
	var winnerHome bool
	switch {
	case m.HomeScore > m.AwayScore:
		winnerHome = true
	case m.AwayScore > m.HomeScore:
		winnerHome = false
	default: // regulation draw → shootout
		if m.PenaltyWinner == nil {
			return Celebration{}, false
		}
		switch *m.PenaltyWinner {
		case m.HomeID:
			winnerHome = true
		case m.AwayID:
			winnerHome = false
		default:
			return Celebration{}, false
		}
	}

	winCode, winScore, oppCode, oppScore := m.AwayCode, m.AwayScore, m.HomeCode, m.HomeScore
	if winnerHome {
		winCode, winScore, oppCode, oppScore = m.HomeCode, m.HomeScore, m.AwayCode, m.AwayScore
	}
	if !codes[winCode] {
		return Celebration{}, false
	}
	return Celebration{
		MatchID:       m.MatchID,
		TeamCode:      winCode,
		TeamScore:     winScore,
		OpponentCode:  oppCode,
		OpponentScore: oppScore,
		KickoffUTC:    m.KickoffUTC,
	}, true
}

// ListPendingCelebrations returns the user's unseen celebrated-team wins, newest first.
func (s *SQLStore) ListPendingCelebrations(ctx context.Context, userID int64) ([]Celebration, error) {
	rows, err := s.q.ListUnseenFinalMatchesForUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("store: list unseen finals: %w", err)
	}
	out := make([]Celebration, 0, len(rows))
	for _, r := range rows {
		var pw *int64
		if r.PenaltyWinnerTeamID.Valid {
			v := r.PenaltyWinnerTeamID.Int64
			pw = &v
		}
		m := finalMatch{
			MatchID:       r.MatchID,
			HomeID:        r.HomeID,
			HomeCode:      r.HomeCode,
			HomeScore:     r.HomeScore.Int32,
			AwayID:        r.AwayID,
			AwayCode:      r.AwayCode,
			AwayScore:     r.AwayScore.Int32,
			PenaltyWinner: pw,
			KickoffUTC:    r.KickoffUtc,
		}
		if c, ok := celebrationFor(m, CelebratedTeamCodes); ok {
			out = append(out, c)
		}
	}
	return out, nil
}

// MarkCelebrationsSeen idempotently records that the user has seen each match's celebration.
func (s *SQLStore) MarkCelebrationsSeen(ctx context.Context, userID int64, matchIDs []int64) error {
	for _, mid := range matchIDs {
		if err := s.q.MarkCelebrationSeen(ctx, sqlc.MarkCelebrationSeenParams{UserID: userID, MatchID: mid}); err != nil {
			return fmt.Errorf("store: mark celebration seen: %w", err)
		}
	}
	return nil
}
