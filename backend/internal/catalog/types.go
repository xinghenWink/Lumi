package catalog

import (
	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/upstream"
	"time"
)

type Page[T any] struct {
	Items      []T    `json:"items"`
	NextCursor string `json:"next_cursor"`
}
type Filter struct {
	Search, State, Kind, Cursor string
	Limit                       int32
}
type ChannelInput struct {
	Version       int64   `json:"version"`
	Name          string  `json:"name"`
	BaseURL       string  `json:"base_url"`
	APIKey        *string `json:"api_key"`
	TimeoutChatS  int32   `json:"timeout_chat_s"`
	TimeoutImageS int32   `json:"timeout_image_s"`
	ProxyURL      string  `json:"proxy_url"`
	Enabled       bool    `json:"enabled"`
	Priority      int32   `json:"priority"`
	Weight        int32   `json:"weight"`
	EditFormat    string  `json:"edit_format"`
	Note          string  `json:"note"`
}

// Channel is an allowlist: API credentials and encrypted values have no DTO field.
type Channel struct {
	ID               uuid.UUID `json:"id"`
	Version          int64     `json:"version"`
	Name             string    `json:"name"`
	BaseURL          string    `json:"base_url"`
	APIKeyConfigured bool      `json:"api_key_configured"`
	TimeoutChatS     int32     `json:"timeout_chat_s"`
	TimeoutImageS    int32     `json:"timeout_image_s"`
	ProxyURL         string    `json:"proxy_url"`
	Enabled          bool      `json:"enabled"`
	Priority         int32     `json:"priority"`
	Weight           int32     `json:"weight"`
	EditFormat       string    `json:"edit_format"`
	Note             string    `json:"note"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}
type Capabilities struct {
	Vision             bool     `json:"vision"`
	Stream             bool     `json:"stream"`
	MaxContextTokens   int32    `json:"max_context_tokens"`
	Qualities          []string `json:"qualities"`
	Sizes              []string `json:"sizes"`
	MaxN               int32    `json:"max_n"`
	SupportsEdit       bool     `json:"supports_edit"`
	MaxReferenceImages int32    `json:"max_reference_images"`
	ResponseFormat     string   `json:"response_format"`
}
type RouteInput struct {
	UpstreamID        uuid.UUID `json:"upstream_id"`
	UpstreamModelName string    `json:"upstream_model_name"`
	Priority          int32     `json:"priority"`
	Weight            int32     `json:"weight"`
	Enabled           bool      `json:"enabled"`
}
type Route struct {
	RouteInput
	ID              uuid.UUID `json:"id"`
	UpstreamName    string    `json:"upstream_name"`
	UpstreamEnabled bool      `json:"upstream_enabled"`
}
type ModelInput struct {
	Version      int64        `json:"version"`
	DisplayName  string       `json:"display_name"`
	Type         string       `json:"type"`
	Description  string       `json:"description"`
	Icon         string       `json:"icon"`
	SortOrder    int32        `json:"sort_order"`
	Enabled      bool         `json:"enabled"`
	IsDefault    bool         `json:"is_default"`
	Capabilities Capabilities `json:"capabilities"`
	Routes       []RouteInput `json:"routes"`
}

// PublicModel contains only platform-facing fields, never a channel or wire model identifier.
type PublicModel struct {
	ID           uuid.UUID    `json:"id"`
	DisplayName  string       `json:"display_name"`
	Type         string       `json:"type"`
	Description  string       `json:"description"`
	Icon         string       `json:"icon"`
	SortOrder    int32        `json:"sort_order"`
	IsDefault    bool         `json:"is_default"`
	Capabilities Capabilities `json:"capabilities"`
}
type Model struct {
	PublicModel
	Version   int64     `json:"version"`
	Enabled   bool      `json:"enabled"`
	Routes    []Route   `json:"routes"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
type Discovery struct {
	UpstreamID uuid.UUID              `json:"upstream_id"`
	Version    int64                  `json:"version"`
	Models     []upstream.RemoteModel `json:"models"`
}
type ConnectionTest struct {
	Success    bool   `json:"success"`
	LatencyMS  int64  `json:"latency_ms"`
	Status     int    `json:"status"`
	ErrorCode  string `json:"error_code"`
	ModelCount int    `json:"model_count"`
}
type ImportModel struct {
	RemoteID     string       `json:"remote_id"`
	DisplayName  string       `json:"display_name"`
	Type         string       `json:"type"`
	Capabilities Capabilities `json:"capabilities"`
}
type ImportInput struct {
	Version int64         `json:"version"`
	Models  []ImportModel `json:"models"`
}
