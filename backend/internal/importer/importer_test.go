package importer

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

type fakeStore struct {
	venuesBySrc   map[int64]int64
	teamsBySrc    map[int64]int64
	teamsByCode   map[string]int64
	matches       []store.UpsertMatchParams
	playerUpserts []store.UpsertPlayerParams
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		venuesBySrc: map[int64]int64{},
		teamsBySrc:  map[int64]int64{},
		teamsByCode: map[string]int64{"MEX": 1, "RSA": 2},
	}
}
func (f *fakeStore) UpsertVenue(_ context.Context, p store.UpsertVenueParams) error {
	if _, ok := f.venuesBySrc[p.SourceID]; !ok {
		f.venuesBySrc[p.SourceID] = int64(len(f.venuesBySrc) + 1)
	}
	return nil
}
func (f *fakeStore) UpsertTeam(_ context.Context, p store.UpsertTeamParams) error {
	if _, ok := f.teamsBySrc[p.SourceID]; !ok {
		f.teamsBySrc[p.SourceID] = int64(len(f.teamsBySrc) + 1)
	}
	return nil
}
func (f *fakeStore) UpsertMatch(_ context.Context, p store.UpsertMatchParams) error {
	f.matches = append(f.matches, p)
	return nil
}
func (f *fakeStore) GetVenueIDBySourceID(_ context.Context, s int64) (int64, error) {
	return f.venuesBySrc[s], nil
}
func (f *fakeStore) GetTeamIDBySourceID(_ context.Context, s int64) (int64, error) {
	return f.teamsBySrc[s], nil
}
func (f *fakeStore) UpsertPlayer(_ context.Context, p store.UpsertPlayerParams) error {
	f.playerUpserts = append(f.playerUpserts, p)
	return nil
}
func (f *fakeStore) ListTeamsByCode(_ context.Context) (map[string]int64, error) {
	return f.teamsByCode, nil
}

func writeFixtures(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	write := func(name, body string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("teams.csv", "id,team_name,fifa_code,group_letter,is_placeholder\n1,Mexico,MEX,A,False\n2,South Africa,RSA,A,False\n")
	write("host_cities.csv", "id,city_name,country,venue_name,region_cluster,airport_code\n15,Mexico City,Mexico,Estadio Azteca,Central,MEX\n4,Houston,USA,NRG Stadium,Central,IAH\n")
	write("tournament_stages.csv", "id,stage_name,stage_order\n1,Group Stage,1\n3,Round of 16,3\n")
	write("matches.csv", "id,match_number,home_team_id,away_team_id,city_id,stage_id,kickoff_at,match_label\n"+
		"1,1,1,2,15,1,2026-06-11 15:00:00-06,Group A\n"+
		"89,89,,,4,3,2026-07-04 13:00:00-05,W73 vs W75\n")
	write("players.csv", "source_id,team_fifa_code,name,position\n"+
		"1001,MEX,Guillermo Ochoa,Goalkeeper\n"+
		"1002,MEX,Hirving Lozano,Forward\n"+
		"2001,RSA,Ronwen Williams,Goalkeeper\n")
	return dir
}

func TestImporterRunResolvesIDsAndNulls(t *testing.T) {
	dir := writeFixtures(t)
	fs := newFakeStore()
	res, err := (&Importer{Store: fs}).Run(context.Background(), dir)
	if err != nil {
		t.Fatalf("Run err = %v", err)
	}
	if res.Venues != 2 || res.Teams != 2 || res.Matches != 2 || res.Players != 3 {
		t.Fatalf("result = %+v, want 2/2/2/3", res)
	}
	g := fs.matches[0]
	if g.HomeTeamID == nil || g.AwayTeamID == nil || g.VenueID == nil {
		t.Errorf("group match refs should resolve: %+v", g)
	}
	if g.Stage != store.StageGroup || g.GroupLetter != "A" || g.Round != "Group Stage" {
		t.Errorf("group fields: %+v", g)
	}
	k := fs.matches[1]
	if k.HomeTeamID != nil || k.AwayTeamID != nil {
		t.Errorf("placeholder teams should stay nil: %+v", k)
	}
	if k.Stage != store.StageKnockout || k.MatchLabel != "W73 vs W75" {
		t.Errorf("knockout fields: %+v", k)
	}
}

func TestImporterIsIdempotent(t *testing.T) {
	dir := writeFixtures(t)
	fs := newFakeStore()
	imp := &Importer{Store: fs}
	if _, err := imp.Run(context.Background(), dir); err != nil {
		t.Fatal(err)
	}
	if _, err := imp.Run(context.Background(), dir); err != nil {
		t.Fatal(err)
	}
	if len(fs.venuesBySrc) != 2 || len(fs.teamsBySrc) != 2 {
		t.Errorf("re-run grew refs: venues=%d teams=%d", len(fs.venuesBySrc), len(fs.teamsBySrc))
	}
}

func TestImporterUpsertsPlayersWithResolvedTeamIDs(t *testing.T) {
	dir := writeFixtures(t)
	fs := newFakeStore()
	// teamsByCode: MEX->1, RSA->2 (set by newFakeStore)
	res, err := (&Importer{Store: fs}).Run(context.Background(), dir)
	if err != nil {
		t.Fatalf("Run err = %v", err)
	}
	if res.Players != 3 {
		t.Fatalf("Players = %d, want 3", res.Players)
	}
	if len(fs.playerUpserts) != 3 {
		t.Fatalf("playerUpserts = %d, want 3", len(fs.playerUpserts))
	}
	// first two players are MEX (sorted by team,name: Guillermo Ochoa, Hirving Lozano in fixture)
	// but Run processes in CSV order: 1001,MEX / 1002,MEX / 2001,RSA
	bySourceID := map[int64]store.UpsertPlayerParams{}
	for _, p := range fs.playerUpserts {
		bySourceID[p.SourceID] = p
	}
	if bySourceID[1001].TeamID != 1 || bySourceID[1001].Name != "Guillermo Ochoa" || bySourceID[1001].Position != "Goalkeeper" {
		t.Errorf("player 1001 = %+v", bySourceID[1001])
	}
	if bySourceID[2001].TeamID != 2 || bySourceID[2001].Name != "Ronwen Williams" {
		t.Errorf("player 2001 = %+v", bySourceID[2001])
	}
}

func TestImporterUnknownTeamCodeErrors(t *testing.T) {
	dir := writeFixtures(t)
	// Write a players.csv with an unknown code
	if err := os.WriteFile(filepath.Join(dir, "players.csv"),
		[]byte("source_id,team_fifa_code,name,position\n999,UNKNOWN,Test Player,Forward\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	fs := newFakeStore()
	_, err := (&Importer{Store: fs}).Run(context.Background(), dir)
	if err == nil {
		t.Fatal("expected error for unknown team code, got nil")
	}
	if !strings.Contains(err.Error(), "unknown team code") {
		t.Errorf("error should mention unknown team code, got: %v", err)
	}
}
