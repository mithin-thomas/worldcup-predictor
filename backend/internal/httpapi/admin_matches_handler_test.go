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

// fakeAdminMatchStore implements store.AdminMatchStore for handler tests.
type fakeAdminMatchStore struct {
	// team existence control
	teamOK bool
	// create result
	createID int64
	created  bool
	// delete result
	deleted bool
	// match exists result
	matchOK bool
	// records
	lastCreate store.CreateMatchParams
	lastUpdate store.UpdateMatchDetailParams
	lastDelete int64
}

func (f *fakeAdminMatchStore) ListMatchesForAdmin(_ context.Context) ([]store.AdminMatch, error) {
	return []store.AdminMatch{
		{
			ID:             1,
			MatchNumber:    1,
			Stage:          "group",
			Round:          "Group A",
			HomeTeamID:     ptr64(10),
			HomeTeam:       "Brazil",
			AwayTeamID:     ptr64(20),
			AwayTeam:       "France",
			KickoffUTC:     time.Date(2026, 6, 20, 18, 0, 0, 0, time.UTC),
			Status:         "scheduled",
			ManualOverride: true,
		},
	}, nil
}

func (f *fakeAdminMatchStore) CreateMatch(_ context.Context, p store.CreateMatchParams) (int64, error) {
	f.created = true
	f.lastCreate = p
	return f.createID, nil
}

func (f *fakeAdminMatchStore) UpdateMatchDetail(_ context.Context, p store.UpdateMatchDetailParams) error {
	f.lastUpdate = p
	return nil
}

func (f *fakeAdminMatchStore) DeleteMatch(_ context.Context, id int64) (bool, error) {
	f.lastDelete = id
	return f.deleted, nil
}

func (f *fakeAdminMatchStore) MatchExists(_ context.Context, id int64) (bool, error) {
	return f.matchOK, nil
}

func (f *fakeAdminMatchStore) TeamExists(_ context.Context, _ int64) (bool, error) {
	return f.teamOK, nil
}

func ptr64(v int64) *int64 { return &v }

// adminUser returns an admin user injected into request context.
func adminUser(req *http.Request, id int64) *http.Request {
	u := store.User{ID: id, Role: store.RoleAdmin}
	return req.WithContext(context.WithValue(req.Context(), userCtxKey, u))
}

// --- TASK 3: Admin Match CRUD tests ---

func TestGetAdminMatches_Returns200WithList(t *testing.T) {
	st := &fakeAdminMatchStore{teamOK: true}
	d := &Deps{AdminMatches: st}
	req := adminUser(httptest.NewRequest(http.MethodGet, "/api/admin/matches", nil), 1)
	rec := httptest.NewRecorder()
	d.GetAdminMatches(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got []map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
}

func TestPostAdminMatch_Creates201(t *testing.T) {
	st := &fakeAdminMatchStore{teamOK: true, createID: 77}
	d := &Deps{AdminMatches: st}
	body := `{"home_team_id":1,"away_team_id":2,"kickoff_utc":"2026-06-20T18:00:00Z","stage":"group","round":"Group A"}`
	req := adminUser(httptest.NewRequest(http.MethodPost, "/api/admin/matches", strings.NewReader(body)), 1)
	rec := httptest.NewRecorder()
	d.PostAdminMatch(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (%s)", rec.Code, rec.Body.String())
	}
	if !st.created {
		t.Error("CreateMatch not called")
	}
	var got map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&got)
	if got["id"] == nil {
		t.Error("response must include id")
	}
}

func TestPostAdminMatch_SameTeams400(t *testing.T) {
	st := &fakeAdminMatchStore{teamOK: true, createID: 1}
	d := &Deps{AdminMatches: st}
	body := `{"home_team_id":5,"away_team_id":5,"kickoff_utc":"2026-06-20T18:00:00Z","stage":"group"}`
	req := adminUser(httptest.NewRequest(http.MethodPost, "/api/admin/matches", strings.NewReader(body)), 1)
	rec := httptest.NewRecorder()
	d.PostAdminMatch(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if st.created {
		t.Error("CreateMatch must not be called when teams are the same")
	}
}

func TestPostAdminMatch_BadStage400(t *testing.T) {
	st := &fakeAdminMatchStore{teamOK: true, createID: 1}
	d := &Deps{AdminMatches: st}
	body := `{"home_team_id":1,"away_team_id":2,"kickoff_utc":"2026-06-20T18:00:00Z","stage":"semifinal"}`
	req := adminUser(httptest.NewRequest(http.MethodPost, "/api/admin/matches", strings.NewReader(body)), 1)
	rec := httptest.NewRecorder()
	d.PostAdminMatch(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if st.created {
		t.Error("CreateMatch must not be called with invalid stage")
	}
}

func TestPostAdminMatch_BadKickoff400(t *testing.T) {
	st := &fakeAdminMatchStore{teamOK: true, createID: 1}
	d := &Deps{AdminMatches: st}
	body := `{"home_team_id":1,"away_team_id":2,"kickoff_utc":"not-a-date","stage":"group"}`
	req := adminUser(httptest.NewRequest(http.MethodPost, "/api/admin/matches", strings.NewReader(body)), 1)
	rec := httptest.NewRecorder()
	d.PostAdminMatch(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if st.created {
		t.Error("CreateMatch must not be called with invalid kickoff_utc")
	}
}

func TestPostAdminMatch_UnknownTeam400(t *testing.T) {
	st := &fakeAdminMatchStore{teamOK: false, createID: 1}
	d := &Deps{AdminMatches: st}
	body := `{"home_team_id":999,"away_team_id":2,"kickoff_utc":"2026-06-20T18:00:00Z","stage":"group"}`
	req := adminUser(httptest.NewRequest(http.MethodPost, "/api/admin/matches", strings.NewReader(body)), 1)
	rec := httptest.NewRecorder()
	d.PostAdminMatch(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if st.created {
		t.Error("CreateMatch must not be called with unknown team")
	}
}

func TestDeleteAdminMatch_204(t *testing.T) {
	st := &fakeAdminMatchStore{deleted: true}
	d := &Deps{AdminMatches: st}
	req := adminUser(httptest.NewRequest(http.MethodDelete, "/api/admin/matches/42", nil), 1)

	// inject chi route context
	// inject chi route context directly so we can call the handler without a router
	req = withChiID(req, "42")
	rec := httptest.NewRecorder()
	d.DeleteAdminMatch(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204 (%s)", rec.Code, rec.Body.String())
	}
}

func TestDeleteAdminMatch_NotFound404(t *testing.T) {
	st := &fakeAdminMatchStore{deleted: false}
	d := &Deps{AdminMatches: st}
	req := adminUser(httptest.NewRequest(http.MethodDelete, "/api/admin/matches/99", nil), 1)
	req = withChiID(req, "99")
	rec := httptest.NewRecorder()
	d.DeleteAdminMatch(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestPutAdminMatch_EditMissing404(t *testing.T) {
	st := &fakeAdminMatchStore{teamOK: true, matchOK: false}
	d := &Deps{AdminMatches: st}
	body := `{"home_team_id":1,"away_team_id":2,"kickoff_utc":"2026-06-20T18:00:00Z","stage":"group"}`
	req := adminUser(httptest.NewRequest(http.MethodPut, "/api/admin/matches/99", strings.NewReader(body)), 1)
	req = withChiID(req, "99")
	rec := httptest.NewRecorder()
	d.PutAdminMatch(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestPutAdminMatch_EditUpdates200(t *testing.T) {
	st := &fakeAdminMatchStore{teamOK: true, matchOK: true}
	d := &Deps{AdminMatches: st}
	body := `{"home_team_id":1,"away_team_id":2,"kickoff_utc":"2026-06-20T18:00:00Z","stage":"knockout","round":"QF"}`
	req := adminUser(httptest.NewRequest(http.MethodPut, "/api/admin/matches/7", strings.NewReader(body)), 1)
	req = withChiID(req, "7")
	rec := httptest.NewRecorder()
	d.PutAdminMatch(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if st.lastUpdate.ID != 7 {
		t.Errorf("UpdateMatchDetail called with ID %d, want 7", st.lastUpdate.ID)
	}
}

// withChiID injects a chi route context with the given id param.
func withChiID(req *http.Request, id string) *http.Request {
	return injectChiParam(req, "id", id)
}
