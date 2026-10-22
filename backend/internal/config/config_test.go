package config

import (
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
