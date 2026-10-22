package query

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type ChatPrelude struct {
	Owner        User
	Conversation Conversation
	Previous     Message
	Messages     []Message
	Preferences  UserPreference
}

type batchReader struct{ results pgx.BatchResults }

func (b batchReader) Exec(context.Context, string, ...interface{}) (pgconn.CommandTag, error) {
	return b.results.Exec()
}
func (b batchReader) Query(context.Context, string, ...interface{}) (pgx.Rows, error) {
	return b.results.Query()
}
func (b batchReader) QueryRow(context.Context, string, ...interface{}) pgx.Row {
	return b.results.QueryRow()
}

// ReadChatPrelude retains lock order while sending independent reads in one round trip.
// Missing records remain zero values; callers authorize ownership before using history.
func (q *Queries) ReadChatPrelude(ctx context.Context, owner, conversation, request uuid.UUID) (value ChatPrelude, resultErr error) {
	sender, ok := q.db.(pgx.Tx)
	if !ok {
		return value, fmt.Errorf("chat prelude requires a PostgreSQL transaction")
	}
	batch := &pgx.Batch{}
	batch.Queue(lockChatUser, owner.String())
	batch.Queue(getUserForUpdate, owner)
	batch.Queue(lockConversation, conversation, owner)
	batch.Queue(chatMessageByRequest, conversation, request)
	batch.Queue(listChatMessages, conversation, nil, nil, int32(202))
	batch.Queue(getPreferences, owner)
	results := sender.SendBatch(ctx, batch)
	defer func() {
		if err := results.Close(); err != nil && resultErr == nil {
			resultErr = fmt.Errorf("close chat prelude: %w", err)
		}
	}()
	reader := New(batchReader{results})
	if err := reader.LockChatUser(ctx, owner.String()); err != nil {
		return value, fmt.Errorf("lock chat owner: %w", err)
	}
	var err error
	value.Owner, err = reader.GetUserForUpdate(ctx, owner)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return value, fmt.Errorf("read chat owner: %w", err)
	}
	value.Conversation, err = reader.LockConversation(ctx, LockConversationParams{ID: conversation, UserID: owner})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return value, fmt.Errorf("lock chat conversation: %w", err)
	}
	value.Previous, err = reader.ChatMessageByRequest(ctx, ChatMessageByRequestParams{ConversationID: conversation, RequestID: request})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return value, fmt.Errorf("read chat replay: %w", err)
	}
	value.Messages, err = reader.ListChatMessages(ctx, ListChatMessagesParams{ConversationID: conversation, PageLimit: 202})
	if err != nil {
		return value, fmt.Errorf("read chat history: %w", err)
	}
	value.Preferences, err = reader.GetPreferences(ctx, owner)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return value, fmt.Errorf("read chat preferences: %w", err)
	}
	return value, nil
}

// ClaimChatTurn pipelines independent writes; the caller rolls back rejected quotas.
func (q *Queries) ClaimChatTurn(ctx context.Context, quota UseChatDailyQuotaParams, assistant InsertChatMessageParams, run StartChatRunParams) (message Message, conversation Conversation, allowed bool, resultErr error) {
	sender, ok := q.db.(pgx.Tx)
	if !ok {
		return message, conversation, false, fmt.Errorf("chat claim requires a PostgreSQL transaction")
	}
	batch := &pgx.Batch{}
	batch.Queue(useChatDailyQuota, quota.UserID, quota.DailyLimit)
	batch.Queue(insertChatMessage, assistant.ID, assistant.ConversationID, assistant.RequestID, assistant.Role, assistant.Content, assistant.Status, assistant.ModelID, assistant.RequestHash)
	batch.Queue(startChatRun, run.ID, run.UserID, run.ActiveRunID, run.ModelID)
	results := sender.SendBatch(ctx, batch)
	defer func() {
		if err := results.Close(); err != nil && resultErr == nil {
			resultErr = fmt.Errorf("close chat claim: %w", err)
		}
	}()
	reader := New(batchReader{results})
	_, err := reader.UseChatDailyQuota(ctx, quota)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return message, conversation, false, fmt.Errorf("use chat quota: %w", err)
	}
	allowed = err == nil
	message, err = reader.InsertChatMessage(ctx, assistant)
	if err != nil {
		return message, conversation, allowed, fmt.Errorf("insert chat assistant: %w", err)
	}
	conversation, err = reader.StartChatRun(ctx, run)
	if err != nil {
		return message, conversation, allowed, fmt.Errorf("claim chat conversation: %w", err)
	}
	return message, conversation, allowed, nil
}
