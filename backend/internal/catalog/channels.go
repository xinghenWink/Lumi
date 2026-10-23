package catalog

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/http/middleware"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/pagination"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/secrets"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/upstream"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

type Service struct {
	pool    *pgxpool.Pool
	queries *query.Queries
	vault   *secrets.Vault
	policy  upstream.NetworkPolicy
	logger  *slog.Logger
}

func New(pool *pgxpool.Pool, vault *secrets.Vault, policy upstream.NetworkPolicy, logger *slog.Logger) *Service {
	return &Service{pool: pool, queries: query.New(pool), vault: vault, policy: policy, logger: logger}
}
func configError(err error) error {
	var postgres *pgconn.PgError
	if errors.As(err, &postgres) && postgres.Code == "23505" {
		return problem.New("CONFIGURATION_DUPLICATE", http.StatusConflict)
	}
	return err
}
func baseChannelView(row query.Upstream) Channel {
	return Channel{ID: row.ID, Version: row.Version, Name: row.Name, BaseURL: row.BaseUrl, APIKeyConfigured: row.ApiKeyEnc != "", TimeoutChatS: row.TimeoutChatS, TimeoutImageS: row.TimeoutImageS, ProxyURL: row.ProxyUrl, Enabled: row.Enabled, Priority: row.Priority, Weight: row.Weight, EditFormat: row.EditFormat, Note: row.Note, CreatedAt: row.CreatedAt.UTC(), UpdatedAt: row.UpdatedAt.UTC()}
}
func validRank(priority, weight int32) bool {
	return priority >= 0 && priority <= 10000 && weight >= 1 && weight <= 10000
}
func validFilter(filter Filter) bool {
	return filter.Limit >= 1 && filter.Limit <= 100 && len(filter.Search) <= 100 && (filter.State == "" || filter.State == "enabled" || filter.State == "disabled") && (filter.Kind == "" || filter.Kind == "chat" || filter.Kind == "image")
}
func (s *Service) Channels(ctx context.Context, filter Filter) (Page[Channel], error) {
	if !validFilter(filter) {
		return Page[Channel]{}, problem.Invalid()
	}
	fingerprint := pagination.Fingerprint("upstreams:" + filter.Search + ":" + filter.State)
	cursor, err := pagination.Decode(filter.Cursor, fingerprint)
	if err != nil {
		return Page[Channel]{}, err
	}
	rows, err := s.queries.ListUpstreams(ctx, query.ListUpstreamsParams{Search: filter.Search, StateFilter: filter.State, CursorTime: cursor.Time, CursorID: &cursor.ID, PageLimit: filter.Limit + 1})
	if err != nil {
		return Page[Channel]{}, fmt.Errorf("list channels: %w", err)
	}
	result := Page[Channel]{Items: make([]Channel, 0, len(rows))}
	if len(rows) > int(filter.Limit) {
		rows = rows[:filter.Limit]
		last := rows[len(rows)-1]
		result.NextCursor, err = pagination.Encode(last.CreatedAt, last.ID, fingerprint)
		if err != nil {
			return result, err
		}
	}
	for _, row := range rows {
		result.Items = append(result.Items, channelView(row))
	}
	return result, nil
}
func channelInput(input *ChannelInput) error {
	input.Name = strings.TrimSpace(input.Name)
	input.Note = strings.TrimSpace(input.Note)
	parsed, err := upstream.ParseURL(input.BaseURL)
	if err != nil || !validation.Text(input.Name, 1, 80) || !validation.Text(input.Note, 0, 500) || !validRank(input.Priority, input.Weight) || input.TimeoutChatS < 1 || input.TimeoutChatS > 600 || input.TimeoutImageS < 1 || input.TimeoutImageS > 600 || (input.EditFormat != "multipart" && input.EditFormat != "json") {
		return problem.Invalid()
	}
	input.BaseURL = parsed.String()
	if input.ProxyURL != "" {
		proxy, err := upstream.ParseURL(input.ProxyURL)
		if err != nil || proxy.Path != "" {
			return problem.Invalid()
		}
		input.ProxyURL = proxy.String()
	}
	if input.APIKey != nil && (len(*input.APIKey) > 4096 || strings.ContainsAny(*input.APIKey, "\r\n\x00")) {
		return problem.Invalid()
	}
	return nil
}
func (s *Service) SaveChannel(ctx context.Context, actor user.Actor, id uuid.UUID, input ChannelInput) (Channel, error) {
	if err := channelInput(&input); err != nil {
		return Channel{}, err
	}
	creating := id == uuid.Nil
	if creating && (input.APIKey == nil || strings.TrimSpace(*input.APIKey) == "") {
		return Channel{}, problem.Invalid()
	}
	var result Channel
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		if err := q.LockModelConfiguration(ctx); err != nil {
			return fmt.Errorf("lock channel configuration: %w", err)
		}
		var before any
		encrypted := ""
		if creating {
			var err error
			id, err = validation.NewID()
			if err != nil {
				return err
			}
		} else {
			old, err := q.LockUpstream(ctx, id)
			if errors.Is(err, pgx.ErrNoRows) {
				return problem.New("UPSTREAM_NOT_FOUND", http.StatusNotFound)
			}
			if err != nil {
				return fmt.Errorf("lock channel: %w", err)
			}
			if old.Version != input.Version {
				return problem.New("CONFIGURATION_CONFLICT", http.StatusConflict)
			}
			before = channelView(old)
			encrypted = old.ApiKeyEnc
		}
		if input.APIKey != nil {
			var err error
			encrypted, err = s.vault.Encrypt(strings.TrimSpace(*input.APIKey), "upstream:"+id.String())
			if err != nil {
				return err
			}
		}
		if input.Enabled && encrypted == "" {
			return problem.Invalid()
		}
		var row query.Upstream
		var err error
		if creating {
			row, err = q.CreateUpstream(ctx, query.CreateUpstreamParams{ID: id, Name: input.Name, BaseUrl: input.BaseURL, ApiKeyEnc: encrypted, TimeoutChatS: input.TimeoutChatS, TimeoutImageS: input.TimeoutImageS, ProxyUrl: input.ProxyURL, Enabled: input.Enabled, Priority: input.Priority, Weight: input.Weight, EditFormat: input.EditFormat, Note: input.Note})
		} else {
			row, err = q.UpdateUpstream(ctx, query.UpdateUpstreamParams{ID: id, Name: input.Name, BaseUrl: input.BaseURL, ApiKeyEnc: encrypted, TimeoutChatS: input.TimeoutChatS, TimeoutImageS: input.TimeoutImageS, ProxyUrl: input.ProxyURL, Enabled: input.Enabled, Priority: input.Priority, Weight: input.Weight, EditFormat: input.EditFormat, Note: input.Note})
		}
		if err != nil {
			return fmt.Errorf("save channel: %w", configError(err))
		}
		result = channelView(row)
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "upstream.save", TargetType: "upstream", TargetID: &id, Before: before, After: result, IP: actor.IP})
	})
	return result, err
}
func (s *Service) DeleteChannel(ctx context.Context, actor user.Actor, id uuid.UUID) error {
	return db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		if err := q.LockModelConfiguration(ctx); err != nil {
			return fmt.Errorf("lock channel deletion: %w", err)
		}
		old, err := q.LockUpstream(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.New("UPSTREAM_NOT_FOUND", http.StatusNotFound)
		}
		if err != nil {
			return fmt.Errorf("lock deleted channel: %w", err)
		}
		if err := q.DeleteUpstream(ctx, id); err != nil {
			return fmt.Errorf("delete channel: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "upstream.delete", TargetType: "upstream", TargetID: &id, Before: channelView(old), IP: actor.IP})
	})
}
func (s *Service) adminChannel(ctx context.Context, actor user.Actor, id uuid.UUID) (query.Upstream, error) {
	var row query.Upstream
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		var err error
		row, err = q.GetUpstream(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.New("UPSTREAM_NOT_FOUND", http.StatusNotFound)
		}
		if err != nil {
			return fmt.Errorf("read channel: %w", err)
		}
		return nil
	})
	return row, err
}
func (s *Service) adapter(row query.Upstream) (*upstream.Client, error) {
	key, err := s.vault.Decrypt(row.ApiKeyEnc, "upstream:"+row.ID.String())
	if err != nil {
		return nil, err
	}
	if key == "" {
		return nil, problem.New("UPSTREAM_AUTH_FAILED", http.StatusConflict)
	}
	return upstream.NewClient(upstream.Connection{BaseURL: row.BaseUrl, APIKey: key, ProxyURL: row.ProxyUrl, ChatTimeout: time.Duration(row.TimeoutChatS) * time.Second, ImageTimeout: time.Duration(row.TimeoutImageS) * time.Second, EditFormat: row.EditFormat}, s.policy, func(ctx context.Context, call upstream.Call) { s.recordCall(ctx, row.ID, call) })
}
func (s *Service) recordCall(ctx context.Context, id uuid.UUID, call upstream.Call) {
	status := call.Status
	if status < 0 || status > 999 {
		status = 0
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
	defer cancel()
	// User cancellation and content rejection do not indicate provider health failures.
	if call.ErrorCode != "" && call.ErrorCode != "UPSTREAM_CANCELED" && call.ErrorCode != "UPSTREAM_REJECTED" && call.ErrorCode != "UPSTREAM_REQUEST_INVALID" {
		threshold, duration, cfgErr := s.circuitConfig(ctx)
		if cfgErr == nil {
			if err := s.queries.RecordCircuitFailure(ctx, query.RecordCircuitFailureParams{ID: id, LastError: call.ErrorCode, Threshold: threshold, Duration: duration}); err != nil && s.logger != nil {
				s.logger.ErrorContext(ctx, "record upstream circuit failed")
			}
		}
	}
	callID, err := validation.NewID()
	if err == nil {
		entry := query.AppendUpstreamCallParams{ID: callID, UpstreamID: id, Model: call.Model, Kind: call.Kind, LatencyMs: call.LatencyMS, Status: int32(status), ErrorSummary: call.ErrorCode, RequestID: middleware.RequestID(ctx)}
		if call.ErrorCode == "" {
			err = s.queries.RecordSuccessfulUpstreamCall(ctx, entry)
		} else {
			err = s.queries.AppendUpstreamCall(ctx, entry)
		}
	}
	if err != nil && s.logger != nil {
		s.logger.ErrorContext(ctx, "record upstream call failed", "error_type", fmt.Sprintf("%T", err))
	}
}
func (s *Service) Test(ctx context.Context, actor user.Actor, id uuid.UUID) (ConnectionTest, error) {
	row, err := s.adminChannel(ctx, actor, id)
	if err != nil {
		return ConnectionTest{}, err
	}
	client, err := s.adapter(row)
	if err != nil {
		return ConnectionTest{}, err
	}
	defer client.Close()
	start := time.Now()
	models, callErr := client.ListModels(ctx)
	result := ConnectionTest{Success: callErr == nil, LatencyMS: time.Since(start).Milliseconds(), ErrorCode: upstream.FailureCode(callErr), ModelCount: len(models), Status: 200}
	var failure *upstream.Failure
	if callErr != nil {
		result.Status = 0
		if errors.As(callErr, &failure) {
			result.Status = failure.Status
		}
	}
	err = db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "upstream.test", TargetType: "upstream", TargetID: &id, After: result, IP: actor.IP})
	})
	return result, err
}
func (s *Service) Discover(ctx context.Context, actor user.Actor, id uuid.UUID) (Discovery, error) {
	row, err := s.adminChannel(ctx, actor, id)
	if err != nil {
		return Discovery{}, err
	}
	client, err := s.adapter(row)
	if err != nil {
		return Discovery{}, err
	}
	defer client.Close()
	models, err := client.ListModels(ctx)
	if err != nil {
		return Discovery{}, problem.New(upstream.FailureCode(err), http.StatusBadGateway)
	}
	result := Discovery{UpstreamID: id, Version: row.Version, Models: models}
	err = db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "upstream.discover", TargetType: "upstream", TargetID: &id, After: map[string]int{"model_count": len(models)}, IP: actor.IP})
	})
	return result, err
}

// Config fingerprints bind cursors to the submitted filters, never draft UI input.
func filterFingerprint(filter Filter) (string, error) {
	encoded, err := json.Marshal([]string{filter.Search, filter.State, filter.Kind})
	if err != nil {
		return "", fmt.Errorf("encode model filters: %w", err)
	}
	return pagination.Fingerprint(string(encoded)), nil
}
