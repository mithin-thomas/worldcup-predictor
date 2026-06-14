package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

// fakeBonusStore implements store.BonusStore for handler tests.
type fakeBonusStore struct {
	picks   []store.BonusPick
	upserts []struct {
		cat string
		ref int64
	}
	teamOK       bool
	playerOK     bool
	resultsSaved int
}

func (f *fakeBonusStore) UpsertBonusPrediction(_ context.Context, _ int64, cat string, ref int64) error {
	f.upserts = append(f.upserts, struct {
		cat string
		ref int64
	}{cat, ref})
	return nil
}
func (f *fakeBonusStore) UpsertBonusPredictions(_ context.Context, _ int64, picks []store.BonusPickWrite) error {
	for _, p := range picks {
		f.upserts = append(f.upserts, struct {
			cat string
			ref int64
		}{p.Category, p.RefID})
	}
	return nil
}
func (f *fakeBonusStore) ListBonusPredictionsForUser(context.Context, int64) ([]store.BonusPick, error) {
	return f.picks, nil
}
func (f *fakeBonusStore) UpsertBonusResult(context.Context, string, int64) error {
	f.resultsSaved++
	return nil
}
func (f *fakeBonusStore) ListBonusResults(context.Context) ([]store.BonusResult, error) {
	return nil, nil
}
func (f *fakeBonusStore) ListAllBonusPredictions(context.Context) ([]store.BonusPredictionRow, error) {
	return nil, nil
}
func (f *fakeBonusStore) SetBonusPredictionPoints(context.Context, int64, int64) error { return nil }
func (f *fakeBonusStore) TeamExists(context.Context, int64) (bool, error)              { return f.teamOK, nil }
func (f *fakeBonusStore) PlayerExists(context.Context, int64) (bool, error)            { return f.playerOK, nil }

// fakePlayerStore implements store.PlayerStore for picker tests.
type fakePlayerStore struct {
	teams   []store.TeamOption
	players []store.PlayerOption
}

func (f *fakePlayerStore) ListTeamsForPicker(context.Context) ([]store.TeamOption, error) {
	return f.teams, nil
}
func (f *fakePlayerStore) SearchPlayers(_ context.Context, _ string) ([]store.PlayerOption, error) {
	return f.players, nil
}

// ctxUser injects a store.User into the request context (simulates RequireAuth).
func ctxUser(req *http.Request, id int64) *http.Request {
	return req.WithContext(context.WithValue(req.Context(), userCtxKey, store.User{ID: id}))
}

func TestPutBonus_BeforeLockUpserts(t *testing.T) {
	old := now
	now = func() time.Time { return time.Date(2026, 6, 20, 0, 0, 0, 0, time.UTC) }
	t.Cleanup(func() { now = old })

	st := &fakeBonusStore{teamOK: true, playerOK: true}
	d := &Deps{Bonus: st, BonusLockAt: time.Date(2026, 6, 28, 18, 29, 0, 0, time.UTC)} // 23:59 IST
	body := `{"picks":[{"category":"winner","ref_id":9},{"category":"golden_boot","ref_id":42}]}`
	req := ctxUser(httptest.NewRequest(http.MethodPut, "/api/bonus", strings.NewReader(body)), 1)
	rec := httptest.NewRecorder()
	d.PutBonus(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if len(st.upserts) != 2 {
		t.Fatalf("upserts = %d, want 2", len(st.upserts))
	}
}

func TestPutBonus_AfterLockRejected(t *testing.T) {
	old := now
	now = func() time.Time { return time.Date(2026, 6, 29, 0, 0, 0, 0, time.UTC) }
	t.Cleanup(func() { now = old })

	st := &fakeBonusStore{teamOK: true, playerOK: true}
	d := &Deps{Bonus: st, BonusLockAt: time.Date(2026, 6, 28, 18, 29, 0, 0, time.UTC)}
	req := ctxUser(httptest.NewRequest(http.MethodPut, "/api/bonus", strings.NewReader(`{"picks":[{"category":"winner","ref_id":9}]}`)), 1)
	rec := httptest.NewRecorder()
	d.PutBonus(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if len(st.upserts) != 0 {
		t.Errorf("must not write after lock; got %d upserts", len(st.upserts))
	}
}

func TestPutBonus_AtExactLockBoundaryRejected(t *testing.T) {
	old := now
	// Exactly at lock time: now == BonusLockAt → !now().Before(lockAt) → rejected
	lockAt := time.Date(2026, 6, 28, 18, 29, 0, 0, time.UTC)
	now = func() time.Time { return lockAt }
	t.Cleanup(func() { now = old })

	st := &fakeBonusStore{teamOK: true, playerOK: true}
	d := &Deps{Bonus: st, BonusLockAt: lockAt}
	req := ctxUser(httptest.NewRequest(http.MethodPut, "/api/bonus", strings.NewReader(`{"picks":[{"category":"winner","ref_id":9}]}`)), 1)
	rec := httptest.NewRecorder()
	d.PutBonus(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 at exact boundary", rec.Code)
	}
}

func TestPutBonus_WrongRefType(t *testing.T) {
	old := now
	now = func() time.Time { return time.Date(2026, 6, 20, 0, 0, 0, 0, time.UTC) }
	t.Cleanup(func() { now = old })
	// team category but the team doesn't exist (teamOK=false) -> 400
	st := &fakeBonusStore{teamOK: false, playerOK: true}
	d := &Deps{Bonus: st, BonusLockAt: time.Date(2026, 6, 28, 18, 29, 0, 0, time.UTC)}
	req := ctxUser(httptest.NewRequest(http.MethodPut, "/api/bonus", strings.NewReader(`{"picks":[{"category":"winner","ref_id":999}]}`)), 1)
	rec := httptest.NewRecorder()
	d.PutBonus(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestPutBonus_UnknownCategory(t *testing.T) {
	old := now
	now = func() time.Time { return time.Date(2026, 6, 20, 0, 0, 0, 0, time.UTC) }
	t.Cleanup(func() { now = old })
	d := &Deps{Bonus: &fakeBonusStore{teamOK: true, playerOK: true}, BonusLockAt: time.Date(2026, 6, 28, 18, 29, 0, 0, time.UTC)}
	req := ctxUser(httptest.NewRequest(http.MethodPut, "/api/bonus", strings.NewReader(`{"picks":[{"category":"most_assists","ref_id":1}]}`)), 1)
	rec := httptest.NewRecorder()
	d.PutBonus(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestGetBonus_ReturnsLockState(t *testing.T) {
	old := now
	now = func() time.Time { return time.Date(2026, 6, 20, 0, 0, 0, 0, time.UTC) }
	t.Cleanup(func() { now = old })
	st := &fakeBonusStore{picks: []store.BonusPick{{Category: "winner", RefID: 9}}}
	d := &Deps{Bonus: st, BonusLockAt: time.Date(2026, 6, 28, 18, 29, 0, 0, time.UTC)}
	req := ctxUser(httptest.NewRequest(http.MethodGet, "/api/bonus", nil), 1)
	rec := httptest.NewRecorder()
	d.GetBonus(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got struct {
		Locked bool `json:"locked"`
		Picks  []struct {
			Category string `json:"category"`
			RefID    int64  `json:"ref_id"`
		} `json:"picks"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&got)
	if got.Locked {
		t.Error("should not be locked on 20 Jun")
	}
	if len(got.Picks) != 1 || got.Picks[0].Category != "winner" {
		t.Errorf("picks = %+v", got.Picks)
	}
}

func TestGetBonus_LockedAfterLockAt(t *testing.T) {
	old := now
	now = func() time.Time { return time.Date(2026, 6, 29, 0, 0, 0, 0, time.UTC) }
	t.Cleanup(func() { now = old })
	st := &fakeBonusStore{picks: []store.BonusPick{{Category: "runner_up", RefID: 5}}}
	d := &Deps{Bonus: st, BonusLockAt: time.Date(2026, 6, 28, 18, 29, 0, 0, time.UTC)}
	req := ctxUser(httptest.NewRequest(http.MethodGet, "/api/bonus", nil), 1)
	rec := httptest.NewRecorder()
	d.GetBonus(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got struct {
		Locked bool `json:"locked"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&got)
	if !got.Locked {
		t.Error("should be locked on 29 Jun")
	}
}

func TestPutBonusResults_ValidSaves(t *testing.T) {
	st := &fakeBonusStore{teamOK: true, playerOK: true}
	d := &Deps{Bonus: st}
	body := `{"results":[{"category":"winner","ref_id":9},{"category":"golden_boot","ref_id":42}]}`
	req := ctxUser(httptest.NewRequest(http.MethodPut, "/api/admin/bonus/results", strings.NewReader(body)), 1)
	rec := httptest.NewRecorder()
	d.PutBonusResults(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if st.resultsSaved != 2 {
		t.Errorf("resultsSaved = %d, want 2", st.resultsSaved)
	}
}

func TestPutBonusResults_BadSecondEntryWritesNothing(t *testing.T) {
	// validate-all-then-write: the 2nd entry is an unknown category, so the whole
	// batch is rejected (400) and NO outcome is written.
	st := &fakeBonusStore{teamOK: true, playerOK: true}
	d := &Deps{Bonus: st}
	body := `{"results":[{"category":"winner","ref_id":9},{"category":"most_assists","ref_id":1}]}`
	req := ctxUser(httptest.NewRequest(http.MethodPut, "/api/admin/bonus/results", strings.NewReader(body)), 1)
	rec := httptest.NewRecorder()
	d.PutBonusResults(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if st.resultsSaved != 0 {
		t.Errorf("must write nothing on a rejected batch; got %d", st.resultsSaved)
	}
}

func TestGetTeams_Returns200(t *testing.T) {
	fp := &fakePlayerStore{
		teams: []store.TeamOption{
			{ID: 1, Name: "Brazil", Code: "BRA"},
			{ID: 2, Name: "France", Code: "FRA"},
		},
	}
	d := &Deps{Players: fp}
	req := ctxUser(httptest.NewRequest(http.MethodGet, "/api/teams", nil), 1)
	rec := httptest.NewRecorder()
	d.GetTeams(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got []map[string]interface{}
	_ = json.NewDecoder(rec.Body).Decode(&got)
	if len(got) != 2 {
		t.Fatalf("teams count = %d, want 2", len(got))
	}
}

func TestGetPlayers_Returns200(t *testing.T) {
	fp := &fakePlayerStore{
		players: []store.PlayerOption{
			{ID: 10, Name: "Messi", Position: "Forward", TeamCode: "ARG"},
		},
	}
	d := &Deps{Players: fp}
	req := ctxUser(httptest.NewRequest(http.MethodGet, "/api/players?q=mes", nil), 1)
	rec := httptest.NewRecorder()
	d.GetPlayers(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got []map[string]interface{}
	_ = json.NewDecoder(rec.Body).Decode(&got)
	if len(got) != 1 {
		t.Fatalf("players count = %d, want 1", len(got))
	}
}
