package images

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xinghenWink/Lumi/backend/internal/catalog"
	"github.com/xinghenWink/Lumi/backend/internal/credits"
	"github.com/xinghenWink/Lumi/backend/internal/media"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
)

type Queue interface {
	Ping(context.Context) error
	EnqueueImage(context.Context, string, time.Time) error
	PopImages(context.Context) ([]string, error)
}
type Service struct {
	pool    *pgxpool.Pool
	q       *query.Queries
	billing *credits.Service
	catalog *catalog.Service
	files   *media.Store
	queue   Queue
	logger  *slog.Logger
}

func New(pool *pgxpool.Pool, billing *credits.Service, models *catalog.Service, files *media.Store, queue Queue, logger *slog.Logger) *Service {
	return &Service{pool: pool, q: query.New(pool), billing: billing, catalog: models, files: files, queue: queue, logger: logger}
}

type Configuration struct {
	MaxN                int32             `json:"max_n"`
	MaxReferences       int32             `json:"max_references"`
	MaxUploadBytes      int64             `json:"max_upload_bytes"`
	Sizes               []string          `json:"sizes"`
	RatioSizes          map[string]string `json:"ratio_sizes"`
	PerUserConcurrency  int32             `json:"per_user_concurrency"`
	GlobalConcurrency   int32             `json:"global_concurrency"`
	TimeoutSeconds      int32             `json:"timeout_seconds"`
	QueueTimeoutSeconds int32             `json:"queue_timeout_seconds"`
	SplitRequests       bool              `json:"split_requests"`
	RetentionDays       int32             `json:"retention_days"`
	AdminCanViewContent bool              `json:"admin_can_view_content"`
	Version             int64             `json:"version"`
}
type Input struct {
	ConversationID   uuid.UUID   `json:"conversation_id"`
	ModelID          uuid.UUID   `json:"model_id"`
	Prompt           string      `json:"prompt"`
	Quality          string      `json:"quality"`
	Size             string      `json:"size"`
	Ratio            string      `json:"ratio"`
	Count            int32       `json:"n"`
	ReferenceFileIDs []uuid.UUID `json:"reference_file_ids"`
}
type Item struct {
	Position  int32       `json:"position"`
	Status    string      `json:"status"`
	FileID    *uuid.UUID  `json:"file_id"`
	File      *media.File `json:"file"`
	ErrorCode string      `json:"error_code"`
}
type Task struct {
	ID               uuid.UUID   `json:"id"`
	UserID           uuid.UUID   `json:"user_id"`
	ConversationID   uuid.UUID   `json:"conversation_id"`
	ModelID          uuid.UUID   `json:"model_id"`
	ModelName        string      `json:"model_name"`
	Operation        string      `json:"operation"`
	Prompt           string      `json:"prompt"`
	Quality          string      `json:"quality"`
	Size             string      `json:"size"`
	Ratio            string      `json:"ratio"`
	Count            int32       `json:"n"`
	ReferenceFileIDs []uuid.UUID `json:"reference_file_ids"`
	UnitPrice        int64       `json:"unit_price"`
	TotalCost        int64       `json:"total_cost"`
	RefundedCost     int64       `json:"refunded_cost"`
	ActualCost       int64       `json:"actual_cost"`
	Status           string      `json:"status"`
	SuccessfulImages int32       `json:"successful_images"`
	QueuePosition    int32       `json:"queue_position"`
	CancelRequested  bool        `json:"cancel_requested"`
	ErrorCode        string      `json:"error_code"`
	StartedAt        *time.Time  `json:"started_at"`
	FinishedAt       *time.Time  `json:"finished_at"`
	CreatedAt        time.Time   `json:"created_at"`
	Version          int64       `json:"version"`
	Items            []Item      `json:"items"`
	ContentVisible   bool        `json:"content_visible"`
}
type Filter struct {
	Owner                  *uuid.UUID
	Conversation           *uuid.UUID
	State, Quality, Cursor string
	From, Until            *time.Time
	Limit                  int32
}
type Page[T any] struct {
	Items      []T    `json:"items"`
	NextCursor string `json:"next_cursor"`
}
type Conversation struct {
	ID            uuid.UUID  `json:"id"`
	Title         string     `json:"title"`
	ModelID       *uuid.UUID `json:"model_id"`
	Pinned        bool       `json:"pinned"`
	Version       int64      `json:"version"`
	LastMessageAt time.Time  `json:"last_message_at"`
	CreatedAt     time.Time  `json:"created_at"`
}

func conversation(row query.Conversation) Conversation {
	return Conversation{ID: row.ID, Title: row.Title, ModelID: row.ModelID, Pinned: row.Pinned, Version: row.Version, LastMessageAt: row.LastMessageAt.UTC(), CreatedAt: row.CreatedAt.UTC()}
}

type GalleryImage struct {
	File           media.File `json:"file"`
	TaskID         uuid.UUID  `json:"task_id"`
	ConversationID uuid.UUID  `json:"conversation_id"`
	ModelID        uuid.UUID  `json:"model_id"`
	ModelName      string     `json:"model_name"`
	Prompt         string     `json:"prompt"`
	Quality        string     `json:"quality"`
	Size           string     `json:"size"`
	Ratio          string     `json:"ratio"`
	Status         string     `json:"status"`
	UnitPrice      int64      `json:"unit_price"`
}

func Terminal(status string) bool {
	return status == "succeeded" || status == "partial" || status == "failed" || status == "canceled"
}
