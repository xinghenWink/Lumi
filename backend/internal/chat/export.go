package chat

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
)

type Export struct {
	Conversation Conversation `json:"conversation"`
	Messages     []Message    `json:"messages"`
}

// Export returns complete conversations within a bounded response, never silent truncation.
func (s *Service) Export(ctx context.Context, owner uuid.UUID, id *uuid.UUID) ([]Export, error) {
	result := []Export{}
	cursor := ""
	size := 0
	for {
		page := Page[Conversation]{}
		var err error
		if id != nil {
			row, e := s.Conversation(ctx, owner, *id)
			if e != nil {
				return nil, e
			}
			page.Items = []Conversation{row}
		} else {
			page, err = s.List(ctx, owner, "", cursor, 100)
			if err != nil {
				return nil, err
			}
		}
		for _, row := range page.Items {
			data := Export{Conversation: row, Messages: []Message{}}
			next := ""
			for {
				messages, err := s.Messages(ctx, owner, row.ID, next, 100)
				if err != nil {
					return nil, err
				}
				for _, m := range messages.Items {
					size += len(m.Content) + 1024
				}
				if size > 32<<20 {
					return nil, problem.New("EXPORT_TOO_LARGE", 413)
				}
				data.Messages = append(data.Messages, messages.Items...)
				next = messages.NextCursor
				if next == "" {
					break
				}
			}
			for l, r := 0, len(data.Messages)-1; l < r; l, r = l+1, r-1 {
				data.Messages[l], data.Messages[r] = data.Messages[r], data.Messages[l]
			}
			result = append(result, data)
		}
		cursor = page.NextCursor
		if id != nil || cursor == "" {
			return result, nil
		}
	}
}
func MarkdownExport(rows []Export) string {
	var out strings.Builder
	for _, row := range rows {
		fmt.Fprintf(&out, "# %s\n\n", row.Conversation.Title)
		for _, m := range row.Messages {
			fmt.Fprintf(&out, "## %s · %s\n\n%s\n\n", m.Role, m.CreatedAt.UTC().Format("2006-01-02 15:04:05 UTC"), m.Content)
		}
	}
	return out.String()
}
