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

// ImageTarget resolves one route without retrying an upstream image write.
func (s *Service) ImageTarget(ctx context.Context, id uuid.UUID) (PublicModel, *upstream.Client, string, error) {
	row, err := s.queries.GetPlatformModel(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (row.Type != "image" || !row.Enabled)) {
		return PublicModel{}, nil, "", problem.New("IMAGE_MODEL_UNAVAILABLE", http.StatusConflict)
	}
	if err != nil {
		return PublicModel{}, nil, "", fmt.Errorf("read image model: %w", err)
	}
	model, err := publicView(row)
	if err != nil {
		return model, nil, "", err
	}
	targets, err := s.queries.ImageRouteTargets(ctx, id)
	if err != nil {
		return model, nil, "", fmt.Errorf("read image routes: %w", err)
	}
	if len(targets) == 0 {
		return model, nil, "", problem.New("IMAGE_MODEL_UNAVAILABLE", http.StatusConflict)
	}
	target := targets[0]
	client, err := s.adapter(query.Upstream{ID: target.ID, BaseUrl: target.BaseUrl, ApiKeyEnc: target.ApiKeyEnc, ProxyUrl: target.ProxyUrl, TimeoutChatS: target.TimeoutChatS, TimeoutImageS: target.TimeoutImageS, EditFormat: target.EditFormat})
	return model, client, target.UpstreamModelName, err
}
