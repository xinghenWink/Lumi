package chat

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
)

type CanvasPrompt struct {
	Owner, ModelID     uuid.UUID
	Content, Reasoning string
	Files              []uuid.UUID
}

func (s *Service) AdmitCanvas(ctx context.Context, q *query.Queries, input CanvasPrompt, count int32) error {
	row, err := q.GetChatSettings(ctx)
	if err != nil {
		return fmt.Errorf("read canvas chat settings: %w", err)
	}
	config := configView(row)
	model, _, err := s.catalog.ChatTargetsTx(ctx, q, input.ModelID)
	if err != nil {
		return err
	}
	if !validContent(input.Content) || !slices.Contains([]string{"", "low", "medium", "high"}, input.Reasoning) ||
		(input.Reasoning != "" && !model.Capabilities.ReasoningEffort) || len(input.Files) > 4 ||
		(len(input.Files) > 0 && !model.Capabilities.Vision) {
		return problem.Invalid()
	}
	history := []query.Message{{Role: "user", Content: input.Content, ReferenceFileIds: input.Files}}
	messages, err := BuildContext(history, config, model.Capabilities.MaxContextTokens)
	if err != nil {
		return err
	}
	if err := s.attachVision(ctx, q, input.Owner, history, messages); err != nil {
		return err
	}
	for range count {
		if config.PerMinute > 0 {
			allowed, retry, err := s.gate.Allow(ctx, "chat-send", input.Owner.String(), int(config.PerMinute), time.Minute)
			if err != nil {
				return err
			}
			if !allowed {
				return problem.Retry("CHAT_RATE_LIMITED", retry)
			}
		}
		_, err := q.UseChatDailyQuota(ctx, query.UseChatDailyQuotaParams{UserID: input.Owner, DailyLimit: config.PerDay})
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.Retry("CHAT_DAILY_LIMIT", 60)
		}
		if err != nil {
			return fmt.Errorf("reserve canvas text quota: %w", err)
		}
	}
	return nil
}

// GenerateCanvasText executes one independently routed candidate without chat history.
func (s *Service) GenerateCanvasText(ctx context.Context, input CanvasPrompt, maximum int) (string, error) {
	config, err := s.Configuration(ctx)
	if err != nil {
		return "", err
	}
	model, targets, err := s.catalog.ChatTargets(ctx, input.ModelID)
	if err != nil {
		return "", err
	}
	if (input.Reasoning != "" && !model.Capabilities.ReasoningEffort) || (len(input.Files) > 0 && !model.Capabilities.Vision) {
		return "", problem.Invalid()
	}
	history := []query.Message{{Role: "user", Content: input.Content, ReferenceFileIds: input.Files}}
	messages, err := BuildContext(history, config, model.Capabilities.MaxContextTokens)
	if err != nil {
		return "", err
	}
	if err := s.attachVision(ctx, s.q, input.Owner, history, messages); err != nil {
		return "", err
	}
	work, cancel := context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()
	packets := make(chan packet, 16)
	go s.relay(work, targets, messages, input.Reasoning, packets)
	var result strings.Builder
	left := maximum
	for p := range packets {
		if p.done {
			if p.code != "" {
				return "", problem.New(p.code, 502)
			}
			if value := strings.TrimSpace(result.String()); value != "" {
				return value, nil
			}
			break
		}
		safe := strings.Map(func(r rune) rune {
			if unicode.IsControl(r) && r != '\n' && r != '\t' && r != '\r' {
				return -1
			}
			return r
		}, p.event.Content)
		for len(safe) != 0 && left > 0 {
			_, size := utf8.DecodeRuneInString(safe)
			result.WriteString(safe[:size])
			safe = safe[size:]
			left--
		}
		if left == 0 {
			if value := strings.TrimSpace(result.String()); value != "" {
				return value, nil
			}
			break
		}
	}
	return "", problem.New("CHAT_INTERRUPTED", 502)
}
