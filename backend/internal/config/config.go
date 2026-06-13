// Package config loads 12-factor environment configuration.
package config

import (
	"fmt"
	"os"
	"strings"
)

type Config struct {
	AppEnv             string
	HTTPPort           string
	DBHost             string
	DBPort             string
	DBUser             string
	DBPassword         string
	DBName             string
	SessionSecret      string
	GoogleClientID     string
	AllowedEmailDomain string
	SeedAdminEmails    []string
	APIFootballKey     string
	APIFootballBaseURL string
}

func (c Config) IsProduction() bool { return c.AppEnv == "production" }

// DSN returns a go-sql-driver/mysql DSN (parseTime so DATETIME scans into time.Time).
func (c Config) DSN() string {
	return fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?parseTime=true&loc=UTC",
		c.DBUser, c.DBPassword, c.DBHost, c.DBPort, c.DBName)
}

func Load() (Config, error) {
	c := Config{
		AppEnv:             getenv("APP_ENV", "development"),
		HTTPPort:           getenv("HTTP_PORT", "8000"),
		DBHost:             getenv("DB_HOST", "127.0.0.1"),
		DBPort:             getenv("DB_PORT", "3306"),
		DBUser:             getenv("DB_USER", "wcp"),
		DBPassword:         getenv("DB_PASSWORD", "wcp"),
		DBName:             getenv("DB_NAME", "wcp"),
		SessionSecret:      os.Getenv("SESSION_SECRET"),
		GoogleClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		AllowedEmailDomain: getenv("ALLOWED_EMAIL_DOMAIN", "sayonetech.com"),
		SeedAdminEmails:    splitTrim(os.Getenv("SEED_ADMIN_EMAILS")),
		APIFootballKey:     os.Getenv("APIFOOTBALL_KEY"),
		APIFootballBaseURL: getenv("APIFOOTBALL_BASE_URL", "https://v3.football.api-sports.io"),
	}
	if c.SessionSecret == "" {
		return Config{}, fmt.Errorf("config: SESSION_SECRET is required")
	}
	if c.GoogleClientID == "" {
		return Config{}, fmt.Errorf("config: GOOGLE_CLIENT_ID is required")
	}
	return c, nil
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func splitTrim(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}
