package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store/sqlc"
)

// AdminMatch is a full match row for the admin management list.
type AdminMatch struct {
	ID                  int64
	MatchNumber         int32
	Stage               string
	Round               string
	HomeTeamID          *int64
	HomeTeam            string
	HomeCode            string
	AwayTeamID          *int64
	AwayTeam            string
	AwayCode            string
	KickoffUTC          time.Time
	Status              string
	HomeScore           *int64
	AwayScore           *int64
	WentToPenalties     bool
	PenaltyWinnerTeamID *int64
	ManualOverride      bool
}

// CreateMatchParams carries the inputs for an admin-created fixture.
type CreateMatchParams struct {
	MatchNumber int32
	Stage       string
	Round       string
	HomeTeamID  int64
	AwayTeamID  int64
	KickoffUTC  time.Time
}

// UpdateMatchDetailParams carries the inputs for an admin fixture-detail edit.
type UpdateMatchDetailParams struct {
	ID         int64
	HomeTeamID int64
	AwayTeamID int64
	KickoffUTC time.Time
	Stage      string
	Round      string
}

// AdminMatchStore is the match-management surface for admin handlers.
type AdminMatchStore interface {
	ListMatchesForAdmin(ctx context.Context) ([]AdminMatch, error)
	CreateMatch(ctx context.Context, p CreateMatchParams) (int64, error)
	UpdateMatchDetail(ctx context.Context, p UpdateMatchDetailParams) error
	DeleteMatch(ctx context.Context, id int64) (bool, error)
	MatchExists(ctx context.Context, id int64) (bool, error)
	TeamExists(ctx context.Context, id int64) (bool, error) // implemented in players.go
}

// AdminUserRow is a user plus activity stats for the admin users table.
// PredictionCount is how many predictions the user has made; TotalPoints is
// their overall score (match points + penalty bonus + tournament bonus).
type AdminUserRow struct {
	ID              int64
	Email           string
	Name            string
	AvatarURL       string
	Role            Role
	PredictionCount int64
	TotalPoints     int64
}

// AdminUserStore is the user-management surface for admin handlers.
type AdminUserStore interface {
	ListUsers(ctx context.Context) ([]AdminUserRow, error)
	CountAdmins(ctx context.Context) (int64, error)
	GetUserRole(ctx context.Context, id int64) (Role, error)
	SetUserRole(ctx context.Context, id int64, role Role) error // implemented in db.go
}

// Compile-time guards.
var _ AdminMatchStore = (*SQLStore)(nil)
var _ AdminUserStore = (*SQLStore)(nil)

func (s *SQLStore) ListMatchesForAdmin(ctx context.Context) ([]AdminMatch, error) {
	rows, err := s.q.ListMatchesForAdmin(ctx)
	if err != nil {
		return nil, fmt.Errorf("store: list matches for admin: %w", err)
	}
	out := make([]AdminMatch, 0, len(rows))
	for _, r := range rows {
		out = append(out, AdminMatch{
			ID:                  r.ID,
			MatchNumber:         r.MatchNumber,
			Stage:               string(r.Stage),
			Round:               r.Round,
			HomeTeamID:          ptrI64(r.HomeTeamID),
			HomeTeam:            r.HomeTeam.String,
			HomeCode:            r.HomeCode.String,
			AwayTeamID:          ptrI64(r.AwayTeamID),
			AwayTeam:            r.AwayTeam.String,
			AwayCode:            r.AwayCode.String,
			KickoffUTC:          r.KickoffUtc,
			Status:              string(r.Status),
			HomeScore:           ptrI64FromInt32(r.HomeScore),
			AwayScore:           ptrI64FromInt32(r.AwayScore),
			WentToPenalties:     r.WentToPenalties,
			PenaltyWinnerTeamID: ptrI64(r.PenaltyWinnerTeamID),
			ManualOverride:      r.ManualOverride,
		})
	}
	return out, nil
}

func (s *SQLStore) CreateMatch(ctx context.Context, p CreateMatchParams) (int64, error) {
	id, err := s.q.CreateMatchAdmin(ctx, sqlc.CreateMatchAdminParams{
		MatchNumber: p.MatchNumber,
		Stage:       sqlc.MatchesStage(p.Stage),
		Round:       p.Round,
		HomeTeamID:  sql.NullInt64{Int64: p.HomeTeamID, Valid: true},
		AwayTeamID:  sql.NullInt64{Int64: p.AwayTeamID, Valid: true},
		KickoffUtc:  p.KickoffUTC,
	})
	if err != nil {
		return 0, fmt.Errorf("store: create match: %w", err)
	}
	return id, nil
}

func (s *SQLStore) UpdateMatchDetail(ctx context.Context, p UpdateMatchDetailParams) error {
	if err := s.q.UpdateMatchDetailAdmin(ctx, sqlc.UpdateMatchDetailAdminParams{
		HomeTeamID: sql.NullInt64{Int64: p.HomeTeamID, Valid: true},
		AwayTeamID: sql.NullInt64{Int64: p.AwayTeamID, Valid: true},
		KickoffUtc: p.KickoffUTC,
		Stage:      sqlc.MatchesStage(p.Stage),
		Round:      p.Round,
		ID:         p.ID,
	}); err != nil {
		return fmt.Errorf("store: update match detail: %w", err)
	}
	return nil
}

func (s *SQLStore) DeleteMatch(ctx context.Context, id int64) (bool, error) {
	n, err := s.q.DeleteMatchAdmin(ctx, id)
	if err != nil {
		return false, fmt.Errorf("store: delete match: %w", err)
	}
	return n > 0, nil
}

func (s *SQLStore) MatchExists(ctx context.Context, id int64) (bool, error) {
	n, err := s.q.MatchExists(ctx, id)
	if err != nil {
		return false, fmt.Errorf("store: match exists: %w", err)
	}
	return n > 0, nil
}

func (s *SQLStore) ListUsers(ctx context.Context) ([]AdminUserRow, error) {
	rows, err := s.q.ListUsersAdmin(ctx)
	if err != nil {
		return nil, fmt.Errorf("store: list users: %w", err)
	}
	out := make([]AdminUserRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, AdminUserRow{
			ID:              r.ID,
			Email:           r.Email,
			Name:            r.Name,
			AvatarURL:       r.AvatarUrl,
			Role:            Role(r.Role),
			PredictionCount: r.PredictionCount,
			TotalPoints:     r.TotalPoints,
		})
	}
	return out, nil
}

func (s *SQLStore) CountAdmins(ctx context.Context) (int64, error) {
	n, err := s.q.CountAdmins(ctx)
	if err != nil {
		return 0, fmt.Errorf("store: count admins: %w", err)
	}
	return n, nil
}

func (s *SQLStore) GetUserRole(ctx context.Context, id int64) (Role, error) {
	r, err := s.q.GetUserRole(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("store: get user role: %w", err)
	}
	return Role(r), nil
}

// ptrI64FromInt32 maps a nullable INT score column (sql.NullInt32) to *int64.
func ptrI64FromInt32(n sql.NullInt32) *int64 {
	if !n.Valid {
		return nil
	}
	v := int64(n.Int32)
	return &v
}
