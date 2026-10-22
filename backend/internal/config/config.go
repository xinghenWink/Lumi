package config

import (
	"encoding/base64"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"strconv"
	"strings"
)

type Config struct {
	UpstreamBaseURL      string
	UpstreamAPIKey       string
	Environment          string
	HTTPAddress          string
	DatabaseURL          string
	RedisURL             string
	LogLevel             slog.Level
	JWTSecret            string
	EncryptionKey        []byte
	AdminEmail           string
	AdminPassword        string
	AdminResetPassword   string
	PublicBaseURL        string
	CookieSecure         bool
	TrustedProxies       []string
	DevOrigin            string
	SettingsOverrides    map[string]string
	UpstreamAllowPrivate bool
	DataDir              string
}

// Load accepts an environment lookup so tests do not mutate process state.
func Load(getenv func(string) string) (Config, error) {
	cfg := Config{
		UpstreamBaseURL: getenv("UPSTREAM_BASE_URL"), UpstreamAPIKey: getenv("UPSTREAM_API_KEY"),
		Environment:        value(getenv, "APP_ENV", "development"),
		HTTPAddress:        value(getenv, "HTTP_ADDR", ":8080"),
		DatabaseURL:        getenv("DATABASE_URL"),
		RedisURL:           getenv("REDIS_URL"),
		JWTSecret:          getenv("JWT_SECRET"),
		AdminEmail:         getenv("ADMIN_EMAIL"),
		AdminPassword:      getenv("ADMIN_PASSWORD"),
		AdminResetPassword: getenv("ADMIN_RESET_PASSWORD"),
		PublicBaseURL:      value(getenv, "PUBLIC_BASE_URL", "http://127.0.0.1:8080"),
		DevOrigin:          value(getenv, "DEV_ORIGIN", "http://127.0.0.1:5173"),
		SettingsOverrides:  make(map[string]string),
	}
	if cfg.Environment != "development" && cfg.Environment != "production" && cfg.Environment != "test" {
		return Config{}, fmt.Errorf("APP_ENV must be development, production or test")
	}
	defaultDirectory := "data"
	if cfg.Environment == "production" {
		defaultDirectory = "/data"
	}
	cfg.DataDir = value(getenv, "DATA_DIR", defaultDirectory)
	if _, _, err := net.SplitHostPort(cfg.HTTPAddress); err != nil {
		return Config{}, fmt.Errorf("parse HTTP_ADDR: %w", err)
	}
	if err := cfg.LogLevel.UnmarshalText([]byte(value(getenv, "LOG_LEVEL", "info"))); err != nil {
		return Config{}, fmt.Errorf("parse LOG_LEVEL: %w", err)
	}
	for _, entry := range []struct {
		name, raw string
		schemes   []string
	}{
		{"DATABASE_URL", cfg.DatabaseURL, []string{"postgres", "postgresql"}},
		{"REDIS_URL", cfg.RedisURL, []string{"redis", "rediss"}},
	} {
		if entry.raw == "" && cfg.Environment != "production" {
			continue
		}
		parsed, err := url.Parse(entry.raw)
		if err != nil || parsed.Hostname() == "" || !contains(entry.schemes, parsed.Scheme) {
			// Never include a connection URL in errors: it may contain credentials.
			return Config{}, fmt.Errorf("%s must be a valid %s URL", entry.name, strings.Join(entry.schemes, "/"))
		}
	}
	cfg.CookieSecure = cfg.Environment == "production"
	if raw := getenv("UPSTREAM_ALLOW_PRIVATE_NETWORKS"); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			return Config{}, fmt.Errorf("parse UPSTREAM_ALLOW_PRIVATE_NETWORKS: %w", err)
		}
		cfg.UpstreamAllowPrivate = parsed
	}
	if raw := getenv("COOKIE_SECURE"); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			return Config{}, fmt.Errorf("parse COOKIE_SECURE: %w", err)
		}
		cfg.CookieSecure = parsed
	}
	if raw := getenv("ENCRYPTION_KEY"); raw != "" {
		decoded, err := base64.StdEncoding.Strict().DecodeString(raw)
		if err != nil || len(decoded) != 32 {
			return Config{}, fmt.Errorf("ENCRYPTION_KEY must be base64 encoding of 32 bytes")
		}
		cfg.EncryptionKey = decoded
	}
	if raw := getenv("TRUSTED_PROXIES"); raw != "" {
		for _, proxy := range strings.Split(raw, ",") {
			cfg.TrustedProxies = append(cfg.TrustedProxies, strings.TrimSpace(proxy))
		}
	}
	for _, key := range []string{"SITE_NAME", "REGISTRATION_ENABLED", "EMAIL_VERIFICATION_ENABLED", "EMAIL_DOMAIN_ALLOWLIST", "EMAIL_DOMAIN_BLOCKLIST", "SMTP_HOST", "SMTP_PORT", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_FROM", "SMTP_ENCRYPTION"} {
		if raw := getenv(key); raw != "" {
			cfg.SettingsOverrides[key] = raw
		}
	}
	for _, raw := range []string{cfg.PublicBaseURL, cfg.DevOrigin} {
		parsed, err := url.Parse(raw)
		if err != nil || parsed.Hostname() == "" || parsed.User != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
			return Config{}, fmt.Errorf("PUBLIC_BASE_URL and DEV_ORIGIN must be HTTP origins")
		}
	}
	return cfg, nil
}

func (c Config) ValidateAccounts() error {
	if len(c.JWTSecret) < 32 {
		return fmt.Errorf("JWT_SECRET must contain at least 32 bytes")
	}
	if len(c.EncryptionKey) != 32 {
		return fmt.Errorf("ENCRYPTION_KEY is required for account services")
	}
	if c.CookieSecure && !strings.HasPrefix(c.PublicBaseURL, "https://") {
		return fmt.Errorf("COOKIE_SECURE requires an HTTPS PUBLIC_BASE_URL")
	}
	if (c.AdminEmail == "") != (c.AdminPassword == "") {
		return fmt.Errorf("ADMIN_EMAIL and ADMIN_PASSWORD must be configured together")
	}
	return nil
}

func (c Config) AllowedOrigins() []string {
	origins := []string{strings.TrimRight(c.PublicBaseURL, "/")}
	if c.Environment == "development" {
		origins = append(origins, strings.TrimRight(c.DevOrigin, "/"))
	}
	return origins
}

func value(getenv func(string) string, key, fallback string) string {
	if result := getenv(key); result != "" {
		return result
	}
	return fallback
}

func contains(values []string, target string) bool {
	for _, item := range values {
		if item == target {
			return true
		}
	}
	return false
}
