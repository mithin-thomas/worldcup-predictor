package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// fakeSettings implements SettingsProvider for handler tests.
type fakeSettings struct {
	lockAt       time.Time
	lockErr      error
	allData      map[string]string
	allErr       error
	setAllErr    error
	setAllCalled bool
	lastSetAll   map[string]string
}

func (f *fakeSettings) BonusLockAt(_ context.Context) (time.Time, error) {
	return f.lockAt, f.lockErr
}
func (f *fakeSettings) All(_ context.Context) (map[string]string, error) {
	if f.allData != nil {
		return f.allData, f.allErr
	}
	return map[string]string{
		"results_cron":  "0 3,8,13 * * *",
		"weekly_cron":   "30 13 * * 1",
		"bonus_lock_at": "2026-06-28T23:59:00+05:30",
	}, f.allErr
}
func (f *fakeSettings) SetAll(_ context.Context, kv map[string]string) error {
	f.setAllCalled = true
	f.lastSetAll = kv
	return f.setAllErr
}

// fakeRecompute implements RecomputeRunner for handler tests.
type fakeRecompute struct {
	summary any
	err     error
}

func (f *fakeRecompute) Run(_ context.Context) (any, error) {
	return f.summary, f.err
}

// --- GetAdminSettings ---

func TestGetAdminSettings_Returns200WithAllKeys(t *testing.T) {
	fs := &fakeSettings{
		allData: map[string]string{
			"results_cron":  "0 3,8,13 * * *",
			"weekly_cron":   "30 13 * * 1",
			"bonus_lock_at": "2026-06-28T23:59:00+05:30",
		},
	}
	d := &Deps{Settings: fs}
	req := httptest.NewRequest(http.MethodGet, "/api/admin/settings", nil)
	rec := httptest.NewRecorder()
	d.GetAdminSettings(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("keys = %d, want 3", len(got))
	}
	if got["results_cron"] != "0 3,8,13 * * *" {
		t.Errorf("results_cron = %q", got["results_cron"])
	}
	if got["bonus_lock_at"] != "2026-06-28T23:59:00+05:30" {
		t.Errorf("bonus_lock_at = %q", got["bonus_lock_at"])
	}
}

func TestGetAdminSettings_StoreError500(t *testing.T) {
	fs := &fakeSettings{allErr: errors.New("db down")}
	d := &Deps{Settings: fs}
	req := httptest.NewRequest(http.MethodGet, "/api/admin/settings", nil)
	rec := httptest.NewRecorder()
	d.GetAdminSettings(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
}

// --- PutAdminSettings ---

func TestPutAdminSettings_ValidCron_Returns200AndCallsSetAll(t *testing.T) {
	fs := &fakeSettings{}
	d := &Deps{Settings: fs}
	body := `{"results_cron":"0 4 * * *","weekly_cron":"0 14 * * 1"}`
	req := httptest.NewRequest(http.MethodPut, "/api/admin/settings", strings.NewReader(body))
	rec := httptest.NewRecorder()
	d.PutAdminSettings(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if !fs.setAllCalled {
		t.Error("SetAll must be called for valid settings")
	}
}

func TestPutAdminSettings_ValidBonusLockAt_Returns200(t *testing.T) {
	fs := &fakeSettings{}
	d := &Deps{Settings: fs}
	body := `{"bonus_lock_at":"2026-07-15T00:00:00Z"}`
	req := httptest.NewRequest(http.MethodPut, "/api/admin/settings", strings.NewReader(body))
	rec := httptest.NewRecorder()
	d.PutAdminSettings(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if !fs.setAllCalled {
		t.Error("SetAll must be called")
	}
}

func TestPutAdminSettings_BadCron_Returns400_SetAllNotCalled(t *testing.T) {
	fs := &fakeSettings{}
	d := &Deps{Settings: fs}
	body := `{"results_cron":"not a cron"}`
	req := httptest.NewRequest(http.MethodPut, "/api/admin/settings", strings.NewReader(body))
	rec := httptest.NewRecorder()
	d.PutAdminSettings(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if fs.setAllCalled {
		t.Error("SetAll must NOT be called when validation fails")
	}
}

func TestPutAdminSettings_BadTimestamp_Returns400_SetAllNotCalled(t *testing.T) {
	fs := &fakeSettings{}
	d := &Deps{Settings: fs}
	body := `{"bonus_lock_at":"28-06-2026"}`
	req := httptest.NewRequest(http.MethodPut, "/api/admin/settings", strings.NewReader(body))
	rec := httptest.NewRecorder()
	d.PutAdminSettings(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if fs.setAllCalled {
		t.Error("SetAll must NOT be called when validation fails")
	}
}

func TestPutAdminSettings_UnknownKey_Returns400_SetAllNotCalled(t *testing.T) {
	fs := &fakeSettings{}
	d := &Deps{Settings: fs}
	body := `{"not_a_real_key":"value"}`
	req := httptest.NewRequest(http.MethodPut, "/api/admin/settings", strings.NewReader(body))
	rec := httptest.NewRecorder()
	d.PutAdminSettings(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if fs.setAllCalled {
		t.Error("SetAll must NOT be called for unknown key")
	}
}

func TestPutAdminSettings_EmptyBody_Returns400(t *testing.T) {
	fs := &fakeSettings{}
	d := &Deps{Settings: fs}
	req := httptest.NewRequest(http.MethodPut, "/api/admin/settings", strings.NewReader(`{}`))
	rec := httptest.NewRecorder()
	d.PutAdminSettings(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for empty body", rec.Code)
	}
	if fs.setAllCalled {
		t.Error("SetAll must NOT be called for empty body")
	}
}

func TestPutAdminSettings_InvalidJSON_Returns400(t *testing.T) {
	fs := &fakeSettings{}
	d := &Deps{Settings: fs}
	req := httptest.NewRequest(http.MethodPut, "/api/admin/settings", strings.NewReader(`not json`))
	rec := httptest.NewRecorder()
	d.PutAdminSettings(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestPutAdminSettings_StoreError_Returns500(t *testing.T) {
	fs := &fakeSettings{setAllErr: errors.New("db down")}
	d := &Deps{Settings: fs}
	body := `{"results_cron":"0 4 * * *"}`
	req := httptest.NewRequest(http.MethodPut, "/api/admin/settings", strings.NewReader(body))
	rec := httptest.NewRecorder()
	d.PutAdminSettings(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 for store error", rec.Code)
	}
}

// --- PostRecompute ---

func TestPostRecompute_Returns200WithSummary(t *testing.T) {
	type recomputeSummary struct {
		MatchesRescored    int `json:"matches_rescored"`
		PredictionsUpdated int `json:"predictions_updated"`
		BonusUpdated       int `json:"bonus_updated"`
	}
	fr := &fakeRecompute{summary: recomputeSummary{MatchesRescored: 4, PredictionsUpdated: 12, BonusUpdated: 3}}
	d := &Deps{Recompute: fr}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/recompute", nil)
	rec := httptest.NewRecorder()
	d.PostRecompute(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var got recomputeSummary
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.MatchesRescored != 4 || got.PredictionsUpdated != 12 || got.BonusUpdated != 3 {
		t.Errorf("summary = %+v, want {4 12 3}", got)
	}
}

func TestPostRecompute_RunError_Returns500(t *testing.T) {
	fr := &fakeRecompute{err: errors.New("store down")}
	d := &Deps{Recompute: fr}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/recompute", nil)
	rec := httptest.NewRecorder()
	d.PostRecompute(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
}
