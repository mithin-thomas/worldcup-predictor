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

type UpsertVenueParams struct {
	SourceID      int64
	CityName      string
	Country       string
	VenueName     string
	RegionCluster string
	Code          string // airport_code
}

type UpsertTeamParams struct {
	SourceID      int64
	Name          string
	Code          string
	GroupLetter   string
	IsPlaceholder bool
}

type UpsertMatchParams struct {
	SourceID    int64
	MatchNumber int32
	Stage       Stage
	Round       string
	GroupLetter string
	MatchLabel  string
	HomeTeamID  *int64 // nil for knockout placeholders
	AwayTeamID  *int64
	VenueID     *int64
	KickoffUTC  time.Time
	Status      MatchStatus
}

type TeamRef struct {
	ID   int64
	Name string
	Code string
}

type VenueRef struct {
	Name    string
	City    string
	Country string
}

// MatchWithTeams is a match joined with its teams + venue (read model for the
// list). Home/Away/Venue are nil for knockout-placeholder/unknown rows.
type MatchWithTeams struct {
	ID             int64
	MatchNumber    int32
	Stage          Stage
	Round          string
	GroupLetter    string
	MatchLabel     string
	KickoffUTC     time.Time
	Status         MatchStatus
	HomeScore      *int32
	AwayScore      *int32
	WentToPens     bool
	ManualOverride bool
	Home           *TeamRef
	Away           *TeamRef
	Venue          *VenueRef
}

// SeedStore is the importer's write surface; MatchStore is the read surface.
type SeedStore interface {
	UpsertVenue(ctx context.Context, p UpsertVenueParams) error
	UpsertTeam(ctx context.Context, p UpsertTeamParams) error
	UpsertMatch(ctx context.Context, p UpsertMatchParams) error
	GetVenueIDBySourceID(ctx context.Context, sourceID int64) (int64, error)
	GetTeamIDBySourceID(ctx context.Context, sourceID int64) (int64, error)
}

type MatchStore interface {
	ListMatchesWithTeams(ctx context.Context) ([]MatchWithTeams, error)
	GetMatchByID(ctx context.Context, id int64) (MatchByID, error)
}

var (
	_ SeedStore  = (*SQLStore)(nil)
	_ MatchStore = (*SQLStore)(nil)
)

func (s *SQLStore) UpsertVenue(ctx context.Context, p UpsertVenueParams) error {
	if err := s.q.UpsertVenue(ctx, sqlc.UpsertVenueParams{
		SourceID: p.SourceID, CityName: p.CityName, Country: p.Country,
		VenueName: p.VenueName, RegionCluster: p.RegionCluster, AirportCode: p.Code,
	}); err != nil {
		return fmt.Errorf("store: upsert venue: %w", err)
	}
	return nil
}

func (s *SQLStore) UpsertTeam(ctx context.Context, p UpsertTeamParams) error {
	if err := s.q.UpsertTeam(ctx, sqlc.UpsertTeamParams{
		SourceID: p.SourceID, Name: p.Name, Code: p.Code,
		GroupLetter: p.GroupLetter, IsPlaceholder: p.IsPlaceholder,
	}); err != nil {
		return fmt.Errorf("store: upsert team: %w", err)
	}
	return nil
}

func (s *SQLStore) UpsertMatch(ctx context.Context, p UpsertMatchParams) error {
	if err := s.q.UpsertMatch(ctx, sqlc.UpsertMatchParams{
		SourceID: p.SourceID, MatchNumber: p.MatchNumber,
		Stage: sqlc.MatchesStage(p.Stage), Round: p.Round, GroupLetter: p.GroupLetter,
		MatchLabel: p.MatchLabel, HomeTeamID: nullI64(p.HomeTeamID), AwayTeamID: nullI64(p.AwayTeamID),
		VenueID: nullI64(p.VenueID), KickoffUtc: p.KickoffUTC, Status: sqlc.MatchesStatus(p.Status),
	}); err != nil {
		return fmt.Errorf("store: upsert match: %w", err)
	}
	return nil
}

func (s *SQLStore) GetVenueIDBySourceID(ctx context.Context, sourceID int64) (int64, error) {
	return s.q.GetVenueIDBySourceID(ctx, sourceID)
}

func (s *SQLStore) GetTeamIDBySourceID(ctx context.Context, sourceID int64) (int64, error) {
	return s.q.GetTeamIDBySourceID(ctx, sourceID)
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

func toMatchWithTeams(r sqlc.ListMatchesWithTeamsRow) MatchWithTeams {
	m := MatchWithTeams{
		ID: r.ID, MatchNumber: r.MatchNumber, Stage: Stage(r.Stage), Round: r.Round,
		GroupLetter: r.GroupLetter, MatchLabel: r.MatchLabel, KickoffUTC: r.KickoffUtc,
		Status: MatchStatus(r.Status), HomeScore: ptrInt32(r.HomeScore), AwayScore: ptrInt32(r.AwayScore),
		WentToPens: r.WentToPenalties, ManualOverride: r.ManualOverride,
	}
	if r.HomeTeamID.Valid {
		m.Home = &TeamRef{ID: r.HomeTeamID.Int64, Name: r.HomeName.String, Code: r.HomeCode.String}
	}
	if r.AwayTeamID.Valid {
		m.Away = &TeamRef{ID: r.AwayTeamID.Int64, Name: r.AwayName.String, Code: r.AwayCode.String}
	}
	if r.VenueID.Valid {
		m.Venue = &VenueRef{Name: r.VenueName.String, City: r.VenueCity.String, Country: r.VenueCountry.String}
	}
	return m
}

func nullI64(p *int64) sql.NullInt64 {
	if p == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: *p, Valid: true}
}

func ptrInt32(n sql.NullInt32) *int32 {
	if !n.Valid {
		return nil
	}
	v := n.Int32
	return &v
}
