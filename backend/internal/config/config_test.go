package config

import (
	"crypto/rand"
	"encoding/base64"
	"strings"
	"testing"
)

func TestLoad(t *testing.T) {
	tests := []struct {
		name string
		env  map[string]string
		want string
	}{
		{name: "development allows missing dependencies"},
		{name: "production requires dependencies", env: map[string]string{"APP_ENV": "production"}, want: "DATABASE_URL"},
		{name: "invalid environment", env: map[string]string{"APP_ENV": "preview"}, want: "APP_ENV"},
		{name: "invalid address", env: map[string]string{"HTTP_ADDR": "localhost"}, want: "HTTP_ADDR"},
		{name: "invalid log level", env: map[string]string{"LOG_LEVEL": "verbose"}, want: "LOG_LEVEL"},
		{name: "reject wrong scheme", env: map[string]string{"REDIS_URL": "http://user:secret@localhost"}, want: "REDIS_URL"},
		{name: "reject malformed URL", env: map[string]string{"DATABASE_URL": "postgres://user:secret@%invalid"}, want: "DATABASE_URL"},
		{name: "valid production", env: map[string]string{
			"APP_ENV": "production", "DATABASE_URL": "postgres://user:secret@localhost/lumi",
			"REDIS_URL": "redis://:secret@localhost:6379/0", "LOG_LEVEL": "debug",
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			cfg, err := Load(func(key string) string { return tt.env[key] })
			if tt.want == "" {
				if err != nil {
					t.Fatalf("Load: %v", err)
				}
				if cfg.HTTPAddress != ":8080" {
					t.Errorf("default address = %q", cfg.HTTPAddress)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("error = %v, want %s", err, tt.want)
			}
			if strings.Contains(err.Error(), "secret") {
				t.Fatal("configuration error leaked a credential")
			}
		})
	}
}

func TestAccountSecurityConfiguration(t *testing.T) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	env := map[string]string{
		"JWT_SECRET": rand.Text() + rand.Text(), "ENCRYPTION_KEY": base64.StdEncoding.EncodeToString(key),
		"COOKIE_SECURE": "true", "PUBLIC_BASE_URL": "https://lumi.test",
	}
	cfg, err := Load(func(key string) string { return env[key] })
	if err != nil {
		t.Fatal(err)
	}
	if err := cfg.ValidateAccounts(); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*Config){
		func(c *Config) { c.JWTSecret = "short" },
		func(c *Config) { c.EncryptionKey = nil },
		func(c *Config) { c.PublicBaseURL = "http://lumi.test" },
		func(c *Config) { c.AdminEmail = "admin@lumi.test" },
	} {
		invalid := cfg
		mutate(&invalid)
		if err := invalid.ValidateAccounts(); err == nil {
			t.Fatal("unsafe account configuration accepted")
		}
	}
	for _, origin := range []string{"https://lumi.test/path", "https://user:private@lumi.test", "https://lumi.test?token=private"} {
		env["PUBLIC_BASE_URL"] = origin
		if _, err := Load(func(key string) string { return env[key] }); err == nil || strings.Contains(err.Error(), "private") {
			t.Fatal("origin validation accepted invalid input or exposed credentials")
		}
	}
}
