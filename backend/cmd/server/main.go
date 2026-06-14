package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/auth"
	"github.com/sayonetech/worldcup-predictor/backend/internal/config"
	"github.com/sayonetech/worldcup-predictor/backend/internal/httpapi"
	"github.com/sayonetech/worldcup-predictor/backend/internal/jobs"
	"github.com/sayonetech/worldcup-predictor/backend/internal/sportsapi"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"

	"github.com/joho/godotenv"
	"github.com/robfig/cron/v3"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	// Load .env for local dev. godotenv does not override variables already set
	// in the real environment, so production (env-injected) is unaffected and a
	// missing .env file is a no-op.
	_ = godotenv.Load()

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

	weekly := jobs.WeeklyWinner{Store: st, Now: func() time.Time { return time.Now().UTC() }}
	sj := serverJobs{weekly: weekly, bonus: jobs.BonusScore{Store: st}}
	if cfg.FootballDataAPIKey != "" {
		if alias, err := loadAliasFile(cfg.SeedDataDir + "/fd_team_aliases.csv"); err == nil {
			ingest := jobs.ResultsIngest{
				API:   sportsapi.New(cfg.FootballDataBaseURL, cfg.FootballDataAPIKey),
				Store: st,
				Now:   func() time.Time { return time.Now().UTC() },
				Alias: alias,
			}
			sj.ingest = &ingest
		} else {
			logger.Warn("results ingest trigger disabled: alias load", "err", err)
		}
	}
	var jobRunner httpapi.JobRunner = sj

	deps := &httpapi.Deps{
		Store:              st,
		Matches:            st,
		Predictions:        st,
		Leaderboard:        st,
		Bonus:              st,
		Players:            st,
		BonusLockAt:        cfg.BonusLockAt,
		JobRunner:          jobRunner,
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

	// Results-ingest scheduler (in-process). Only runs when an API key is set;
	// local dev without a key still boots.
	scheduler := startResultsCron(cfg, st, logger)
	if scheduler != nil {
		defer scheduler.Stop()
	}

	weeklyScheduler := startWeeklyCron(cfg, weekly, logger)
	if weeklyScheduler != nil {
		defer weeklyScheduler.Stop()
	}

	go func() {
		logger.Info("listening", "port", cfg.HTTPPort, "env", cfg.AppEnv)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	logger.Info("shutting down")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("shutdown", "err", err)
	}
}

// startResultsCron builds the results-ingest job and schedules it on RESULTS_CRON
// (IST). Returns nil (and logs) when no API key is configured.
func startResultsCron(cfg config.Config, st *store.SQLStore, logger *slog.Logger) *cron.Cron {
	if cfg.FootballDataAPIKey == "" {
		logger.Info("results-ingest disabled (no FOOTBALL_DATA_API_KEY)")
		return nil
	}
	alias, err := loadAliasFile(cfg.SeedDataDir + "/fd_team_aliases.csv")
	if err != nil {
		logger.Error("results-ingest disabled: load alias file", "err", err)
		return nil
	}
	job := jobs.ResultsIngest{
		API:   sportsapi.New(cfg.FootballDataBaseURL, cfg.FootballDataAPIKey),
		Store: st,
		Now:   func() time.Time { return time.Now().UTC() },
		Alias: alias,
	}
	loc, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		loc = time.FixedZone("IST", 5*3600+1800)
	}
	c := cron.New(cron.WithLocation(loc))
	if _, err := c.AddFunc(cfg.ResultsCron, func() {
		if _, err := job.Run(context.Background()); err != nil {
			logger.Error("results-ingest run", "err", err)
		}
	}); err != nil {
		logger.Error("results-ingest disabled: bad RESULTS_CRON", "spec", cfg.ResultsCron, "err", err)
		return nil
	}
	c.Start()
	logger.Info("results-ingest scheduled", "cron", cfg.ResultsCron, "tz", loc.String())
	return c
}

// startWeeklyCron schedules the weekly-winner job on WEEKLY_CRON (IST). It needs
// no external API, so it always runs.
func startWeeklyCron(cfg config.Config, job jobs.WeeklyWinner, logger *slog.Logger) *cron.Cron {
	loc, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		loc = time.FixedZone("IST", 5*3600+1800)
	}
	c := cron.New(cron.WithLocation(loc))
	if _, err := c.AddFunc(cfg.WeeklyCron, func() {
		if _, err := job.Run(context.Background()); err != nil {
			logger.Error("weekly-winner run", "err", err)
		}
	}); err != nil {
		logger.Error("weekly-winner disabled: bad WEEKLY_CRON", "spec", cfg.WeeklyCron, "err", err)
		return nil
	}
	c.Start()
	logger.Info("weekly-winner scheduled", "cron", cfg.WeeklyCron, "tz", loc.String())
	return c
}

// loadAliasFile opens + parses the fd-team-id alias CSV.
func loadAliasFile(path string) (map[int64]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return jobs.LoadAliases(f)
}

// serverJobs adapts the background jobs to httpapi.JobRunner. ingest is nil when
// no results API key is configured; weekly-winner and bonus-score always work
// (no external API).
type serverJobs struct {
	ingest *jobs.ResultsIngest
	weekly jobs.WeeklyWinner
	bonus  jobs.BonusScore
}

func (s serverJobs) RunResultsIngest(ctx context.Context) (any, error) {
	if s.ingest == nil {
		return nil, errors.New("results ingest not configured (no FOOTBALL_DATA_API_KEY)")
	}
	return s.ingest.Run(ctx)
}

func (s serverJobs) RunWeeklyWinner(ctx context.Context) (any, error) {
	return s.weekly.Run(ctx)
}

func (s serverJobs) RunBonusScore(ctx context.Context) (any, error) {
	return s.bonus.Run(ctx)
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
