package catalog

import (
	"context"
	"fmt"
	"net/http"

	"github.com/google/uuid"
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
	row, err := s.queries.GetPlatformModel(ctx, modelID)
	if err != nil || row.Type != "chat" || !row.Enabled {
		return PublicModel{}, nil, problem.New("CHAT_MODEL_UNAVAILABLE", http.StatusConflict)
	}
	model, err := publicView(row)
	if err != nil {
		return model, nil, err
	}
	if !model.Capabilities.Stream {
		return model, nil, problem.New("CHAT_MODEL_UNAVAILABLE", http.StatusConflict)
	}
	rows, err := s.queries.ChatRouteTargets(ctx, modelID)
	if err != nil {
		return model, nil, fmt.Errorf("read chat routes: %w", err)
	}
	targets := make([]ChatTarget, 0, len(rows))
	for _, r := range rows {
		targets = append(targets, ChatTarget{UpstreamID: r.ID, RemoteModel: r.UpstreamModelName, row: query.Upstream{
			ID: r.ID, BaseUrl: r.BaseUrl, ApiKeyEnc: r.ApiKeyEnc, ProxyUrl: r.ProxyUrl, TimeoutChatS: r.TimeoutChatS, TimeoutImageS: r.TimeoutImageS, EditFormat: r.EditFormat,
		}})
	}
	if len(targets) == 0 {
		return model, nil, problem.New("CHAT_MODEL_UNAVAILABLE", http.StatusConflict)
	}
	return model, targets, nil
}

func (s *Service) ChatClient(target ChatTarget) (*upstream.Client, error) {
	return s.adapter(target.row)
}
