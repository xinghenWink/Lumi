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
	return s.ImageTargetTx(ctx, s.queries, id)
}

// ImageTargetTx keeps route lookups on the caller's transaction connection.
// Acquiring another pool connection here can deadlock concurrent submissions.
func (s *Service) ImageTargetTx(ctx context.Context, q *query.Queries, id uuid.UUID) (PublicModel, *upstream.Client, string, error) {
	row, err := q.GetPlatformModel(ctx, id)
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
	targets, err := routeTargets(ctx, q, id)
	if err != nil {
		return model, nil, "", fmt.Errorf("read image routes: %w", err)
	}
	if len(targets) == 0 {
		return model, nil, "", problem.New("IMAGE_MODEL_UNAVAILABLE", http.StatusConflict)
	}
	for _, target := range targets {
		client, err := s.adapter(target.Upstream)
		if err == nil {
			return model, client, target.UpstreamModelName, nil
		}
	}
	return model, nil, "", problem.New("IMAGE_MODEL_UNAVAILABLE", 503)
}

// RoutedImages retries only explicit refusals, never an ambiguous image write timeout.
func (s *Service) RoutedImages(ctx context.Context, id uuid.UUID, input upstream.ImageRequest, refs []upstream.Reference) ([]upstream.ImageResult, *upstream.Client, error) {
	targets, err := s.routeTargets(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	last := problem.New("IMAGE_MODEL_UNAVAILABLE", 503)
	for _, target := range targets {
		if err := s.permit(ctx, target.Upstream.ID); err != nil {
			last = err
			continue
		}
		client, err := s.adapter(target.Upstream)
		if err != nil {
			last = err
			continue
		}
		request := input
		request.Model = target.UpstreamModelName
		var results []upstream.ImageResult
		if len(refs) > 0 {
			results, err = client.EditImages(ctx, upstream.EditRequest{ImageRequest: request, References: refs})
		} else {
			results, err = client.GenerateImages(ctx, request)
		}
		if err == nil {
			return results, client, nil
		}
		last = err
		client.Close()
		code := upstream.FailureCode(err)
		if code != "UPSTREAM_RATE_LIMITED" && code != "UPSTREAM_AUTH_FAILED" && code != "UPSTREAM_NETWORK_BLOCKED" {
			return nil, nil, err
		}
	}
	return nil, nil, last
}
