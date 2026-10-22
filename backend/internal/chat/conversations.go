package chat

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/pagination"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

func missing(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return problem.New("CHAT_NOT_FOUND", http.StatusNotFound)
	}
	if err != nil {
		return fmt.Errorf("read conversation: %w", err)
	}
	return nil
}
func (s *Service) Conversation(ctx context.Context, owner, id uuid.UUID) (Conversation, error) {
	row, err := s.q.GetConversation(ctx, query.GetConversationParams{ID: id, UserID: owner})
	return conversationView(row), missing(err)
}
func (s *Service) Create(ctx context.Context, owner, id, model uuid.UUID) (Conversation, error) {
	if id == uuid.Nil || model == uuid.Nil {
		return Conversation{}, problem.Invalid()
	}
	if _, _, err := s.catalog.ChatTargets(ctx, model); err != nil {
		return Conversation{}, err
	}
	if err := s.q.CreateConversation(ctx, query.CreateConversationParams{ID: id, UserID: owner, ModelID: &model}); err != nil {
		return Conversation{}, fmt.Errorf("create conversation: %w", err)
	}
	result, err := s.Conversation(ctx, owner, id)
	if err == nil && result.ModelID != nil && *result.ModelID != model {
		return result, problem.New("CHAT_REQUEST_CONFLICT", http.StatusConflict)
	}
	return result, err
}
func (s *Service) List(ctx context.Context, owner uuid.UUID, search, cursor string, limit int32) (Page[Conversation], error) {
	result := Page[Conversation]{Items: []Conversation{}}
	if len(search) > 100 || limit < 1 || limit > 100 {
		return result, problem.Invalid()
	}
	prefix, encoded := "false", ""
	if cursor != "" {
		var ok bool
		prefix, encoded, ok = strings.Cut(cursor, ":")
		if !ok || (prefix != "false" && prefix != "true") {
			return result, problem.Invalid()
		}
	}
	fingerprint := pagination.Fingerprint("chat", owner.String(), search, prefix)
	decoded, err := pagination.Decode(encoded, fingerprint)
	if err != nil {
		return result, err
	}
	pin := prefix == "true"
	rows, err := s.q.ListConversations(ctx, query.ListConversationsParams{UserID: owner, Search: search, CursorTime: decoded.Time, CursorPinned: pgtype.Bool{Bool: pin, Valid: true}, CursorID: &decoded.ID, PageLimit: limit + 1})
	if err != nil {
		return result, fmt.Errorf("list conversations: %w", err)
	}
	if len(rows) > int(limit) {
		rows = rows[:limit]
		last := rows[len(rows)-1]
		nextPin := strconv.FormatBool(last.Pinned)
		next, err := pagination.Encode(last.LastMessageAt, last.ID, pagination.Fingerprint("chat", owner.String(), search, nextPin))
		if err != nil {
			return result, err
		}
		result.NextCursor = nextPin + ":" + next
	}
	for _, row := range rows {
		result.Items = append(result.Items, conversationView(row))
	}
	return result, nil
}
func (s *Service) Messages(ctx context.Context, owner, id uuid.UUID, cursor string, limit int32) (Page[Message], error) {
	result := Page[Message]{Items: []Message{}}
	if limit < 1 || limit > 100 {
		return result, problem.Invalid()
	}
	if _, err := s.Conversation(ctx, owner, id); err != nil {
		return result, err
	}
	fingerprint := pagination.Fingerprint("messages", owner.String(), id.String())
	decoded, err := pagination.Decode(cursor, fingerprint)
	if err != nil {
		return result, err
	}
	rows, err := s.q.ListChatMessages(ctx, query.ListChatMessagesParams{ConversationID: id, CursorTime: decoded.Time, CursorID: &decoded.ID, PageLimit: limit + 1})
	if err != nil {
		return result, fmt.Errorf("list messages: %w", err)
	}
	if len(rows) > int(limit) {
		rows = rows[:limit]
		last := rows[len(rows)-1]
		result.NextCursor, err = pagination.Encode(last.CreatedAt, last.ID, fingerprint)
		if err != nil {
			return result, err
		}
	}
	for _, row := range rows {
		result.Items = append(result.Items, messageView(row))
	}
	return result, nil
}
func (s *Service) Update(ctx context.Context, owner, id uuid.UUID, title string, pinned bool, version int64) (Conversation, error) {
	title = strings.TrimSpace(title)
	if !validation.Text(title, 1, 100) {
		return Conversation{}, problem.Invalid()
	}
	row, err := s.q.UpdateConversation(ctx, query.UpdateConversationParams{ID: id, UserID: owner, Title: title, Pinned: pinned, Version: version})
	if errors.Is(err, pgx.ErrNoRows) {
		if _, e := s.Conversation(ctx, owner, id); e != nil {
			return Conversation{}, e
		}
		return Conversation{}, problem.New("CONFIGURATION_CONFLICT", http.StatusConflict)
	}
	if err != nil {
		return Conversation{}, fmt.Errorf("update conversation: %w", err)
	}
	return conversationView(row), nil
}
func (s *Service) Delete(ctx context.Context, owner uuid.UUID, ids []uuid.UUID, all bool) error {
	if (!all && (len(ids) == 0 || len(ids) > 100)) || (all && len(ids) > 0) {
		return problem.Invalid()
	}
	_, err := s.q.DeleteChatConversations(ctx, query.DeleteChatConversationsParams{UserID: owner, Ids: ids, ClearAll: all})
	if err != nil {
		return fmt.Errorf("delete conversations: %w", err)
	}
	return nil
}
func (s *Service) Stop(ctx context.Context, owner, id uuid.UUID) error {
	if _, err := s.Conversation(ctx, owner, id); err != nil {
		return err
	}
	if err := s.q.CancelChatRun(ctx, query.CancelChatRunParams{ID: id, UserID: owner}); err != nil {
		return fmt.Errorf("stop chat: %w", err)
	}
	return nil
}
func (s *Service) Recover(ctx context.Context) error {
	if _, err := s.q.RecoverChatRuns(ctx); err != nil {
		return fmt.Errorf("recover expired chat runs: %w", err)
	}
	if err := s.q.PruneChatDailyUsage(ctx); err != nil {
		return fmt.Errorf("prune chat usage: %w", err)
	}
	return nil
}
func checkUser(ctx context.Context, q *query.Queries, actor user.Actor, lock bool) error {
	var row query.User
	var err error
	if lock {
		row, err = q.GetUserForUpdate(ctx, actor.ID)
	} else {
		row, err = q.GetUser(ctx, actor.ID)
	}
	if err != nil || row.Status != "active" || row.TokenVersion != actor.TokenVersion {
		return problem.Unauthorized()
	}
	return nil
}

// prepare serializes accepted operations per user, with durable per-conversation ownership.
func (s *Service) prepare(ctx context.Context, actor user.Actor, id uuid.UUID, input SendInput, config Configuration, modelLimit int32, vision bool) (*run, error) {
	var result run
	encoded, encodeErr := json.Marshal(input)
	if encodeErr != nil {
		return nil, fmt.Errorf("encode chat request fingerprint: %w", encodeErr)
	}
	digest := sha256.Sum256(encoded)
	fingerprint := hex.EncodeToString(digest[:])
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		prelude, err := q.ReadChatPrelude(ctx, actor.ID, id, input.RequestID)
		if err != nil {
			return err
		}
		if prelude.Owner.ID == uuid.Nil || prelude.Owner.Status != "active" || prelude.Owner.TokenVersion != actor.TokenVersion {
			return problem.Unauthorized()
		}
		conv := prelude.Conversation
		if conv.ID == uuid.Nil {
			return missing(pgx.ErrNoRows)
		}
		old := prelude.Previous
		if old.ID != uuid.Nil {
			if old.DeletedAt != nil || old.RequestHash != fingerprint {
				return problem.New("CHAT_REQUEST_CONFLICT", 409)
			}
			if old.Status == "streaming" {
				return problem.New("CHAT_BUSY", 409)
			}
			result = run{conversation: conv, assistant: old, replay: true}
			return nil
		}
		if conv.ActiveRunID != nil {
			return problem.New("CHAT_BUSY", 409)
		}
		rows := prelude.Messages
		history := make([]query.Message, 0, len(rows)+1)
		for i := len(rows) - 1; i >= 0; i-- {
			history = append(history, rows[i])
		}
		first := len(history) == 0
		var userRow query.Message
		if input.Action != "send" {
			index := len(history) - 1
			for index >= 0 && history[index].Role != "user" {
				index--
			}
			if index < 0 || input.LastMessageID == nil || history[index].ID != *input.LastMessageID {
				return problem.New("CHAT_REQUEST_CONFLICT", 409)
			}
			userRow = history[index]
			remove := uuid.Nil
			if input.Action == "edit" {
				remove = userRow.ID
			}
			if err := q.ReplaceLastChatTurn(ctx, query.ReplaceLastChatTurnParams{ConversationID: id, ID: remove, CreatedAt: userRow.CreatedAt}); err != nil {
				return fmt.Errorf("replace last chat turn: %w", err)
			}
			history = history[:index+1]
			if input.Action == "edit" {
				history = history[:index]
			}
		}
		if input.Action != "regenerate" {
			uid, err := validation.NewID()
			if err != nil {
				return err
			}
			userRow, err = q.InsertChatMessage(ctx, query.InsertChatMessageParams{ID: uid, ConversationID: id, RequestID: input.RequestID, Role: "user", Content: input.Content, Status: "completed", ModelID: &input.ModelID})
			if err != nil {
				return fmt.Errorf("insert user message: %w", err)
			}
			if len(input.ReferenceFileIDs) > 0 {
				if err := q.SetMessageReferences(ctx, query.SetMessageReferencesParams{ID: userRow.ID, ReferenceFileIds: input.ReferenceFileIDs}); err != nil {
					return fmt.Errorf("save chat references: %w", err)
				}
				userRow.ReferenceFileIds = input.ReferenceFileIDs
			}
			history = append(history, userRow)
		}
		pref := prelude.Preferences
		if pref.Instructions != "" {
			config.SystemPrompt += "\n\n" + pref.Instructions
		}
		assembled, err := BuildContext(history, config, modelLimit)
		if err != nil {
			return err
		}
		if !vision {
			for _, row := range history {
				if len(row.ReferenceFileIds) > 0 {
					return problem.Invalid()
				}
			}
		}
		if err := s.attachVision(ctx, q, actor.ID, history, assembled); err != nil {
			return err
		}
		if config.PerMinute > 0 {
			allowed, retry, err := s.gate.Allow(ctx, "chat-send", actor.ID.String(), int(config.PerMinute), time.Minute)
			if err != nil {
				return err
			}
			if !allowed {
				return problem.Retry("CHAT_RATE_LIMITED", retry)
			}
		}
		aid, err := validation.NewID()
		if err != nil {
			return err
		}
		assistant, accepted, allowed, err := q.ClaimChatTurn(ctx,
			query.UseChatDailyQuotaParams{UserID: actor.ID, DailyLimit: config.PerDay},
			query.InsertChatMessageParams{ID: aid, ConversationID: id, RequestID: input.RequestID, RequestHash: fingerprint, Role: "assistant", Status: "streaming", ModelID: &input.ModelID},
			query.StartChatRunParams{ID: id, UserID: actor.ID, ActiveRunID: &aid, ModelID: &input.ModelID})
		if err != nil {
			return err
		}
		if !allowed {
			return problem.Retry("CHAT_DAILY_LIMIT", 60)
		}
		result = run{conversation: accepted, user: userRow, assistant: assistant, messages: assembled, first: first}
		return nil
	})
	return &result, err
}
