package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

// fakeAdminUserStore implements store.AdminUserStore for handler tests.
type fakeAdminUserStore struct {
	users        []store.User
	adminCount   int64
	roleByID     map[int64]store.Role
	setRoleCalls []struct {
		id   int64
		role store.Role
	}
}

func (f *fakeAdminUserStore) ListUsers(context.Context) ([]store.User, error) {
	return f.users, nil
}

func (f *fakeAdminUserStore) CountAdmins(context.Context) (int64, error) {
	return f.adminCount, nil
}

func (f *fakeAdminUserStore) GetUserRole(_ context.Context, id int64) (store.Role, error) {
	if f.roleByID == nil {
		return "", store.ErrNotFound
	}
	role, ok := f.roleByID[id]
	if !ok {
		return "", store.ErrNotFound
	}
	return role, nil
}

func (f *fakeAdminUserStore) SetUserRole(_ context.Context, id int64, role store.Role) error {
	f.setRoleCalls = append(f.setRoleCalls, struct {
		id   int64
		role store.Role
	}{id, role})
	return nil
}

// --- TASK 5: Admin user handler tests ---

func TestGetAdminUsers_Returns200(t *testing.T) {
	st := &fakeAdminUserStore{
		users: []store.User{
			{ID: 1, Email: "a@sayonetech.com", Name: "Alice", Role: store.RoleAdmin},
			{ID: 2, Email: "b@sayonetech.com", Name: "Bob", Role: store.RoleUser},
		},
	}
	d := &Deps{AdminUsers: st}
	req := adminUser(httptest.NewRequest(http.MethodGet, "/api/admin/users", nil), 9)
	rec := httptest.NewRecorder()
	d.GetAdminUsers(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got []map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2", len(got))
	}
}

func TestPostUserRole_PromotesToAdmin(t *testing.T) {
	st := &fakeAdminUserStore{
		adminCount: 2,
		roleByID:   map[int64]store.Role{5: store.RoleUser},
	}
	d := &Deps{AdminUsers: st}
	// caller is user 1 (admin), target is user 5
	body := `{"role":"admin"}`
	req := adminUser(httptest.NewRequest(http.MethodPost, "/api/admin/users/5/role", strings.NewReader(body)), 1)
	req = withChiID(req, "5")
	rec := httptest.NewRecorder()
	d.PostUserRole(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if len(st.setRoleCalls) != 1 || st.setRoleCalls[0].id != 5 || st.setRoleCalls[0].role != store.RoleAdmin {
		t.Errorf("SetUserRole calls = %+v", st.setRoleCalls)
	}
}

func TestPostUserRole_CannotDemoteSelf(t *testing.T) {
	st := &fakeAdminUserStore{
		adminCount: 2,
		roleByID:   map[int64]store.Role{1: store.RoleAdmin},
	}
	d := &Deps{AdminUsers: st}
	// caller id=1 trying to demote themselves (target id=1)
	body := `{"role":"user"}`
	req := adminUser(httptest.NewRequest(http.MethodPost, "/api/admin/users/1/role", strings.NewReader(body)), 1)
	req = withChiID(req, "1")
	rec := httptest.NewRecorder()
	d.PostUserRole(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (cannot demote self)", rec.Code)
	}
	if len(st.setRoleCalls) != 0 {
		t.Error("SetUserRole must not be called when demoting self")
	}
}

func TestPostUserRole_CannotDemoteLastAdmin(t *testing.T) {
	// only 1 admin total; caller (id=9) tries to demote the only admin (id=2)
	st := &fakeAdminUserStore{
		adminCount: 1,
		roleByID:   map[int64]store.Role{2: store.RoleAdmin},
	}
	d := &Deps{AdminUsers: st}
	body := `{"role":"user"}`
	req := adminUser(httptest.NewRequest(http.MethodPost, "/api/admin/users/2/role", strings.NewReader(body)), 9)
	req = withChiID(req, "2")
	rec := httptest.NewRecorder()
	d.PostUserRole(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (cannot remove last admin)", rec.Code)
	}
	if len(st.setRoleCalls) != 0 {
		t.Error("SetUserRole must not be called when demoting last admin")
	}
}

func TestPostUserRole_CanDemoteNonLastAdmin(t *testing.T) {
	// 2 admins; demoting one is fine
	st := &fakeAdminUserStore{
		adminCount: 2,
		roleByID:   map[int64]store.Role{2: store.RoleAdmin},
	}
	d := &Deps{AdminUsers: st}
	body := `{"role":"user"}`
	req := adminUser(httptest.NewRequest(http.MethodPost, "/api/admin/users/2/role", strings.NewReader(body)), 9)
	req = withChiID(req, "2")
	rec := httptest.NewRecorder()
	d.PostUserRole(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if len(st.setRoleCalls) != 1 || st.setRoleCalls[0].role != store.RoleUser {
		t.Errorf("SetUserRole calls = %+v", st.setRoleCalls)
	}
}

func TestPostUserRole_UnknownUser404(t *testing.T) {
	st := &fakeAdminUserStore{
		adminCount: 1,
		roleByID:   map[int64]store.Role{}, // id 99 not present
	}
	d := &Deps{AdminUsers: st}
	body := `{"role":"admin"}`
	req := adminUser(httptest.NewRequest(http.MethodPost, "/api/admin/users/99/role", strings.NewReader(body)), 1)
	req = withChiID(req, "99")
	rec := httptest.NewRecorder()
	d.PostUserRole(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestPostUserRole_BadRole400(t *testing.T) {
	st := &fakeAdminUserStore{
		adminCount: 1,
		roleByID:   map[int64]store.Role{5: store.RoleUser},
	}
	d := &Deps{AdminUsers: st}
	body := `{"role":"superuser"}`
	req := adminUser(httptest.NewRequest(http.MethodPost, "/api/admin/users/5/role", strings.NewReader(body)), 1)
	req = withChiID(req, "5")
	rec := httptest.NewRecorder()
	d.PostUserRole(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (bad role)", rec.Code)
	}
}
