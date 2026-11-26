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

func deleteModels(ctx context.Context, q *query.Queries, ids []uuid.UUID) error {
	if len(ids) == 0 {
		return nil
	}
	if err := q.LockCreditConfiguration(ctx); err != nil {
		return fmt.Errorf("lock model pricing: %w", err)
	}
	if err := q.DeleteModelsPricing(ctx, ids); err != nil {
		return fmt.Errorf("delete model price overrides: %w", err)
	}
	if err := q.DeletePlatformModels(ctx, ids); err != nil {
		return fmt.Errorf("delete platform models: %w", err)
	}
	return nil
}

func (s *Service) BatchChannelModels(ctx context.Context, actor user.Actor, id uuid.UUID, input ChannelModelBatchInput) (ChannelModelBatchResult, error) {
	if input.Action != "enable" && input.Action != "disable" && input.Action != "delete" {
		return ChannelModelBatchResult{}, problem.Invalid()
	}
	var exclusive, shared []uuid.UUID
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		if err := q.LockModelConfiguration(ctx); err != nil {
			return fmt.Errorf("lock channel models: %w", err)
		}
		if _, err := q.GetUpstream(ctx, id); errors.Is(err, pgx.ErrNoRows) {
			return problem.New("UPSTREAM_NOT_FOUND", http.StatusNotFound)
		} else if err != nil {
			return fmt.Errorf("read batch channel: %w", err)
		}
		members, err := q.ListChannelModelMembership(ctx, id)
		if err != nil {
			return fmt.Errorf("classify channel models: %w", err)
		}
		exclusive = make([]uuid.UUID, 0, len(members))
		shared = make([]uuid.UUID, 0, len(members))
		for _, model := range members {
			if model.Shared {
				shared = append(shared, model.ModelID)
			} else {
				exclusive = append(exclusive, model.ModelID)
			}
		}
		if input.Action == "delete" {
			if err := deleteModels(ctx, q, exclusive); err != nil {
				return err
			}
			if err := q.DeleteChannelModelRoutes(ctx, query.DeleteChannelModelRoutesParams{UpstreamID: id, ModelIds: shared}); err != nil {
				return fmt.Errorf("remove shared model routes: %w", err)
			}
		} else {
			enabled := input.Action == "enable"
			exclusive, err = q.SetPlatformModelsEnabled(ctx, query.SetPlatformModelsEnabledParams{Enabled: enabled, ModelIds: exclusive})
			if err != nil {
				return fmt.Errorf("set channel models enabled: %w", err)
			}
			shared, err = q.SetChannelModelRoutesEnabled(ctx, query.SetChannelModelRoutesEnabledParams{UpstreamID: id, Enabled: enabled, ModelIds: shared})
			if err != nil {
				return fmt.Errorf("set shared model routes enabled: %w", err)
			}
		}
		if err := q.BumpPlatformModelVersions(ctx, shared); err != nil {
			return fmt.Errorf("update shared model versions: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "model.channel_batch", TargetType: "upstream", TargetID: &id, IP: actor.IP, After: map[string]any{
			"action": input.Action, "exclusive_model_ids": exclusive, "shared_model_ids": shared,
		}})
	})
	if err != nil {
		return ChannelModelBatchResult{}, err
	}
	return ChannelModelBatchResult{AffectedExclusiveModels: len(exclusive), AffectedSharedModels: len(shared)}, nil
}
