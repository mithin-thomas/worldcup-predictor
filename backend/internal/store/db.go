package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/store/sqlc"

	_ "github.com/go-sql-driver/mysql"
)

// OpenMySQL opens and pings a MySQL connection pool.
func OpenMySQL(dsn string) (*sql.DB, error) {
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, fmt.Errorf("store: open: %w", err)
	}
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetMaxOpenConns(10)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("store: ping: %w", err)
	}
	return db, nil
}

// SQLStore adapts the sqlc Queries to the Store interface.
type SQLStore struct {
	db *sql.DB
	q  *sqlc.Queries
}

func New(db *sql.DB) *SQLStore { return &SQLStore{db: db, q: sqlc.New(db)} }

// Compile-time guard: *SQLStore must satisfy the Store interface.
var _ Store = (*SQLStore)(nil)

func (s *SQLStore) UpsertUser(ctx context.Context, p UpsertUserParams) (User, error) {
	role := p.Role
	if role == "" {
		role = RoleUser
	}
	_, err := s.q.UpsertUser(ctx, sqlc.UpsertUserParams{
		Email:     p.Email,
		Name:      p.Name,
		AvatarUrl: p.AvatarURL,
		Role:      sqlc.UsersRole(role),
	})
	if err != nil {
		return User{}, fmt.Errorf("store: upsert: %w", err)
	}
	row, err := s.q.GetUserByEmail(ctx, p.Email)
	if err != nil {
		return User{}, fmt.Errorf("store: get after upsert: %w", err)
	}
	return toUser(row), nil
}

func (s *SQLStore) GetUserByID(ctx context.Context, id int64) (User, error) {
	row, err := s.q.GetUserByID(ctx, id)
	if err != nil {
		return User{}, err
	}
	return toUser(row), nil
}

func (s *SQLStore) SetUserRole(ctx context.Context, id int64, role Role) error {
	if err := s.q.SetUserRole(ctx, sqlc.SetUserRoleParams{Role: sqlc.UsersRole(role), ID: id}); err != nil {
		return fmt.Errorf("store: set user role: %w", err)
	}
	return nil
}

func toUser(r sqlc.User) User {
	return User{
		ID:        r.ID,
		Email:     r.Email,
		Name:      r.Name,
		AvatarURL: r.AvatarUrl,
		Role:      Role(r.Role),
	}
}
