package config

import "testing"

func TestLoadReadsEnvAndAppliesDefaults(t *testing.T) {
	t.Setenv("HTTP_PORT", "")
	t.Setenv("APP_ENV", "")
	t.Setenv("SESSION_SECRET", "secret")
	t.Setenv("GOOGLE_CLIENT_ID", "client-id")
	t.Setenv("ALLOWED_EMAIL_DOMAIN", "sayonetech.com")
	t.Setenv("SEED_ADMIN_EMAILS", "a@sayonetech.com, b@sayonetech.com")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.HTTPPort != "8000" {
		t.Errorf("HTTPPort default = %q, want 8000", cfg.HTTPPort)
	}
	if cfg.AppEnv != "development" {
		t.Errorf("AppEnv default = %q, want development", cfg.AppEnv)
	}
	if cfg.IsProduction() {
		t.Errorf("IsProduction() = true, want false for development")
	}
	if len(cfg.SeedAdminEmails) != 2 || cfg.SeedAdminEmails[0] != "a@sayonetech.com" {
		t.Errorf("SeedAdminEmails = %v, want trimmed 2-element slice", cfg.SeedAdminEmails)
	}
}

func TestLoadRequiresSessionSecret(t *testing.T) {
	t.Setenv("SESSION_SECRET", "")
	t.Setenv("GOOGLE_CLIENT_ID", "client-id")
	if _, err := Load(); err == nil {
		t.Fatal("Load() error = nil, want error for missing SESSION_SECRET")
	}
}

func TestLoadRequiresGoogleClientID(t *testing.T) {
	t.Setenv("SESSION_SECRET", "secret")
	t.Setenv("GOOGLE_CLIENT_ID", "")
	if _, err := Load(); err == nil {
		t.Fatal("Load() error = nil, want error for missing GOOGLE_CLIENT_ID")
	}
}
