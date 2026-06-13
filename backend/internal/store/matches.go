package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store/sqlc"
)

type Stage string

const (
	StageGroup    Stage = "group"
	StageKnockout Stage = "knockout"
)

type MatchStatus string

const (
	StatusScheduled MatchStatus = "scheduled"
	StatusLive      MatchStatus = "live"
	StatusFinal     MatchStatus = "final"
)

type Team struct {
	ID        int64
	APITeamID int64
	Name      string
	Code      string
	LogoURL   string
}

type TeamRef struct {
	ID      int64
	Name    string
	Code    string
	LogoURL string
}

// MatchWithTeams is a match joined with its two teams (read model for the list).
type MatchWithTeams struct {
	ID             int64
	APIFixtureID   int64
	Stage          Stage
	Round          string
	KickoffUTC     time.Time
	Status         MatchStatus
	HomeScore      *int32
	AwayScore      *int32
	WentToPens     bool
	PenWinnerTeam  *int64
	ManualOverride bool
	Home           TeamRef
	Away           TeamRef
}

type UpsertTeamParams struct {
	APITeamID int64
	Name      string
	Code      string
	LogoURL   string
}

type UpsertMatchParams struct {
	APIFixtureID  int64
	Stage         Stage
	Round         string
	HomeTeamID    int64
	AwayTeamID    int64
	KickoffUTC    time.Time
	Status        MatchStatus
	HomeScore     *int32
	AwayScore     *int32
	WentToPens    bool
	PenWinnerTeam *int64
}

// MatchStore is the fixtures/matches data surface. Handlers and the syncer
// depend on this narrow interface (not the whole DB) so they fake easily.
type MatchStore interface {
	UpsertTeam(ctx context.Context, p UpsertTeamParams) error
	GetTeamIDByAPIID(ctx context.Context, apiTeamID int64) (int64, error)
	UpsertMatch(ctx context.Context, p UpsertMatchParams) error
	ListMatchesWithTeams(ctx context.Context) ([]MatchWithTeams, error)
}

// Compile-time guard.
var _ MatchStore = (*SQLStore)(nil)

func (s *SQLStore) UpsertTeam(ctx context.Context, p UpsertTeamParams) error {
	_, err := s.q.UpsertTeam(ctx, sqlcUpsertTeamParams(p))
	if err != nil {
		return fmt.Errorf("store: upsert team: %w", err)
	}
	return nil
}

func (s *SQLStore) GetTeamIDByAPIID(ctx context.Context, apiTeamID int64) (int64, error) {
	row, err := s.q.GetTeamByAPIID(ctx, apiTeamID)
	if err != nil {
		return 0, err
	}
	return row.ID, nil
}

func (s *SQLStore) UpsertMatch(ctx context.Context, p UpsertMatchParams) error {
	_, err := s.q.UpsertMatch(ctx, sqlcUpsertMatchParams(p))
	if err != nil {
		return fmt.Errorf("store: upsert match: %w", err)
	}
	return nil
}

func (s *SQLStore) ListMatchesWithTeams(ctx context.Context) ([]MatchWithTeams, error) {
	rows, err := s.q.ListMatchesWithTeams(ctx)
	if err != nil {
		return nil, fmt.Errorf("store: list matches: %w", err)
	}
	out := make([]MatchWithTeams, 0, len(rows))
	for _, r := range rows {
		out = append(out, toMatchWithTeams(r))
	}
	return out, nil
}

// --- converters to/from the generated sqlc types ---

func sqlcUpsertTeamParams(p UpsertTeamParams) sqlc.UpsertTeamParams {
	return sqlc.UpsertTeamParams{
		ApiTeamID: p.APITeamID,
		Name:      p.Name,
		Code:      p.Code,
		LogoUrl:   p.LogoURL,
	}
}

func sqlcUpsertMatchParams(p UpsertMatchParams) sqlc.UpsertMatchParams {
	return sqlc.UpsertMatchParams{
		ApiFixtureID:        p.APIFixtureID,
		Stage:               sqlc.MatchesStage(p.Stage),
		Round:               p.Round,
		HomeTeamID:          p.HomeTeamID,
		AwayTeamID:          p.AwayTeamID,
		KickoffUtc:          p.KickoffUTC,
		Status:              sqlc.MatchesStatus(p.Status),
		HomeScore:           nullInt32(p.HomeScore),
		AwayScore:           nullInt32(p.AwayScore),
		WentToPenalties:     p.WentToPens,
		PenaltyWinnerTeamID: nullInt64(p.PenWinnerTeam),
	}
}

func toMatchWithTeams(r sqlc.ListMatchesWithTeamsRow) MatchWithTeams {
	return MatchWithTeams{
		ID:             r.ID,
		APIFixtureID:   r.ApiFixtureID,
		Stage:          Stage(r.Stage),
		Round:          r.Round,
		KickoffUTC:     r.KickoffUtc,
		Status:         MatchStatus(r.Status),
		HomeScore:      ptrInt32(r.HomeScore),
		AwayScore:      ptrInt32(r.AwayScore),
		WentToPens:     r.WentToPenalties,
		PenWinnerTeam:  ptrInt64(r.PenaltyWinnerTeamID),
		ManualOverride: r.ManualOverride,
		Home:           TeamRef{ID: r.HomeID, Name: r.HomeName, Code: r.HomeCode, LogoURL: r.HomeLogo},
		Away:           TeamRef{ID: r.AwayID, Name: r.AwayName, Code: r.AwayCode, LogoURL: r.AwayLogo},
	}
}

func nullInt32(p *int32) sql.NullInt32 {
	if p == nil {
		return sql.NullInt32{}
	}
	return sql.NullInt32{Int32: *p, Valid: true}
}
func ptrInt32(n sql.NullInt32) *int32 {
	if !n.Valid {
		return nil
	}
	v := n.Int32
	return &v
}
func nullInt64(p *int64) sql.NullInt64 {
	if p == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: *p, Valid: true}
}
func ptrInt64(n sql.NullInt64) *int64 {
	if !n.Valid {
		return nil
	}
	v := n.Int64
	return &v
}
