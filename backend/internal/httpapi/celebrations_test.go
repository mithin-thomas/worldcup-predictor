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

type fakeCelebrationStore struct {
	pending  []store.Celebration
	seenArgs []int64
	seenUser int64
}

func (f *fakeCelebrationStore) ListPendingCelebrations(_ context.Context, _ int64) ([]store.Celebration, error) {
	return f.pending, nil
}
func (f *fakeCelebrationStore) MarkCelebrationsSeen(_ context.Context, userID int64, matchIDs []int64) error {
	f.seenUser = userID
	f.seenArgs = append(f.seenArgs, matchIDs...)
	return nil
}

func celebDeps(t *testing.T) (*Deps, *http.Cookie, *fakeCelebrationStore) {
	t.Helper()
	fs := newFakeStore()
	u, _ := fs.UpsertUser(context.Background(), store.UpsertUserParams{Email: "a@sayonetech.com", Role: store.RoleUser})
	sm := auth.NewSessionManager("test-secret")
	cs := &fakeCelebrationStore{}
	d := &Deps{Store: fs, Sessions: sm, Celebrations: cs}
	cookie := &http.Cookie{Name: sessionCookieName, Value: sm.Encode(auth.Session{UserID: u.ID}, time.Hour)}
	return d, cookie, cs
}

func TestGetCelebrations(t *testing.T) {
	d, cookie, cs := celebDeps(t)
	cs.pending = []store.Celebration{{MatchID: 12, TeamCode: "BRA", TeamScore: 3, OpponentCode: "JOR", OpponentScore: 1, KickoffUTC: time.Now().UTC()}}
	req := httptest.NewRequest(http.MethodGet, "/api/celebrations", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	NewRouter(d, false).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"match_id":12`) || !strings.Contains(rec.Body.String(), `"team_code":"BRA"`) {
		t.Fatalf("body missing celebration: %s", rec.Body.String())
	}
}

func TestGetCelebrationsRequiresAuth(t *testing.T) {
	d, _, _ := celebDeps(t)
	req := httptest.NewRequest(http.MethodGet, "/api/celebrations", nil)
	rec := httptest.NewRecorder()
	NewRouter(d, false).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestPostCelebrationsSeen(t *testing.T) {
	d, cookie, cs := celebDeps(t)
	req := httptest.NewRequest(http.MethodPost, "/api/celebrations/seen", strings.NewReader(`{"match_ids":[12,9]}`))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	NewRouter(d, false).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if len(cs.seenArgs) != 2 || cs.seenArgs[0] != 12 || cs.seenArgs[1] != 9 {
		t.Fatalf("seenArgs = %v, want [12 9]", cs.seenArgs)
	}
}

func TestPostCelebrationsSeenBadBody(t *testing.T) {
	d, cookie, _ := celebDeps(t)
	for _, body := range []string{`not json`, `{"match_ids":[]}`} {
		req := httptest.NewRequest(http.MethodPost, "/api/celebrations/seen", strings.NewReader(body))
		req.AddCookie(cookie)
		rec := httptest.NewRecorder()
		NewRouter(d, false).ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("body %q: status = %d, want 400", body, rec.Code)
		}
	}
}
