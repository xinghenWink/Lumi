package config

import (
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"strings"
)

type Config struct {
	Environment string
	HTTPAddress string
	DatabaseURL string
	RedisURL    string
	LogLevel    slog.Level
}

// Load accepts an environment lookup so tests do not mutate process state.
func Load(getenv func(string) string) (Config, error) {
	cfg := Config{
		Environment: value(getenv, "APP_ENV", "development"),
		HTTPAddress: value(getenv, "HTTP_ADDR", ":8080"),
		DatabaseURL: getenv("DATABASE_URL"),
		RedisURL:    getenv("REDIS_URL"),
	}
	if cfg.Environment != "development" && cfg.Environment != "production" && cfg.Environment != "test" {
		return Config{}, fmt.Errorf("APP_ENV must be development, production or test")
	}
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
	return cfg, nil
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
