// Package fixtures orchestrates syncing teams + fixtures from the sports API
// into the store. It is reused by `make seed-fixtures` and (later) admin re-sync.
package fixtures

import (
	"context"
	"fmt"

	"github.com/sayonetech/worldcup-predictor/backend/internal/sportsapi"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

type Syncer struct {
	API   sportsapi.Client
	Store store.MatchStore
}

type Result struct {
	Teams   int
	Matches int
}

// Run upserts all teams, then all matches (resolving API team ids to internal
// ids). Idempotent: the store's upserts use ON DUPLICATE KEY and skip
// manual_override rows, so re-running never double-creates or clobbers fixes.
func (s *Syncer) Run(ctx context.Context) (Result, error) {
	teams, err := s.API.FetchTeams(ctx)
	if err != nil {
		return Result{}, fmt.Errorf("fixtures: fetch teams: %w", err)
	}
	for _, t := range teams {
		if err := s.Store.UpsertTeam(ctx, store.UpsertTeamParams{
			APITeamID: t.APITeamID, Name: t.Name, Code: t.Code, LogoURL: t.LogoURL,
		}); err != nil {
			return Result{}, err
		}
	}

	fxs, err := s.API.FetchFixtures(ctx)
	if err != nil {
		return Result{}, fmt.Errorf("fixtures: fetch fixtures: %w", err)
	}
	for _, f := range fxs {
		homeID, err := s.Store.GetTeamIDByAPIID(ctx, f.HomeAPITeamID)
		if err != nil {
			return Result{}, fmt.Errorf("fixtures: resolve home team %d: %w", f.HomeAPITeamID, err)
		}
		awayID, err := s.Store.GetTeamIDByAPIID(ctx, f.AwayAPITeamID)
		if err != nil {
			return Result{}, fmt.Errorf("fixtures: resolve away team %d: %w", f.AwayAPITeamID, err)
		}
		if err := s.Store.UpsertMatch(ctx, store.UpsertMatchParams{
			APIFixtureID: f.APIFixtureID,
			Stage:        store.Stage(f.Stage),
			Round:        f.Round,
			HomeTeamID:   homeID,
			AwayTeamID:   awayID,
			KickoffUTC:   f.KickoffUTC,
			Status:       store.MatchStatus(f.Status),
			HomeScore:    f.HomeScore,
			AwayScore:    f.AwayScore,
		}); err != nil {
			return Result{}, err
		}
	}
	return Result{Teams: len(teams), Matches: len(fxs)}, nil
}
