package main

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/config"
	"github.com/sayonetech/worldcup-predictor/backend/internal/fixtures"
	"github.com/sayonetech/worldcup-predictor/backend/internal/sportsapi"
	"github.com/sayonetech/worldcup-predictor/backend/internal/store"

	"github.com/joho/godotenv"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	_ = godotenv.Load() // load backend/.env in dev (matches cmd/server)

	cfg, err := config.Load()
	if err != nil {
		logger.Error("config", "err", err)
		os.Exit(1)
	}
	if cfg.APIFootballKey == "" {
		logger.Error("APIFOOTBALL_KEY is required for seed-fixtures")
		os.Exit(1)
	}

	db, err := store.OpenMySQL(cfg.DSN())
	if err != nil {
		logger.Error("db", "err", err)
		os.Exit(1)
	}
	defer db.Close()

	api := sportsapi.NewHTTPClient(cfg.APIFootballBaseURL, cfg.APIFootballKey)
	if cfg.APIFootballSeason != "" {
		api.Season = cfg.APIFootballSeason
	}
	logger.Info("seeding fixtures", "season", api.Season)

	syncer := &fixtures.Syncer{API: api, Store: store.New(db)}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	res, err := syncer.Run(ctx)
	if err != nil {
		logger.Error("seed-fixtures failed", "err", err)
		os.Exit(1)
	}
	logger.Info("seed-fixtures complete", "teams", res.Teams, "matches", res.Matches)
}
