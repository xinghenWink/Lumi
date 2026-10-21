package audit

import (
	"context"
	"encoding/json"
	"fmt"
	"net/netip"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/pagination"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
)

type Entry struct {
	ActorID            *uuid.UUID
	Action, TargetType string
	TargetID           *uuid.UUID
	Before, After      any
	IP                 netip.Addr
}

func Write(ctx context.Context, repository *query.Queries, entry Entry) error {
	id, err := validation.NewID()
	if err != nil {
		return err
	}
	before, err := json.Marshal(entry.Before)
	if err != nil {
		return fmt.Errorf("encode audit before state: %w", err)
	}
	after, err := json.Marshal(entry.After)
	if err != nil {
		return fmt.Errorf("encode audit after state: %w", err)
	}
	if err := repository.AppendAudit(ctx, query.AppendAuditParams{
		ID: id, ActorID: entry.ActorID, Action: entry.Action, TargetType: entry.TargetType,
		TargetID: entry.TargetID, Before: before, After: after, Ip: entry.IP,
	}); err != nil {
		return fmt.Errorf("append audit record: %w", err)
	}
	return nil
}

// UserSnapshot is deliberately an allowlist; it cannot serialize hashes or tokens.
func UserSnapshot(record query.User) map[string]any {
	return map[string]any{"id": record.ID, "email": validation.MaskEmail(record.Email),
		"nickname": record.Nickname, "role": record.Role, "status": record.Status, "deleted": record.DeletedAt != nil}
}

type Record struct {
	ID         uuid.UUID       `json:"id"`
	ActorID    *uuid.UUID      `json:"actor_id"`
	Action     string          `json:"action"`
	TargetType string          `json:"target_type"`
	TargetID   *uuid.UUID      `json:"target_id"`
	Before     json.RawMessage `json:"before"`
	After      json.RawMessage `json:"after"`
	IP         string          `json:"ip"`
	CreatedAt  time.Time       `json:"created_at"`
}

type Filter struct {
	ActorID, TargetID          *uuid.UUID
	Action, TargetType, Cursor string
	From, Until                *time.Time
	Limit                      int32
}

type Page struct {
	Items      []Record `json:"items"`
	NextCursor string   `json:"next_cursor"`
}

type Service struct{ queries *query.Queries }

func New(pool *pgxpool.Pool) *Service { return &Service{queries: query.New(pool)} }

func (s *Service) List(ctx context.Context, filter Filter) (Page, error) {
	if filter.Limit < 1 || filter.Limit > 100 || len(filter.Action) > 100 || len(filter.TargetType) > 30 {
		return Page{}, problem.Invalid()
	}
	encoded, err := json.Marshal([]any{filter.ActorID, filter.TargetID, filter.Action, filter.TargetType, filter.From, filter.Until})
	if err != nil {
		return Page{}, fmt.Errorf("encode audit filters: %w", err)
	}
	fingerprint := pagination.Fingerprint(string(encoded))
	cursor, err := pagination.Decode(filter.Cursor, fingerprint)
	if err != nil {
		return Page{}, err
	}
	records, err := s.queries.ListAuditLogs(ctx, query.ListAuditLogsParams{
		ActorFilter: filter.ActorID, ActionFilter: filter.Action, TargetTypeFilter: filter.TargetType,
		TargetIDFilter: filter.TargetID, CreatedFrom: filter.From, CreatedUntil: filter.Until,
		CursorTime: cursor.Time, CursorID: cursor.ID, PageLimit: filter.Limit + 1,
	})
	if err != nil {
		return Page{}, fmt.Errorf("list audit records: %w", err)
	}
	page := Page{Items: make([]Record, 0, len(records))}
	if len(records) > int(filter.Limit) {
		records = records[:filter.Limit]
		last := records[len(records)-1]
		page.NextCursor, err = pagination.Encode(last.CreatedAt, last.ID, fingerprint)
		if err != nil {
			return Page{}, err
		}
	}
	for _, record := range records {
		page.Items = append(page.Items, Record{ID: record.ID, ActorID: record.ActorID,
			Action: record.Action, TargetType: record.TargetType, TargetID: record.TargetID,
			Before: record.Before, After: record.After, IP: record.Ip.String(), CreatedAt: record.CreatedAt.UTC()})
	}
	return page, nil
}
