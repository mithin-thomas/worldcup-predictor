package store

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store/sqlc"
)

// TeamOption is a team entry for the bonus-pick team dropdown.
type TeamOption struct {
	ID   int64
	Name string
	Code string
}

// PlayerOption is a player entry for the bonus-pick player searchbox.
type PlayerOption struct {
	ID       int64
	Name     string
	Position string
	TeamCode string
}

// UpsertPlayerParams carries a player row from the CSV importer.
type UpsertPlayerParams struct {
	SourceID int64
	TeamID   int64
	Name     string
	Position string
}

// PlayerStore is the read surface for bonus team/player pickers.
type PlayerStore interface {
	ListTeamsForPicker(ctx context.Context) ([]TeamOption, error)
	SearchPlayers(ctx context.Context, q string) ([]PlayerOption, error)
	// TeamNameByID returns the team name for the given id, or "" if not found.
	TeamNameByID(ctx context.Context, id int64) (string, error)
	// PlayerNameByID returns the player name for the given id, or "" if not found.
	PlayerNameByID(ctx context.Context, id int64) (string, error)
}

var _ PlayerStore = (*SQLStore)(nil)

func (s *SQLStore) UpsertPlayer(ctx context.Context, p UpsertPlayerParams) error {
	if err := s.q.UpsertPlayer(ctx, sqlc.UpsertPlayerParams{
		SourceID: p.SourceID, TeamID: p.TeamID, Name: p.Name, Position: p.Position,
	}); err != nil {
		return fmt.Errorf("store: upsert player: %w", err)
	}
	return nil
}

func (s *SQLStore) ListTeamsForPicker(ctx context.Context) ([]TeamOption, error) {
	rows, err := s.q.ListTeamsForPicker(ctx)
	if err != nil {
		return nil, fmt.Errorf("store: list teams: %w", err)
	}
	out := make([]TeamOption, 0, len(rows))
	for _, r := range rows {
		out = append(out, TeamOption{ID: r.ID, Name: r.Name, Code: r.Code})
	}
	return out, nil
}

func (s *SQLStore) SearchPlayers(ctx context.Context, q string) ([]PlayerOption, error) {
	// The generated SearchPlayers takes interface{} (sqlc CONCAT pattern); pass the string directly.
	rows, err := s.q.SearchPlayers(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("store: search players: %w", err)
	}
	out := make([]PlayerOption, 0, len(rows))
	for _, r := range rows {
		out = append(out, PlayerOption{ID: r.ID, Name: r.Name, Position: r.Position, TeamCode: r.TeamCode})
	}
	return out, nil
}

func (s *SQLStore) TeamNameByID(ctx context.Context, id int64) (string, error) {
	name, err := s.q.TeamNameByID(ctx, id)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("store: team name by id: %w", err)
	}
	return name, nil
}

func (s *SQLStore) PlayerNameByID(ctx context.Context, id int64) (string, error) {
	name, err := s.q.PlayerNameByID(ctx, id)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("store: player name by id: %w", err)
	}
	return name, nil
}

func (s *SQLStore) TeamExists(ctx context.Context, id int64) (bool, error) {
	n, err := s.q.TeamExists(ctx, id)
	if err != nil {
		return false, fmt.Errorf("store: team exists: %w", err)
	}
	return n > 0, nil
}

func (s *SQLStore) PlayerExists(ctx context.Context, id int64) (bool, error) {
	n, err := s.q.PlayerExists(ctx, id)
	if err != nil {
		return false, fmt.Errorf("store: player exists: %w", err)
	}
	return n > 0, nil
}
