package importer

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

type Importer struct {
	Store store.SeedStore
}

type Result struct {
	Venues  int
	Teams   int
	Matches int
}

func openData(dir, name string) (*os.File, error) {
	f, err := os.Open(filepath.Join(dir, name))
	if err != nil {
		return nil, fmt.Errorf("importer: open %s: %w", name, err)
	}
	return f, nil
}

// Run reads the CSV dataset in dir and upserts venues, teams, then matches.
// Idempotent: store upserts use ON DUPLICATE KEY and skip manual_override rows.
func (imp *Importer) Run(ctx context.Context, dir string) (Result, error) {
	vf, err := openData(dir, "host_cities.csv")
	if err != nil {
		return Result{}, err
	}
	venues, err := parseVenues(vf)
	vf.Close()
	if err != nil {
		return Result{}, err
	}
	for _, v := range venues {
		if err := imp.Store.UpsertVenue(ctx, store.UpsertVenueParams{
			SourceID: v.SourceID, CityName: v.CityName, Country: v.Country,
			VenueName: v.VenueName, RegionCluster: v.RegionCluster, Code: v.Code,
		}); err != nil {
			return Result{}, err
		}
	}

	tf, err := openData(dir, "teams.csv")
	if err != nil {
		return Result{}, err
	}
	teams, err := parseTeams(tf)
	tf.Close()
	if err != nil {
		return Result{}, err
	}
	for _, t := range teams {
		if err := imp.Store.UpsertTeam(ctx, store.UpsertTeamParams{
			SourceID: t.SourceID, Name: t.Name, Code: t.FifaCode,
			GroupLetter: t.GroupLetter, IsPlaceholder: t.IsPlaceholder,
		}); err != nil {
			return Result{}, err
		}
	}

	sf, err := openData(dir, "tournament_stages.csv")
	if err != nil {
		return Result{}, err
	}
	stages, err := parseStages(sf)
	sf.Close()
	if err != nil {
		return Result{}, err
	}

	mf, err := openData(dir, "matches.csv")
	if err != nil {
		return Result{}, err
	}
	matches, err := parseMatches(mf, stages)
	mf.Close()
	if err != nil {
		return Result{}, err
	}
	for _, m := range matches {
		home, err := imp.resolveTeam(ctx, m.HomeTeamID)
		if err != nil {
			return Result{}, err
		}
		away, err := imp.resolveTeam(ctx, m.AwayTeamID)
		if err != nil {
			return Result{}, err
		}
		venue, err := imp.resolveVenue(ctx, m.VenueID)
		if err != nil {
			return Result{}, err
		}
		if err := imp.Store.UpsertMatch(ctx, store.UpsertMatchParams{
			SourceID: m.SourceID, MatchNumber: int32(m.MatchNumber),
			Stage: store.Stage(m.Stage), Round: m.Round, GroupLetter: m.GroupLetter,
			MatchLabel: m.MatchLabel, HomeTeamID: home, AwayTeamID: away, VenueID: venue,
			KickoffUTC: m.KickoffUTC, Status: store.StatusScheduled,
		}); err != nil {
			return Result{}, err
		}
	}
	return Result{Venues: len(venues), Teams: len(teams), Matches: len(matches)}, nil
}

func (imp *Importer) resolveTeam(ctx context.Context, srcID *int64) (*int64, error) {
	if srcID == nil {
		return nil, nil
	}
	id, err := imp.Store.GetTeamIDBySourceID(ctx, *srcID)
	if err != nil {
		return nil, fmt.Errorf("importer: resolve team source %d: %w", *srcID, err)
	}
	return &id, nil
}

func (imp *Importer) resolveVenue(ctx context.Context, srcID *int64) (*int64, error) {
	if srcID == nil {
		return nil, nil
	}
	id, err := imp.Store.GetVenueIDBySourceID(ctx, *srcID)
	if err != nil {
		return nil, fmt.Errorf("importer: resolve venue source %d: %w", *srcID, err)
	}
	return &id, nil
}
