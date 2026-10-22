package catalog

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/upstream"
)

// ChatTarget is internal routing material and must never be serialized to clients.
type ChatTarget struct {
	UpstreamID  uuid.UUID
	RemoteModel string
	row         query.Upstream
}

func (s *Service) ChatTargets(ctx context.Context, modelID uuid.UUID) (PublicModel, []ChatTarget, error) {
	return s.ChatTargetsTx(ctx, s.queries, modelID)
}

// ChatTargetsTx avoids nested pool acquisition during transactional validation.
func (s *Service) ChatTargetsTx(ctx context.Context, q *query.Queries, modelID uuid.UUID) (PublicModel, []ChatTarget, error) {
	row, rows, err := q.ReadChatRouting(ctx, modelID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return PublicModel{}, nil, fmt.Errorf("read chat model: %w", err)
	}
	if errors.Is(err, pgx.ErrNoRows) || row.Type != "chat" || !row.Enabled {
		return PublicModel{}, nil, problem.New("CHAT_MODEL_UNAVAILABLE", http.StatusConflict)
	}
	model, err := publicView(row)
	if err != nil {
		return model, nil, err
	}
	if !model.Capabilities.Stream {
		return model, nil, problem.New("CHAT_MODEL_UNAVAILABLE", http.StatusConflict)
	}
	rows, err = WeightedOrder(rows)
	if err != nil {
		return model, nil, fmt.Errorf("read chat routes: %w", err)
	}
	targets := make([]ChatTarget, 0, len(rows))
	for _, r := range rows {
		targets = append(targets, ChatTarget{UpstreamID: r.Upstream.ID, RemoteModel: r.UpstreamModelName, row: r.Upstream})
	}
	if len(targets) == 0 {
		return model, nil, problem.New("CHAT_MODEL_UNAVAILABLE", http.StatusConflict)
	}
	return model, targets, nil
}

func (s *Service) ChatClient(target ChatTarget) (*upstream.Client, error) {
	return s.adapter(target.row)
}

func (s *Service) RoutedChatClient(ctx context.Context, target ChatTarget) (*upstream.Client, error) {
	if err := s.permit(ctx, target.UpstreamID); err != nil {
		return nil, err
	}
	return s.adapter(target.row)
}
