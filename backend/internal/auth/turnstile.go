package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/settings"
)

// ValidateTurnstile verifies single-use tokens at the fixed vendor endpoint.
func ValidateTurnstile(ctx context.Context, transport http.RoundTripper, cfg settings.Operations, token, action, ip string) (resultErr error) {
	if !cfg.TurnstileEnabled {
		return nil
	}
	if len(token) < 1 || len(token) > 2048 {
		return problem.New("CHALLENGE_REQUIRED", 400)
	}
	body := url.Values{"secret": {cfg.TurnstileSecret}, "response": {token}, "remoteip": {ip}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://challenges.cloudflare.com/turnstile/v0/siteverify", strings.NewReader(body.Encode()))
	if err != nil {
		return fmt.Errorf("create challenge verification: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return problem.New("CHALLENGE_UNAVAILABLE", 503)
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil && resultErr == nil {
			resultErr = problem.New("CHALLENGE_UNAVAILABLE", 503)
		}
	}()
	var result struct {
		Success  bool   `json:"success"`
		Hostname string `json:"hostname"`
		Action   string `json:"action"`
	}
	if resp.StatusCode != 200 || json.NewDecoder(io.LimitReader(resp.Body, 16384)).Decode(&result) != nil || !result.Success || !strings.EqualFold(result.Hostname, cfg.TurnstileHostname) || result.Action != action {
		return problem.New("CHALLENGE_INVALID", 400)
	}
	return nil
}
