package jobs

import (
	"context"
	"testing"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/sportsapi"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

func i64(v int64) *int64 { return &v }

// fakeAPI returns canned matches.
type fakeAPI struct{ matches []sportsapi.Match }

func (f fakeAPI) ListFinishedMatches(context.Context, string, string) ([]sportsapi.Match, error) {
	return f.matches, nil
}

// fakeStore implements store.ResultsStore in memory.
type fakeStore struct {
	match   store.MatchForResult
	teams   map[string]int64
	preds   []store.PredictionToScore
	updated []store.UpdateMatchResultParams
	scored  map[int64][2]int32 // predictionID -> {points, bonus}
}

func newFakeStore(m store.MatchForResult, teams map[string]int64, preds []store.PredictionToScore) *fakeStore {
	return &fakeStore{match: m, teams: teams, preds: preds, scored: map[int64][2]int32{}}
}
func (f *fakeStore) FindMatchByAPIFixtureID(context.Context, int64) (store.MatchForResult, error) {
	if f.match.APIFixtureID != nil {
		return f.match, nil
	}
	return store.MatchForResult{}, store.ErrNotFound
}
func (f *fakeStore) FindMatchByKickoffAndTeams(_ context.Context, _ time.Time, home, away int64) (store.MatchForResult, error) {
	if f.match.HomeTeamID != nil && *f.match.HomeTeamID == home && f.match.AwayTeamID != nil && *f.match.AwayTeamID == away {
		return f.match, nil
	}
	return store.MatchForResult{}, store.ErrNotFound
}
func (f *fakeStore) ListTeamsByCode(context.Context) (map[string]int64, error) { return f.teams, nil }
func (f *fakeStore) UpdateMatchResult(_ context.Context, p store.UpdateMatchResultParams) error {
	f.updated = append(f.updated, p)
	return nil
}
func (f *fakeStore) ListPredictionsForMatch(context.Context, int64) ([]store.PredictionToScore, error) {
	return f.preds, nil
}
func (f *fakeStore) SetPredictionScore(_ context.Context, id int64, points, bonus int32) error {
	f.scored[id] = [2]int32{points, bonus}
	return nil
}
func (f *fakeStore) WithTx(ctx context.Context, fn func(store.ResultsStore) error) error {
	return fn(f) // tests run the closure directly (no real tx)
}

func fixedClock(t time.Time) func() time.Time { return func() time.Time { return t } }

func seededGroup() store.MatchForResult {
	return store.MatchForResult{
		ID: 50, Stage: store.StageGroup, HomeTeamID: i64(1), AwayTeamID: i64(2),
		KickoffUTC: time.Date(2026, 6, 13, 16, 0, 0, 0, time.UTC), Status: store.StatusScheduled,
		ManualOverride: false, APIFixtureID: nil,
	}
}

func aliasAndTeams() (map[int64]string, map[string]int64) {
	return map[int64]string{759: "KOR", 760: "RSA"}, map[string]int64{"KOR": 1, "RSA": 2}
}

func apiGroup4x1() sportsapi.Match {
	h, a := 4, 1
	return sportsapi.Match{ID: 1001, UtcDate: "2026-06-13T16:00:00Z", Status: "FINISHED", Stage: "GROUP_STAGE",
		HomeTeam: sportsapi.Team{ID: 759}, AwayTeam: sportsapi.Team{ID: 760},
		Score: sportsapi.Score{Winner: "HOME_TEAM", Duration: "REGULAR", FullTime: sportsapi.FullTime{Home: &h, Away: &a}}}
}

func TestRunUpdatesResultAndScoresExact(t *testing.T) {
	alias, teams := aliasAndTeams()
	preds := []store.PredictionToScore{
		{ID: 10, HomeScore: 4, AwayScore: 1}, {ID: 11, HomeScore: 2, AwayScore: 1}, {ID: 12, HomeScore: 0, AwayScore: 2},
	}
	fs := newFakeStore(seededGroup(), teams, preds)
	job := ResultsIngest{API: fakeAPI{matches: []sportsapi.Match{apiGroup4x1()}}, Store: fs, Now: fixedClock(time.Date(2026, 6, 14, 6, 0, 0, 0, time.UTC)), Alias: alias}

	sum, err := job.Run(context.Background())
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if len(fs.updated) != 1 || fs.updated[0].ID != 50 || fs.updated[0].HomeScore != 4 || fs.updated[0].AwayScore != 1 ||
		fs.updated[0].Status != store.StatusFinal || fs.updated[0].WentToPenalties || fs.updated[0].APIFixtureID == nil || *fs.updated[0].APIFixtureID != 1001 {
		t.Fatalf("update = %+v", fs.updated)
	}
	if fs.scored[10] != [2]int32{5, 0} || fs.scored[11] != [2]int32{3, 0} || fs.scored[12] != [2]int32{0, 0} {
		t.Fatalf("scored = %+v", fs.scored)
	}
	if sum.Updated != 1 || sum.PredictionsScored != 3 {
		t.Fatalf("summary = %+v", sum)
	}
}

func TestRunSkipsManualOverride(t *testing.T) {
	alias, teams := aliasAndTeams()
	m := seededGroup()
	m.ManualOverride = true
	fs := newFakeStore(m, teams, []store.PredictionToScore{{ID: 10, HomeScore: 4, AwayScore: 1}})
	job := ResultsIngest{API: fakeAPI{matches: []sportsapi.Match{apiGroup4x1()}}, Store: fs, Now: fixedClock(time.Now().UTC()), Alias: alias}

	sum, _ := job.Run(context.Background())
	if len(fs.updated) != 0 || len(fs.scored) != 0 {
		t.Fatalf("manual_override must be skipped: updated=%+v scored=%+v", fs.updated, fs.scored)
	}
	if sum.Skipped != 1 || sum.Updated != 0 {
		t.Fatalf("summary = %+v", sum)
	}
}

func TestRunIdempotent(t *testing.T) {
	alias, teams := aliasAndTeams()
	fs := newFakeStore(seededGroup(), teams, []store.PredictionToScore{{ID: 10, HomeScore: 4, AwayScore: 1}})
	job := ResultsIngest{API: fakeAPI{matches: []sportsapi.Match{apiGroup4x1()}}, Store: fs, Now: fixedClock(time.Now().UTC()), Alias: alias}

	_, _ = job.Run(context.Background())
	first := fs.scored[10]
	_, _ = job.Run(context.Background())
	if fs.scored[10] != first || first != [2]int32{5, 0} {
		t.Fatalf("not idempotent: %+v then %+v", first, fs.scored[10])
	}
}

func TestRunScoresKnockoutPenaltyBonus(t *testing.T) {
	alias := map[int64]string{759: "KOR", 760: "RSA"}
	teams := map[string]int64{"KOR": 1, "RSA": 2}
	m := store.MatchForResult{ID: 60, Stage: store.StageKnockout, HomeTeamID: i64(1), AwayTeamID: i64(2),
		KickoffUTC: time.Date(2026, 7, 4, 18, 0, 0, 0, time.UTC), Status: store.StatusScheduled}
	fs := newFakeStore(m, teams, []store.PredictionToScore{{ID: 20, HomeScore: 1, AwayScore: 1, PenaltyWinnerTeamID: i64(2)}})
	h, a := 1, 1
	ko := sportsapi.Match{ID: 2002, UtcDate: "2026-07-04T18:00:00Z", Status: "FINISHED", Stage: "LAST_16",
		HomeTeam: sportsapi.Team{ID: 759}, AwayTeam: sportsapi.Team{ID: 760},
		Score: sportsapi.Score{Winner: "AWAY_TEAM", Duration: "PENALTY_SHOOTOUT", FullTime: sportsapi.FullTime{Home: &h, Away: &a}}}
	job := ResultsIngest{API: fakeAPI{matches: []sportsapi.Match{ko}}, Store: fs, Now: fixedClock(time.Now().UTC()), Alias: alias}

	_, _ = job.Run(context.Background())
	if fs.updated[0].WentToPenalties != true || fs.updated[0].PenaltyWinnerTeamID == nil || *fs.updated[0].PenaltyWinnerTeamID != 2 {
		t.Fatalf("knockout update = %+v", fs.updated[0])
	}
	if fs.scored[20] != [2]int32{5, 1} {
		t.Fatalf("expected exact+bonus {5,1}, got %+v", fs.scored[20])
	}
}
