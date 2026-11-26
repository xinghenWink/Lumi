package catalog

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/upstream/video"
)

type VideoRoute struct {
	ID             uuid.UUID
	ChannelID      uuid.UUID
	ChannelVersion int64
	RemoteModel    string
	Protocol       string
	Profile        string
	BaseURL        string
	ProxyURL       string
	EncryptedKey   string
	TimeoutSeconds int32
}

type VideoTarget struct {
	Route        VideoRoute
	Capabilities *video.Capabilities
}

func (s *Service) SetVideoRegistry(registry *video.Registry) { s.videoRegistry = registry }

func (s *Service) VideoBindings() []video.Binding {
	if s.videoRegistry == nil {
		return []video.Binding{}
	}
	return s.videoRegistry.Bindings()
}

func (s *Service) validateVideoRoutes(input ModelInput) error {
	if input.Type != "video" {
		return nil
	}
	for _, route := range input.Routes {
		if route.VideoProtocol == "" && !route.Enabled && route.VideoProfile == "" {
			continue
		}
		if s.videoRegistry == nil || !s.videoRegistry.Allows(route.VideoProtocol, route.VideoProfile) {
			return problem.Invalid()
		}
	}
	return nil
}

func (s *Service) VideoTargets(ctx context.Context, q *query.Queries, id uuid.UUID) (PublicModel, []VideoTarget, error) {
	model, err := q.GetPlatformModel(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (model.Type != "video" || !model.Enabled)) {
		return PublicModel{}, nil, problem.New("VIDEO_MODEL_UNAVAILABLE", 409)
	}
	if err != nil {
		return PublicModel{}, nil, fmt.Errorf("read video model: %w", err)
	}
	public, err := publicView(model)
	if err != nil {
		return public, nil, err
	}
	rows, err := q.VideoRouteTargets(ctx, id)
	if err != nil {
		return public, nil, fmt.Errorf("read video routes: %w", err)
	}
	targets := make([]VideoTarget, 0, len(rows))
	for _, row := range rows {
		route := row.ModelRoute
		channel := row.Upstream
		var caps *video.Capabilities
		if err := json.Unmarshal(route.VideoCapabilities, &caps); err != nil {
			return public, nil, fmt.Errorf("decode video route capabilities: %w", err)
		}
		targets = append(targets, VideoTarget{Route: VideoRoute{ID: route.ID, ChannelID: channel.ID, ChannelVersion: channel.Version, RemoteModel: route.UpstreamModelName, Protocol: route.VideoProtocol, Profile: route.VideoProfile, BaseURL: channel.BaseUrl, ProxyURL: channel.ProxyUrl, EncryptedKey: channel.ApiKeyEnc, TimeoutSeconds: channel.TimeoutImageS}, Capabilities: caps})
	}
	return public, targets, nil
}

func (s *Service) OpenVideoRoute(route VideoRoute) (video.Adapter, error) {
	if s.videoRegistry == nil {
		return nil, fmt.Errorf("video registry is unavailable")
	}
	key, err := s.vault.Decrypt(route.EncryptedKey, "upstream:"+route.ChannelID.String())
	if err != nil {
		return nil, fmt.Errorf("decrypt video connection: %w", err)
	}
	return s.videoRegistry.Open(route.Protocol, route.Profile, video.Connection{BaseURL: route.BaseURL, ProxyURL: route.ProxyURL, Key: key, Timeout: time.Duration(route.TimeoutSeconds) * time.Second})
}
