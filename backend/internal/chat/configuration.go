package chat

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

func configView(row query.ChatSetting) Configuration {
	return Configuration{PerMinute: row.PerMinute, PerDay: row.PerDay, ContextMessages: row.ContextMessages, ContextTokens: row.ContextTokens, SystemPrompt: row.SystemPrompt, TitleModelID: row.TitleModelID, Version: row.Version}
}
func (s *Service) Configuration(ctx context.Context) (Configuration, error) {
	s.configMu.Lock()
	defer s.configMu.Unlock()
	if time.Now().Before(s.configUntil) {
		return copyConfiguration(s.config), nil
	}
	row, err := s.q.GetChatSettings(ctx)
	if err != nil {
		return Configuration{}, fmt.Errorf("read chat settings: %w", err)
	}
	s.config = configView(row)
	s.configUntil = time.Now().Add(30 * time.Second)
	return copyConfiguration(s.config), nil
}
func copyConfiguration(value Configuration) Configuration {
	if value.TitleModelID != nil {
		id := *value.TitleModelID
		value.TitleModelID = &id
	}
	return value
}
func (s *Service) SaveConfiguration(ctx context.Context, actor user.Actor, input Configuration) (Configuration, error) {
	if input.PerMinute < 0 || input.PerMinute > 1000 || input.PerDay < 0 || input.PerDay > 100000 || input.ContextMessages < 1 || input.ContextMessages > 200 || input.ContextTokens < 128 || input.ContextTokens > 1000000 || len(input.SystemPrompt) > 32000 || !utf8.ValidString(input.SystemPrompt) || strings.ContainsRune(input.SystemPrompt, 0) {
		return Configuration{}, problem.Invalid()
	}
	var result Configuration
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		before, err := q.GetChatSettings(ctx)
		if err != nil {
			return fmt.Errorf("read changed chat settings: %w", err)
		}
		if input.TitleModelID != nil {
			if _, _, err := s.catalog.ChatTargetsTx(ctx, q, *input.TitleModelID); err != nil {
				return err
			}
		}
		row, err := q.SaveChatSettings(ctx, query.SaveChatSettingsParams{PerMinute: input.PerMinute, PerDay: input.PerDay, ContextMessages: input.ContextMessages, ContextTokens: input.ContextTokens, SystemPrompt: input.SystemPrompt, TitleModelID: input.TitleModelID, Version: input.Version})
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.New("CONFIGURATION_CONFLICT", http.StatusConflict)
		}
		if err != nil {
			return fmt.Errorf("save chat settings: %w", err)
		}
		result = configView(row)
		// Prompts can contain operational instructions; audit only non-content settings.
		old := configView(before)
		old.SystemPrompt = ""
		after := result
		after.SystemPrompt = ""
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "settings.update", TargetType: "chat", Before: old, After: after, IP: actor.IP})
	})
	if err == nil {
		s.configMu.Lock()
		s.configUntil = time.Time{}
		s.configMu.Unlock()
	}
	return result, err
}
