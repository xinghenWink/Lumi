package catalog

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

// Import verifies discovery again, then atomically creates only previously unbound models.
func (s *Service) Import(ctx context.Context, actor user.Actor, id uuid.UUID, input ImportInput) ([]Model, error) {
	if len(input.Models) < 1 || len(input.Models) > 100 {
		return nil, problem.Invalid()
	}
	discovery, err := s.Discover(ctx, actor, id)
	if err != nil {
		return nil, err
	}
	if discovery.Version != input.Version {
		return nil, problem.New("CONFIGURATION_CONFLICT", http.StatusConflict)
	}
	allowed := make(map[string]bool, len(discovery.Models))
	for _, model := range discovery.Models {
		allowed[model.ID] = true
	}
	seen := map[string]bool{}
	for _, model := range input.Models {
		if !allowed[model.RemoteID] || seen[model.RemoteID] {
			return nil, problem.Invalid()
		}
		seen[model.RemoteID] = true
		proposal := ModelInput{DisplayName: model.DisplayName, Type: model.Type, Capabilities: model.Capabilities}
		if err := modelInput(&proposal); err != nil {
			return nil, err
		}
	}
	result := make([]Model, 0, len(input.Models))
	err = db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		if err := q.LockModelConfiguration(ctx); err != nil {
			return fmt.Errorf("lock imported models: %w", err)
		}
		channel, err := q.LockUpstream(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.New("UPSTREAM_NOT_FOUND", http.StatusNotFound)
		}
		if err != nil {
			return fmt.Errorf("lock import channel: %w", err)
		}
		if channel.Version != input.Version {
			return problem.New("CONFIGURATION_CONFLICT", http.StatusConflict)
		}
		created := make([]uuid.UUID, 0, len(input.Models))
		for _, model := range input.Models {
			existing, err := q.FindImportedModel(ctx, query.FindImportedModelParams{UpstreamID: id, UpstreamModelName: model.RemoteID})
			if err == nil {
				view, err := modelView(ctx, q, existing)
				if err != nil {
					return err
				}
				result = append(result, view)
				continue
			}
			if !errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("check previous model import: %w", err)
			}
			proposal := ModelInput{DisplayName: model.DisplayName, Type: model.Type, Capabilities: model.Capabilities, Routes: []RouteInput{{UpstreamID: id, UpstreamModelName: model.RemoteID, Priority: channel.Priority, Weight: channel.Weight, Enabled: true}}}
			if err := modelInput(&proposal); err != nil {
				return err
			}
			view, _, err := writeModel(ctx, q, uuid.Nil, proposal)
			if err != nil {
				return err
			}
			result = append(result, view)
			created = append(created, view.ID)
		}
		// Imported capabilities require review before enabling a new public model.
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "model.import", TargetType: "upstream", TargetID: &id, After: map[string]any{"created_ids": created, "selected_count": len(input.Models)}, IP: actor.IP})
	})
	return result, err
}

func (s *Service) PurgeCalls(ctx context.Context) (int64, error) {
	count, err := s.queries.PurgeUpstreamCalls(ctx)
	if err != nil {
		return 0, fmt.Errorf("purge old upstream calls: %w", err)
	}
	return count, nil
}
