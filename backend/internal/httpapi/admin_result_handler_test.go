package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

// fakeResultsStore implements store.ResultsStore for handler tests.
// Runs the WithTx closure directly (no real DB transaction).
type fakeResultsStore struct {
	match    store.MatchForResult
	notFound bool
	preds    []store.PredictionToScore
	// recorded calls
	updated           []store.UpdateMatchResultParams
	scored            map[int64][2]int32 // predID -> {points, bonus}
	manualOverrideSet bool
}

func newFakeResultsStore(m store.MatchForResult, preds []store.PredictionToScore) *fakeResultsStore {
	return &fakeResultsStore{match: m, preds: preds, scored: map[int64][2]int32{}}
}

func (f *fakeResultsStore) FindMatchByAPIFixtureID(context.Context, int64) (store.MatchForResult, error) {
	return store.MatchForResult{}, store.ErrNotFound
}

func (f *fakeResultsStore) FindMatchByKickoffAndTeams(context.Context, time.Time, int64, int64) (store.MatchForResult, error) {
	return store.MatchForResult{}, store.ErrNotFound
}

func (f *fakeResultsStore) FindMatchByID(_ context.Context, id int64) (store.MatchForResult, error) {
	if f.notFound || f.match.ID != id {
		return store.MatchForResult{}, store.ErrNotFound
	}
	return f.match, nil
}

func (f *fakeResultsStore) ListTeamsByCode(context.Context) (map[string]int64, error) {
	return nil, nil
}

func (f *fakeResultsStore) UpdateMatchResult(_ context.Context, p store.UpdateMatchResultParams) error {
	f.updated = append(f.updated, p)
	return nil
}

func (f *fakeResultsStore) ListPredictionsForMatch(context.Context, int64) ([]store.PredictionToScore, error) {
	return f.preds, nil
}

func (f *fakeResultsStore) SetPredictionScore(_ context.Context, id int64, points, bonus int32) error {
	f.scored[id] = [2]int32{points, bonus}
	return nil
}

func (f *fakeResultsStore) SetMatchManualOverride(context.Context, int64) error {
	f.manualOverrideSet = true
	return nil
}

func (f *fakeResultsStore) WithTx(ctx context.Context, fn func(store.ResultsStore) error) error {
	return fn(f)
}

// helpers
func p64(v int64) *int64 { return &v }

func groupMatch(id int64, homeID, awayID int64) store.MatchForResult {
	return store.MatchForResult{
		ID: id, Stage: store.StageGroup,
		HomeTeamID: p64(homeID), AwayTeamID: p64(awayID),
		Status: store.StatusScheduled,
	}
}

func knockoutMatch(id int64, homeID, awayID int64, apiFixtureID *int64) store.MatchForResult {
	return store.MatchForResult{
		ID: id, Stage: store.StageKnockout,
		HomeTeamID: p64(homeID), AwayTeamID: p64(awayID),
		Status:       store.StatusScheduled,
		APIFixtureID: apiFixtureID,
	}
}

// --- TASK 4: Result correction tests ---

func TestPutAdminMatchResult_ExactScoreGives5(t *testing.T) {
	m := groupMatch(10, 1, 2)
	preds := []store.PredictionToScore{
		{ID: 101, HomeScore: 2, AwayScore: 1}, // exact
	}
	rs := newFakeResultsStore(m, preds)
	d := &Deps{Results: rs}
	body := `{"home_score":2,"away_score":1,"went_to_penalties":false}`
	req := adminUser(httptest.NewRequest(http.MethodPut, "/api/admin/matches/10/result", strings.NewReader(body)), 9)
	req = withChiID(req, "10")
	rec := httptest.NewRecorder()
	d.PutAdminMatchResult(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if rs.scored[101] != [2]int32{5, 0} {
		t.Errorf("exact score: got %v, want {5,0}", rs.scored[101])
	}
}

func TestPutAdminMatchResult_CorrectResultGives3(t *testing.T) {
	m := groupMatch(10, 1, 2)
	preds := []store.PredictionToScore{
		{ID: 102, HomeScore: 3, AwayScore: 0}, // correct result (home wins) but not exact
	}
	rs := newFakeResultsStore(m, preds)
	d := &Deps{Results: rs}
	body := `{"home_score":2,"away_score":1}`
	req := adminUser(httptest.NewRequest(http.MethodPut, "/api/admin/matches/10/result", strings.NewReader(body)), 9)
	req = withChiID(req, "10")
	rec := httptest.NewRecorder()
	d.PutAdminMatchResult(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if rs.scored[102] != [2]int32{3, 0} {
		t.Errorf("correct result: got %v, want {3,0}", rs.scored[102])
	}
}

func TestPutAdminMatchResult_WrongResultGives0(t *testing.T) {
	m := groupMatch(10, 1, 2)
	preds := []store.PredictionToScore{
		{ID: 103, HomeScore: 0, AwayScore: 2}, // away wins but actual home wins
	}
	rs := newFakeResultsStore(m, preds)
	d := &Deps{Results: rs}
	body := `{"home_score":2,"away_score":1}`
	req := adminUser(httptest.NewRequest(http.MethodPut, "/api/admin/matches/10/result", strings.NewReader(body)), 9)
	req = withChiID(req, "10")
	rec := httptest.NewRecorder()
	d.PutAdminMatchResult(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if rs.scored[103] != [2]int32{0, 0} {
		t.Errorf("wrong result: got %v, want {0,0}", rs.scored[103])
	}
}

func TestPutAdminMatchResult_KnockoutShootoutDrawGivesBonus(t *testing.T) {
	m := knockoutMatch(20, 1, 2, nil)
	preds := []store.PredictionToScore{
		// predicted draw 1-1 AND picked correct penalty winner (team 2)
		{ID: 200, HomeScore: 1, AwayScore: 1, PenaltyWinnerTeamID: p64(2)},
	}
	rs := newFakeResultsStore(m, preds)
	d := &Deps{Results: rs}
	penWinnerID := int64(2)
	body := `{"home_score":1,"away_score":1,"went_to_penalties":true,"penalty_winner_team_id":2}`
	req := adminUser(httptest.NewRequest(http.MethodPut, "/api/admin/matches/20/result", strings.NewReader(body)), 9)
	req = withChiID(req, "20")
	_ = penWinnerID
	rec := httptest.NewRecorder()
	d.PutAdminMatchResult(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	// exact draw + correct penalty winner = 5 points + 1 bonus
	if rs.scored[200] != [2]int32{5, 1} {
		t.Errorf("knockout bonus: got %v, want {5,1}", rs.scored[200])
	}
}

func TestPutAdminMatchResult_Idempotent(t *testing.T) {
	m := groupMatch(10, 1, 2)
	preds := []store.PredictionToScore{
		{ID: 101, HomeScore: 2, AwayScore: 1},
	}
	rs := newFakeResultsStore(m, preds)
	d := &Deps{Results: rs}
	body := `{"home_score":2,"away_score":1}`

	// Run twice
	for i := 0; i < 2; i++ {
		req := adminUser(httptest.NewRequest(http.MethodPut, "/api/admin/matches/10/result", strings.NewReader(body)), 9)
		req = withChiID(req, "10")
		rec := httptest.NewRecorder()
		d.PutAdminMatchResult(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("run %d: status = %d, want 200", i+1, rec.Code)
		}
	}
	// Idempotent: score is SET not incremented
	if rs.scored[101] != [2]int32{5, 0} {
		t.Errorf("idempotent: got %v, want {5,0}", rs.scored[101])
	}
}

func TestPutAdminMatchResult_SetsManualOverride(t *testing.T) {
	m := groupMatch(10, 1, 2)
	rs := newFakeResultsStore(m, nil)
	d := &Deps{Results: rs}
	body := `{"home_score":1,"away_score":0}`
	req := adminUser(httptest.NewRequest(http.MethodPut, "/api/admin/matches/10/result", strings.NewReader(body)), 9)
	req = withChiID(req, "10")
	rec := httptest.NewRecorder()
	d.PutAdminMatchResult(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !rs.manualOverrideSet {
		t.Error("SetMatchManualOverride must be called in the result tx")
	}
}

func TestPutAdminMatchResult_PreservesAPIFixtureID(t *testing.T) {
	existingAPIID := int64(9001)
	m := knockoutMatch(30, 1, 2, &existingAPIID)
	rs := newFakeResultsStore(m, nil)
	d := &Deps{Results: rs}
	// Admin corrects result — the api_fixture_id must pass through unchanged
	body := `{"home_score":2,"away_score":0,"went_to_penalties":false}`
	req := adminUser(httptest.NewRequest(http.MethodPut, "/api/admin/matches/30/result", strings.NewReader(body)), 9)
	req = withChiID(req, "30")
	rec := httptest.NewRecorder()
	d.PutAdminMatchResult(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if len(rs.updated) != 1 {
		t.Fatalf("UpdateMatchResult called %d times, want 1", len(rs.updated))
	}
	got := rs.updated[0].APIFixtureID
	if got == nil || *got != existingAPIID {
		t.Errorf("api_fixture_id = %v, want %d (must be preserved)", got, existingAPIID)
	}
}

func TestPutAdminMatchResult_NotFound404(t *testing.T) {
	rs := &fakeResultsStore{notFound: true, scored: map[int64][2]int32{}}
	d := &Deps{Results: rs}
	body := `{"home_score":1,"away_score":0}`
	req := adminUser(httptest.NewRequest(http.MethodPut, "/api/admin/matches/999/result", strings.NewReader(body)), 9)
	req = withChiID(req, "999")
	rec := httptest.NewRecorder()
	d.PutAdminMatchResult(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestPutAdminMatchResult_NegativeScore400(t *testing.T) {
	m := groupMatch(10, 1, 2)
	rs := newFakeResultsStore(m, nil)
	d := &Deps{Results: rs}
	body := `{"home_score":-1,"away_score":0}`
	req := adminUser(httptest.NewRequest(http.MethodPut, "/api/admin/matches/10/result", strings.NewReader(body)), 9)
	req = withChiID(req, "10")
	rec := httptest.NewRecorder()
	d.PutAdminMatchResult(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestPutAdminMatchResult_PenaltiesOnGroupMatch400(t *testing.T) {
	m := groupMatch(10, 1, 2)
	rs := newFakeResultsStore(m, nil)
	d := &Deps{Results: rs}
	body := `{"home_score":1,"away_score":1,"went_to_penalties":true,"penalty_winner_team_id":1}`
	req := adminUser(httptest.NewRequest(http.MethodPut, "/api/admin/matches/10/result", strings.NewReader(body)), 9)
	req = withChiID(req, "10")
	rec := httptest.NewRecorder()
	d.PutAdminMatchResult(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (group match cannot have penalties)", rec.Code)
	}
}

func TestPutAdminMatchResult_InvalidPenaltyWinner400(t *testing.T) {
	m := knockoutMatch(20, 1, 2, nil)
	rs := newFakeResultsStore(m, nil)
	d := &Deps{Results: rs}
	// winner team 99 is neither home (1) nor away (2)
	body := `{"home_score":1,"away_score":1,"went_to_penalties":true,"penalty_winner_team_id":99}`
	req := adminUser(httptest.NewRequest(http.MethodPut, "/api/admin/matches/20/result", strings.NewReader(body)), 9)
	req = withChiID(req, "20")
	rec := httptest.NewRecorder()
	d.PutAdminMatchResult(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (penalty winner must be home or away)", rec.Code)
	}
}

func TestPutAdminMatchResult_StatusSetToFinal(t *testing.T) {
	m := groupMatch(10, 1, 2)
	rs := newFakeResultsStore(m, nil)
	d := &Deps{Results: rs}
	body := `{"home_score":1,"away_score":0}`
	req := adminUser(httptest.NewRequest(http.MethodPut, "/api/admin/matches/10/result", strings.NewReader(body)), 9)
	req = withChiID(req, "10")
	rec := httptest.NewRecorder()
	d.PutAdminMatchResult(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if len(rs.updated) != 1 || rs.updated[0].Status != store.StatusFinal {
		t.Errorf("match status must be set to final, got %v", rs.updated)
	}
}
