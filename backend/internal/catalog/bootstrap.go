package catalog

import (
	"context"
	"fmt"
	"net/netip"
	"strings"

	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
)

// Bootstrap only writes an empty catalog and does not issue paid provider calls.
func (s *Service) Bootstrap(ctx context.Context, baseURL, key string) error {
	if baseURL == "" && key == "" {
		return nil
	}
	if baseURL == "" || strings.TrimSpace(key) == "" {
		return fmt.Errorf("upstream bootstrap requires both URL and API key")
	}
	input := ChannelInput{Name: "Default", BaseURL: baseURL, APIKey: &key, Enabled: true, Weight: 1, TimeoutChatS: 120, TimeoutImageS: 180, EditFormat: "multipart"}
	if err := channelInput(&input); err != nil {
		return err
	}
	return db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := q.LockModelConfiguration(ctx); err != nil {
			return fmt.Errorf("lock upstream bootstrap: %w", err)
		}
		count, err := q.CountUpstreams(ctx)
		if err != nil {
			return fmt.Errorf("count bootstrap channels: %w", err)
		}
		if count > 0 {
			return nil
		}
		id, err := validation.NewID()
		if err != nil {
			return err
		}
		encrypted, err := s.vault.Encrypt(key, "upstream:"+id.String())
		if err != nil {
			return err
		}
		_, err = q.CreateUpstream(ctx, query.CreateUpstreamParams{ID: id, Name: input.Name, BaseUrl: input.BaseURL, ApiKeyEnc: encrypted, Enabled: true, Weight: 1, TimeoutChatS: 120, TimeoutImageS: 180, EditFormat: "multipart"})
		if err != nil {
			return fmt.Errorf("create bootstrap channel: %w", err)
		}
		for _, model := range []ModelInput{
			{DisplayName: "ChatGPT", Type: "chat", Enabled: true, IsDefault: true, Capabilities: Capabilities{Stream: true, MaxContextTokens: 32000}, Routes: []RouteInput{{UpstreamID: id, UpstreamModelName: "gpt-5-3-mini", Weight: 1, Enabled: true}}},
			{DisplayName: "GPT Image", Type: "image", Enabled: true, IsDefault: true, Capabilities: Capabilities{Qualities: []string{"low"}, Sizes: []string{"1024x1024"}, MaxN: 1, SupportsEdit: true, MaxReferenceImages: 1, ResponseFormat: "b64_json"}, Routes: []RouteInput{{UpstreamID: id, UpstreamModelName: "gpt-image-2", Weight: 1, Enabled: true}}},
		} {
			if err := modelInput(&model); err != nil {
				return err
			}
			if _, _, err := writeModel(ctx, q, uuid.Nil, model); err != nil {
				return err
			}
		}
		return audit.Write(ctx, q, audit.Entry{Action: "upstream.bootstrap", TargetType: "upstream", TargetID: &id, IP: netip.MustParseAddr("127.0.0.1")})
	})
}
