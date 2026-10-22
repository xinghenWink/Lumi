package chat

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/media"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/upstream"
)

func (s *Service) SetFiles(files *media.Store) { s.files = files }
func (s *Service) attachVision(ctx context.Context, owner uuid.UUID, history []query.Message, messages []upstream.Message) error {
	offset := 0
	if len(messages) > 0 && messages[0].Role == "system" {
		offset = 1
	}
	count := len(messages) - offset
	bytesUsed := 0
	for i, row := range history[len(history)-count:] {
		if len(row.ReferenceFileIds) == 0 {
			continue
		}
		if s.files == nil {
			return problem.New("FILE_NOT_FOUND", 404)
		}
		parts := []map[string]any{{"type": "text", "text": row.Content}}
		for _, id := range row.ReferenceFileIds {
			data, err := s.files.VisionReference(ctx, owner, id)
			if err != nil {
				return err
			}
			parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]string{"url": "data:image/png;base64," + base64.StdEncoding.EncodeToString(data)}})
		}
		raw, err := json.Marshal(parts)
		if err != nil {
			return fmt.Errorf("encode vision context: %w", err)
		}
		messages[offset+i].Content = raw
	}
	for _, message := range messages {
		bytesUsed += len(message.Content)
	}
	if bytesUsed > 3<<20 {
		return problem.New("CHAT_CONTEXT_TOO_LARGE", 400)
	}
	return nil
}
