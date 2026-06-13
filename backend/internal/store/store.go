// Package store provides DB access. Handlers depend on the Store interface
// so they can be tested against a fake without a live MySQL.
package store

import "context"

type Role string

const (
	RoleUser  Role = "user"
	RoleAdmin Role = "admin"
)

type User struct {
	ID        int64
	Email     string
	Name      string
	AvatarURL string
	Role      Role
}

// UpsertUserParams carries the verified Google profile for provisioning.
type UpsertUserParams struct {
	Email     string
	Name      string
	AvatarURL string
	Role      Role // role applied only on first insert (seed admins)
}

type Store interface {
	// UpsertUser provisions or refreshes a user by email and returns the row.
	UpsertUser(ctx context.Context, p UpsertUserParams) (User, error)
	GetUserByID(ctx context.Context, id int64) (User, error)
	SetUserRole(ctx context.Context, id int64, role Role) error
}
