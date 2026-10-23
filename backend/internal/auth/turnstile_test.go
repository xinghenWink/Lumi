package auth

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/xinghenWink/Lumi/backend/internal/settings"
)

type challengeTransport func(*http.Request) (*http.Response, error)

func (f challengeTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestTurnstileChecksHostnameActionAndStatus(t *testing.T) {
	cfg := settings.Operations{TurnstileEnabled: true, TurnstileSecret: "fixture-only", TurnstileHostname: "lumi.test"}
	for _, tc := range []struct {
		name, body string
		status     int
		accepted   bool
	}{
		{"valid", `{"success":true,"hostname":"lumi.test","action":"register"}`, 200, true},
		{"other_host", `{"success":true,"hostname":"other.test","action":"register"}`, 200, false},
		{"other_action", `{"success":true,"hostname":"lumi.test","action":"send_code"}`, 200, false},
		{"reused", `{"success":false,"error-codes":["timeout-or-duplicate"]}`, 200, false},
		{"http_failure", `{"success":true,"hostname":"lumi.test","action":"register"}`, 503, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			transport := challengeTransport(func(r *http.Request) (*http.Response, error) {
				if r.URL.String() != "https://challenges.cloudflare.com/turnstile/v0/siteverify" || r.Method != "POST" {
					t.Fatal("unexpected verification endpoint")
				}
				if err := r.ParseForm(); err != nil {
					t.Fatal(err)
				}
				if r.Form.Get("secret") != "fixture-only" || r.Form.Get("response") != "single-use" {
					t.Fatal("missing verification credentials")
				}
				return &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
			})
			err := ValidateTurnstile(context.Background(), transport, cfg, "single-use", "register", "127.0.0.1")
			if (err == nil) != tc.accepted {
				t.Fatalf("accepted=%v error=%v", tc.accepted, err)
			}
		})
	}
}
