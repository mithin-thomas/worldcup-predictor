package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/auth"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

type fakeJobRunner struct{ called int }

func (f *fakeJobRunner) RunResultsIngest(context.Context) (any, error) {
	f.called++
	return map[string]int{"updated": 1}, nil
}

func (f *fakeJobRunner) RunWeeklyWinner(context.Context) (any, error) {
	f.called++
	return map[string]int{"winners": 1}, nil
}

func adminJobsDeps(t *testing.T, role store.Role) (*Deps, *http.Cookie, *fakeJobRunner) {
	t.Helper()
	fs := newFakeStore()
	u, _ := fs.UpsertUser(context.Background(), store.UpsertUserParams{Email: "a@sayonetech.com", Role: role})
	if role == store.RoleAdmin {
		_ = fs.SetUserRole(context.Background(), u.ID, store.RoleAdmin)
	}
	sm := auth.NewSessionManager("test-secret")
	jr := &fakeJobRunner{}
	d := &Deps{Store: fs, Sessions: sm, JobRunner: jr}
	return d, &http.Cookie{Name: sessionCookieName, Value: sm.Encode(auth.Session{UserID: u.ID}, time.Hour)}, jr
}

func postJob(t *testing.T, d *Deps, debug bool, cookie *http.Cookie, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/admin/jobs/run", strings.NewReader(body))
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	NewRouter(d, debug).ServeHTTP(rec, req)
	return rec
}

func TestRunJobAdminTriggersIngest(t *testing.T) {
	d, cookie, jr := adminJobsDeps(t, store.RoleAdmin)
	rec := postJob(t, d, true, cookie, `{"job":"results-ingest"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if jr.called != 1 {
		t.Fatalf("ingest called %d times, want 1", jr.called)
	}
}

func TestRunJobNonAdminForbidden(t *testing.T) {
	d, cookie, jr := adminJobsDeps(t, store.RoleUser)
	rec := postJob(t, d, true, cookie, `{"job":"results-ingest"}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if jr.called != 0 {
		t.Fatal("non-admin must not run the job")
	}
}

func TestRunJobUnknownJob400(t *testing.T) {
	d, cookie, _ := adminJobsDeps(t, store.RoleAdmin)
	for _, body := range []string{`{"job":"nope"}`} {
		rec := postJob(t, d, true, cookie, body)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("body %s: status = %d, want 400", body, rec.Code)
		}
	}
}

func TestRunJobWeeklyWinner(t *testing.T) {
	d, cookie, jr := adminJobsDeps(t, store.RoleAdmin)
	rec := postJob(t, d, true, cookie, `{"job":"weekly-winner"}`)
	if rec.Code != http.StatusOK || jr.called == 0 {
		t.Fatalf("status=%d called=%d", rec.Code, jr.called)
	}
}

func TestRunJobNilRunnerUnavailable(t *testing.T) {
	d, cookie, _ := adminJobsDeps(t, store.RoleAdmin)
	d.JobRunner = nil // simulate a keyless dev boot (route registered, runner not wired)
	rec := postJob(t, d, true, cookie, `{"job":"results-ingest"}`)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
}

func TestRunJobAbsentInProduction(t *testing.T) {
	d, cookie, _ := adminJobsDeps(t, store.RoleAdmin)
	rec := postJob(t, d, false, cookie, `{"job":"results-ingest"}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (route absent in prod)", rec.Code)
	}
}
