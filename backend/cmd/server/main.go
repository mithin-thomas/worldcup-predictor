package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/auth"
	"github.com/sayonetech/worldcup-predictor/backend/internal/config"
	"github.com/sayonetech/worldcup-predictor/backend/internal/httpapi"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		logger.Error("config", "err", err)
		os.Exit(1)
	}

	db, err := store.OpenMySQL(cfg.DSN())
	if err != nil {
		logger.Error("db", "err", err)
		os.Exit(1)
	}
	defer db.Close()

	st := store.New(db)
	seedAdmins(context.Background(), st, cfg.SeedAdminEmails, logger)

	deps := &httpapi.Deps{
		Store:              st,
		Sessions:           auth.NewSessionManager(cfg.SessionSecret),
		Verifier:           auth.GoogleTokenVerifier{ClientID: cfg.GoogleClientID},
		AllowedEmailDomain: cfg.AllowedEmailDomain,
		Secure:             cfg.IsProduction(),
	}

	router := httpapi.NewRouter(deps, !cfg.IsProduction())

	srv := &http.Server{
		Addr:              ":" + cfg.HTTPPort,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	logger.Info("listening", "port", cfg.HTTPPort, "env", cfg.AppEnv)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("server", "err", err)
		os.Exit(1)
	}
}

// seedAdmins promotes any already-existing user in the seed list to admin and
// pre-creates the rows so the first login of a seed admin is already elevated.
func seedAdmins(ctx context.Context, st store.Store, emails []string, logger *slog.Logger) {
	for _, email := range emails {
		u, err := st.UpsertUser(ctx, store.UpsertUserParams{Email: email, Role: store.RoleAdmin})
		if err != nil {
			logger.Warn("seed admin failed", "email", email, "err", err)
			continue
		}
		if u.Role != store.RoleAdmin {
			if err := st.SetUserRole(ctx, u.ID, store.RoleAdmin); err != nil {
				logger.Warn("promote seed admin failed", "email", email, "err", err)
			}
		}
	}
}
