package chat

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xinghenWink/Lumi/backend/internal/catalog"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
)

type Gate interface {
	Allow(context.Context, string, string, int, time.Duration) (bool, int, error)
}
type Service struct {
	pool    *pgxpool.Pool
	q       *query.Queries
	catalog *catalog.Service
	gate    Gate
}

func New(pool *pgxpool.Pool, catalog *catalog.Service, gate Gate) *Service {
	return &Service{pool: pool, q: query.New(pool), catalog: catalog, gate: gate}
}

type Configuration struct {
	PerMinute       int32      `json:"per_minute"`
	PerDay          int32      `json:"per_day"`
	ContextMessages int32      `json:"context_messages"`
	ContextTokens   int32      `json:"context_tokens"`
	SystemPrompt    string     `json:"system_prompt"`
	TitleModelID    *uuid.UUID `json:"title_model_id"`
	Version         int64      `json:"version"`
}
type Conversation struct {
	ID            uuid.UUID  `json:"id"`
	Title         string     `json:"title"`
	ModelID       *uuid.UUID `json:"model_id"`
	Pinned        bool       `json:"pinned"`
	Busy          bool       `json:"busy"`
	Version       int64      `json:"version"`
	LastMessageAt time.Time  `json:"last_message_at"`
	CreatedAt     time.Time  `json:"created_at"`
}
type Metadata struct {
	FinishReason string `json:"finish_reason,omitempty"`
	LatencyMS    int64  `json:"latency_ms,omitempty"`
	ErrorCode    string `json:"error_code,omitempty"`
	Usage        *Usage `json:"usage,omitempty"`
}
type Usage struct {
	PromptTokens     int64 `json:"prompt_tokens"`
	CompletionTokens int64 `json:"completion_tokens"`
	TotalTokens      int64 `json:"total_tokens"`
}
type Message struct {
	ID        uuid.UUID  `json:"id"`
	RequestID uuid.UUID  `json:"request_id"`
	Role      string     `json:"role"`
	Content   string     `json:"content"`
	Status    string     `json:"status"`
	ModelID   *uuid.UUID `json:"model_id"`
	Meta      Metadata   `json:"meta"`
	CreatedAt time.Time  `json:"created_at"`
}
type Page[T any] struct {
	Items      []T    `json:"items"`
	NextCursor string `json:"next_cursor"`
}
type SendInput struct {
	RequestID     uuid.UUID  `json:"request_id"`
	ModelID       uuid.UUID  `json:"model_id"`
	Content       string     `json:"content"`
	Action        string     `json:"action"`
	LastMessageID *uuid.UUID `json:"last_message_id"`
}
type Event struct {
	Type         string        `json:"-"`
	Conversation *Conversation `json:"conversation,omitempty"`
	User         *Message      `json:"user,omitempty"`
	Assistant    *Message      `json:"assistant,omitempty"`
	Content      string        `json:"content,omitempty"`
	Code         string        `json:"code,omitempty"`
	Message      string        `json:"message,omitempty"`
}

func conversationView(row query.Conversation) Conversation {
	return Conversation{ID: row.ID, Title: row.Title, ModelID: row.ModelID, Pinned: row.Pinned, Busy: row.ActiveRunID != nil, Version: row.Version, LastMessageAt: row.LastMessageAt.UTC(), CreatedAt: row.CreatedAt.UTC()}
}
func messageView(row query.Message) Message {
	var meta Metadata
	// Explicit metadata fields prevent routing identifiers from crossing the API boundary.
	if err := json.Unmarshal(row.Meta, &meta); err != nil {
		meta = Metadata{}
	}
	return Message{ID: row.ID, RequestID: row.RequestID, Role: row.Role, Content: row.Content, Status: row.Status, ModelID: row.ModelID, Meta: meta, CreatedAt: row.CreatedAt.UTC()}
}
