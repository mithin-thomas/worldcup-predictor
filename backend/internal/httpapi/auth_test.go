package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/sayonetech/worldcup-predictor/backend/internal/auth"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

// --- fakes ---

type fakeStore struct {
	users  map[int64]store.User
	nextID int64
}

func newFakeStore() *fakeStore { return &fakeStore{users: map[int64]store.User{}, nextID: 1} }

func (f *fakeStore) UpsertUser(_ context.Context, p store.UpsertUserParams) (store.User, error) {
	for _, u := range f.users {
		if u.Email == p.Email {
			u.Name, u.AvatarURL = p.Name, p.AvatarURL
			f.users[u.ID] = u
			return u, nil
		}
	}
	u := store.User{ID: f.nextID, Email: p.Email, Name: p.Name, AvatarURL: p.AvatarURL, Role: store.RoleUser}
	if p.Role != "" {
		u.Role = p.Role
	}
	f.users[u.ID] = u
	f.nextID++
	return u, nil
}
func (f *fakeStore) GetUserByID(_ context.Context, id int64) (store.User, error) {
	if u, ok := f.users[id]; ok {
		return u, nil
	}
	return store.User{}, errors.New("not found")
}
func (f *fakeStore) SetUserRole(_ context.Context, id int64, role store.Role) error {
	u, ok := f.users[id]
	if !ok {
		return errors.New("not found")
	}
	u.Role = role
	f.users[id] = u
	return nil
}

type fakeVerifier struct {
	claims auth.GoogleClaims
	err    error
}

func (v fakeVerifier) Verify(context.Context, string) (auth.GoogleClaims, error) {
	return v.claims, v.err
}

func newTestDeps(v auth.TokenVerifier) (*Deps, *fakeStore) {
	fs := newFakeStore()
	return &Deps{
		Store:              fs,
		Sessions:           auth.NewSessionManager("test-secret"),
		Verifier:           v,
		AllowedEmailDomain: "sayonetech.com",
		Secure:             false,
	}, fs
}

// --- tests ---

func TestLoginValidDomainSetsCookieAndProvisions(t *testing.T) {
	v := fakeVerifier{claims: auth.GoogleClaims{
		Email: "dev@sayonetech.com", EmailVerified: true, Name: "Dev", HostedDomain: "sayonetech.com",
	}}
	d, fs := newTestDeps(v)
	srv := NewRouter(d, false)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/google", strings.NewReader(`{"id_token":"x"}`))
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("login status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if len(fs.users) != 1 {
		t.Fatalf("provisioned users = %d, want 1", len(fs.users))
	}
	if !strings.Contains(rec.Header().Get("Set-Cookie"), sessionCookieName) {
		t.Fatalf("Set-Cookie missing session cookie: %q", rec.Header().Get("Set-Cookie"))
	}
}

func TestLoginRejectsWrongDomain(t *testing.T) {
	v := fakeVerifier{claims: auth.GoogleClaims{
		Email: "x@gmail.com", EmailVerified: true, HostedDomain: "gmail.com",
	}}
	d, _ := newTestDeps(v)
	srv := NewRouter(d, false)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/google", strings.NewReader(`{"id_token":"x"}`))
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestLoginRejectsInvalidToken(t *testing.T) {
	d, _ := newTestDeps(fakeVerifier{err: errors.New("bad token")})
	srv := NewRouter(d, false)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/google", strings.NewReader(`{"id_token":"x"}`))
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestMeRequiresSession(t *testing.T) {
	d, _ := newTestDeps(fakeVerifier{})
	srv := NewRouter(d, false)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestMeReturnsUserAfterLogin(t *testing.T) {
	v := fakeVerifier{claims: auth.GoogleClaims{
		Email: "dev@sayonetech.com", EmailVerified: true, Name: "Dev", HostedDomain: "sayonetech.com",
	}}
	d, _ := newTestDeps(v)
	srv := NewRouter(d, false)

	loginRec := httptest.NewRecorder()
	loginReq := httptest.NewRequest(http.MethodPost, "/api/auth/google", strings.NewReader(`{"id_token":"x"}`))
	srv.ServeHTTP(loginRec, loginReq)
	cookie := loginRec.Result().Cookies()[0]

	meRec := httptest.NewRecorder()
	meReq := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	meReq.AddCookie(cookie)
	srv.ServeHTTP(meRec, meReq)

	if meRec.Code != http.StatusOK {
		t.Fatalf("/api/me status = %d, want 200 (body=%s)", meRec.Code, meRec.Body.String())
	}
	if !strings.Contains(meRec.Body.String(), "dev@sayonetech.com") {
		t.Fatalf("/api/me body = %s, want email", meRec.Body.String())
	}
}
