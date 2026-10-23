package settings

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

// Operations separates encrypted persistence from the public administration DTO.
type Operations struct {
	Maintenance               bool     `json:"maintenance"`
	TurnstileEnabled          bool     `json:"turnstile_enabled"`
	TurnstileSiteKey          string   `json:"turnstile_site_key"`
	TurnstileHostname         string   `json:"turnstile_hostname"`
	TurnstileSecretEncrypted  string   `json:"turnstile_secret_encrypted,omitempty"`
	TurnstileSecret           string   `json:"-"`
	TurnstileSecretConfigured bool     `json:"turnstile_secret_configured"`
	RegisterPerIPDay          int      `json:"register_per_ip_day"`
	CircuitFailures           int32    `json:"circuit_failures"`
	CircuitSeconds            int32    `json:"circuit_seconds"`
	SensitiveWords            []string `json:"sensitive_words"`
}

func validAssetLink(value string) bool {
	return value == "" || (strings.HasPrefix(value, "/") && !strings.HasPrefix(value, "//") && !strings.ContainsAny(value, "\\\r\n") && validation.Link(value))
}

type OperationsInput struct {
	Maintenance       bool     `json:"maintenance"`
	TurnstileEnabled  bool     `json:"turnstile_enabled"`
	TurnstileSiteKey  string   `json:"turnstile_site_key"`
	TurnstileHostname string   `json:"turnstile_hostname"`
	TurnstileSecret   *string  `json:"turnstile_secret,omitempty"`
	RegisterPerIPDay  int      `json:"register_per_ip_day"`
	CircuitFailures   int32    `json:"circuit_failures"`
	CircuitSeconds    int32    `json:"circuit_seconds"`
	SensitiveWords    []string `json:"sensitive_words"`
}

func operationsView(v Operations) Operations {
	v.TurnstileSecretConfigured = v.TurnstileSecret != ""
	v.TurnstileSecret = ""
	v.TurnstileSecretEncrypted = ""
	return v
}
func (s *Service) OperationsView(ctx context.Context) (Operations, error) {
	v, err := s.Read(ctx)
	return operationsView(v.Operations), err
}
func (s *Service) SaveOperations(ctx context.Context, actor user.Actor, input OperationsInput) (Operations, error) {
	if input.RegisterPerIPDay < 0 || input.RegisterPerIPDay > 1000 || input.CircuitFailures < 1 || input.CircuitFailures > 100 || input.CircuitSeconds < 1 || input.CircuitSeconds > 3600 || len(input.SensitiveWords) > 200 || !validation.Text(input.TurnstileSiteKey, 0, 200) {
		return Operations{}, problem.Invalid()
	}
	if input.TurnstileEnabled && (input.TurnstileSiteKey == "" || !validation.Domain(input.TurnstileHostname)) {
		return Operations{}, problem.Invalid()
	}
	for _, word := range input.SensitiveWords {
		if !validation.Text(strings.TrimSpace(word), 1, 100) {
			return Operations{}, problem.Invalid()
		}
	}
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		before, err := s.read(ctx, q)
		if err != nil {
			return err
		}
		v := Operations{Maintenance: input.Maintenance, TurnstileEnabled: input.TurnstileEnabled, TurnstileSiteKey: input.TurnstileSiteKey, TurnstileHostname: input.TurnstileHostname, RegisterPerIPDay: input.RegisterPerIPDay, CircuitFailures: input.CircuitFailures, CircuitSeconds: input.CircuitSeconds, SensitiveWords: input.SensitiveWords, TurnstileSecretEncrypted: before.Operations.TurnstileSecretEncrypted, TurnstileSecret: before.Operations.TurnstileSecret}
		if input.TurnstileSecret != nil {
			if len(*input.TurnstileSecret) > 4096 {
				return problem.Invalid()
			}
			v.TurnstileSecret = *input.TurnstileSecret
			v.TurnstileSecretEncrypted, err = s.vault.Encrypt(v.TurnstileSecret, "settings.turnstile.secret")
			if err != nil {
				return err
			}
		}
		if v.TurnstileEnabled && v.TurnstileSecret == "" {
			return problem.Invalid()
		}
		encoded, err := json.Marshal(v)
		if err != nil {
			return fmt.Errorf("encode operations settings: %w", err)
		}
		if err := q.SaveSetting(ctx, query.SaveSettingParams{Key: "operations", Value: encoded, UpdatedBy: &actor.ID}); err != nil {
			return fmt.Errorf("save operations settings: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "settings.update", TargetType: "operations", Before: operationsView(before.Operations), After: operationsView(v), IP: actor.IP})
	})
	if err != nil {
		return Operations{}, err
	}
	s.Invalidate()
	return s.OperationsView(ctx)
}
