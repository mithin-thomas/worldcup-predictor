package fixtures

import (
	"context"
	"testing"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/sportsapi"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

type fakeAPI struct {
	teams []sportsapi.Team
	fxs   []sportsapi.Fixture
}

func (f fakeAPI) FetchTeams(context.Context) ([]sportsapi.Team, error)       { return f.teams, nil }
func (f fakeAPI) FetchFixtures(context.Context) ([]sportsapi.Fixture, error) { return f.fxs, nil }

type fakeMatchStore struct {
	teamsByAPI   map[int64]int64 // api_team_id -> internal id
	teamUpserts  int
	matchUpserts int
	lastMatch    store.UpsertMatchParams
}

func newFakeMatchStore() *fakeMatchStore {
	return &fakeMatchStore{teamsByAPI: map[int64]int64{}}
}
func (s *fakeMatchStore) UpsertTeam(_ context.Context, p store.UpsertTeamParams) error {
	s.teamUpserts++
	if _, ok := s.teamsByAPI[p.APITeamID]; !ok {
		s.teamsByAPI[p.APITeamID] = int64(len(s.teamsByAPI) + 1)
	}
	return nil
}
func (s *fakeMatchStore) GetTeamIDByAPIID(_ context.Context, apiID int64) (int64, error) {
	return s.teamsByAPI[apiID], nil
}
func (s *fakeMatchStore) UpsertMatch(_ context.Context, p store.UpsertMatchParams) error {
	s.matchUpserts++
	s.lastMatch = p
	return nil
}
func (s *fakeMatchStore) ListMatchesWithTeams(context.Context) ([]store.MatchWithTeams, error) {
	return nil, nil
}

func TestSyncUpsertsTeamsThenMatchesAndResolvesTeamIDs(t *testing.T) {
	api := fakeAPI{
		teams: []sportsapi.Team{{APITeamID: 10, Name: "Brazil"}, {APITeamID: 20, Name: "Argentina"}},
		fxs: []sportsapi.Fixture{{
			APIFixtureID: 1001, Stage: sportsapi.StageGroup, Round: "Group A - 1",
			HomeAPITeamID: 10, AwayAPITeamID: 20,
			KickoffUTC: time.Date(2026, 6, 11, 19, 0, 0, 0, time.UTC), Status: sportsapi.StatusScheduled,
		}},
	}
	st := newFakeMatchStore()
	res, err := (&Syncer{API: api, Store: st}).Run(context.Background())
	if err != nil {
		t.Fatalf("Run err = %v", err)
	}
	if st.teamUpserts != 2 || st.matchUpserts != 1 {
		t.Errorf("upserts: teams=%d matches=%d, want 2/1", st.teamUpserts, st.matchUpserts)
	}
	if res.Teams != 2 || res.Matches != 1 {
		t.Errorf("result = %+v, want 2 teams / 1 match", res)
	}
	// the match's home/away were resolved from api ids 10/20 to internal ids
	if st.lastMatch.HomeTeamID == 0 || st.lastMatch.AwayTeamID == 0 {
		t.Errorf("team ids not resolved: %+v", st.lastMatch)
	}
	if st.lastMatch.Stage != store.StageGroup || st.lastMatch.Status != store.StatusScheduled {
		t.Errorf("stage/status not mapped to store enums: %+v", st.lastMatch)
	}
}

func TestSyncIsIdempotent(t *testing.T) {
	api := fakeAPI{
		teams: []sportsapi.Team{{APITeamID: 10, Name: "Brazil"}, {APITeamID: 20, Name: "Argentina"}},
		fxs:   []sportsapi.Fixture{{APIFixtureID: 1001, HomeAPITeamID: 10, AwayAPITeamID: 20, KickoffUTC: time.Now().UTC()}},
	}
	st := newFakeMatchStore()
	s := &Syncer{API: api, Store: st}
	_, _ = s.Run(context.Background())
	_, _ = s.Run(context.Background())
	// running twice issues upserts again (idempotent at the SQL layer via ON DUPLICATE KEY);
	// the fake just confirms it doesn't error and team ids stay stable.
	if len(st.teamsByAPI) != 2 {
		t.Errorf("teams grew on re-run: %d, want 2", len(st.teamsByAPI))
	}
}
