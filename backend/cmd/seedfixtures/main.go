package main

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/sayonetech/worldcup-predictor/backend/internal/config"
	"github.com/sayonetech/worldcup-predictor/backend/internal/importer"
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

	db, err := store.OpenMySQL(cfg.DSN())
	if err != nil {
		logger.Error("db", "err", err)
		os.Exit(1)
	}
	defer db.Close()

	logger.Info("seeding fixtures from CSV", "dir", cfg.SeedDataDir)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	res, err := (&importer.Importer{Store: store.New(db)}).Run(ctx, cfg.SeedDataDir)
	if err != nil {
		logger.Error("seed-fixtures failed", "err", err)
		os.Exit(1)
	}
	logger.Info("seed-fixtures complete", "venues", res.Venues, "teams", res.Teams, "matches", res.Matches)
}
