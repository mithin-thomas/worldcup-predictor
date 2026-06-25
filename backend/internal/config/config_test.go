package config

import (
	"os"
	"testing"
)

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

func TestLoadSeedDataDirDefault(t *testing.T) {
	t.Setenv("SESSION_SECRET", "secret")
	t.Setenv("GOOGLE_CLIENT_ID", "client-id")
	t.Setenv("SEED_DATA_DIR", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.SeedDataDir != "./data" {
		t.Errorf("SeedDataDir default = %q, want ./data", cfg.SeedDataDir)
	}

	t.Setenv("SEED_DATA_DIR", "/srv/data")
	cfg, _ = Load()
	if cfg.SeedDataDir != "/srv/data" {
		t.Errorf("SeedDataDir override = %q, want /srv/data", cfg.SeedDataDir)
	}
}

func TestLoad_OpenAIDefaults(t *testing.T) {
	// Required vars so Load() succeeds.
	t.Setenv("SESSION_SECRET", "x")
	t.Setenv("GOOGLE_CLIENT_ID", "y")
	// Ensure OpenAI vars are unset for the default case.
	_ = os.Unsetenv("OPENAI_API_KEY")
	_ = os.Unsetenv("OPENAI_SYSTEM_PROMPT_FILE")
	_ = os.Unsetenv("OPENAI_MODEL")

	c, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.OpenAIAPIKey != "" {
		t.Errorf("OpenAIAPIKey = %q, want empty", c.OpenAIAPIKey)
	}
	if c.OpenAISystemPromptFile != "" {
		t.Errorf("OpenAISystemPromptFile = %q, want empty", c.OpenAISystemPromptFile)
	}
	if c.OpenAIModel != "gpt-4o-mini" {
		t.Errorf("OpenAIModel = %q, want gpt-4o-mini", c.OpenAIModel)
	}
}
