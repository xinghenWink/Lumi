package images

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/media"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/pagination"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

func (s *Service) CreateConversation(ctx context.Context, actor user.Actor, id, modelID uuid.UUID) (Conversation, error) {
	if id == uuid.Nil || modelID == uuid.Nil {
		return Conversation{}, problem.Invalid()
	}
	_, client, _, err := s.catalog.ImageTarget(ctx, modelID)
	if err != nil {
		return Conversation{}, err
	}
	client.Close()
	var row query.Conversation
	err = db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := checkOwner(ctx, q, actor); err != nil {
			return err
		}
		var err error
		row, err = q.CreateImageConversation(ctx, query.CreateImageConversationParams{ID: id, UserID: actor.ID, ModelID: &modelID})
		if errors.Is(err, pgx.ErrNoRows) {
			row, err = q.GetImageConversation(ctx, query.GetImageConversationParams{ID: id, UserID: actor.ID})
		}
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.New("IMAGE_CONVERSATION_NOT_FOUND", 404)
		}
		if err != nil {
			return fmt.Errorf("create image conversation: %w", err)
		}
		if row.ModelID == nil || *row.ModelID != modelID {
			return problem.New("IDEMPOTENCY_CONFLICT", 409)
		}
		return nil
	})
	return conversation(row), err
}
func (s *Service) GetConversation(ctx context.Context, owner, id uuid.UUID) (Conversation, error) {
	row, err := s.q.GetImageConversation(ctx, query.GetImageConversationParams{ID: id, UserID: owner})
	if errors.Is(err, pgx.ErrNoRows) {
		return Conversation{}, problem.New("IMAGE_CONVERSATION_NOT_FOUND", 404)
	}
	if err != nil {
		return Conversation{}, fmt.Errorf("read image conversation: %w", err)
	}
	return conversation(row), nil
}
func (s *Service) Conversations(ctx context.Context, owner uuid.UUID, search, cursor string, limit int32) (Page[Conversation], error) {
	result := Page[Conversation]{Items: []Conversation{}}
	if len(search) > 100 || !validation.Text(search, 0, 100) || limit < 1 || limit > 100 {
		return result, problem.Invalid()
	}
	prefix, encoded := "false", ""
	if cursor != "" {
		var ok bool
		prefix, encoded, ok = strings.Cut(cursor, ":")
		if !ok || (prefix != "false" && prefix != "true") {
			return result, problem.Invalid()
		}
	}
	key := pagination.Fingerprint("image-conversations", owner.String(), search, prefix)
	point, err := pagination.Decode(encoded, key)
	if err != nil {
		return result, err
	}
	escaped := strings.NewReplacer(`\`, `\\`, "%", "\\%", "_", "\\_").Replace(search)
	rows, err := s.q.ListImageConversations(ctx, query.ListImageConversationsParams{UserID: owner, Search: "%" + escaped + "%", BeforeTime: point.Time, BeforePinned: prefix == "true", BeforeID: &point.ID, PageLimit: limit + 1})
	if err != nil {
		return result, fmt.Errorf("list image conversations: %w", err)
	}
	if len(rows) > int(limit) {
		rows = rows[:limit]
		last := rows[len(rows)-1]
		pin := strconv.FormatBool(last.Pinned)
		next, err := pagination.Encode(last.LastMessageAt, last.ID, pagination.Fingerprint("image-conversations", owner.String(), search, pin))
		if err != nil {
			return result, err
		}
		result.NextCursor = pin + ":" + next
	}
	for _, row := range rows {
		result.Items = append(result.Items, conversation(row))
	}
	return result, nil
}
func (s *Service) UpdateConversation(ctx context.Context, actor user.Actor, id uuid.UUID, title string, pin bool, version int64) (Conversation, error) {
	title = strings.TrimSpace(title)
	if !validation.Text(title, 1, 100) {
		return Conversation{}, problem.Invalid()
	}
	var row query.Conversation
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := checkOwner(ctx, q, actor); err != nil {
			return err
		}
		if _, err := q.GetImageConversation(ctx, query.GetImageConversationParams{ID: id, UserID: actor.ID}); errors.Is(err, pgx.ErrNoRows) {
			return problem.New("IMAGE_CONVERSATION_NOT_FOUND", 404)
		} else if err != nil {
			return fmt.Errorf("check image conversation: %w", err)
		}
		var err error
		row, err = q.UpdateImageConversation(ctx, query.UpdateImageConversationParams{ID: id, UserID: actor.ID, Title: title, Pinned: pin, Version: version})
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.New("CONFIGURATION_CONFLICT", 409)
		}
		if err != nil {
			return fmt.Errorf("update image conversation: %w", err)
		}
		return nil
	})
	return conversation(row), err
}
func (s *Service) RemoveConversation(ctx context.Context, actor user.Actor, id uuid.UUID) error {
	return db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := checkOwner(ctx, q, actor); err != nil {
			return err
		}
		count, err := q.RemoveImageConversation(ctx, query.RemoveImageConversationParams{ID: id, UserID: actor.ID})
		if err != nil {
			return fmt.Errorf("delete image conversation: %w", err)
		}
		if count == 0 {
			return problem.New("IMAGE_CONVERSATION_NOT_FOUND", 404)
		}
		return nil
	})
}
func (s *Service) Gallery(ctx context.Context, owner uuid.UUID, f Filter) (Page[GalleryImage], error) {
	result := Page[GalleryImage]{Items: []GalleryImage{}}
	if err := validateFilter(f); err != nil {
		return result, err
	}
	key := filterKey("gallery:"+owner.String(), f)
	point, err := pagination.Decode(f.Cursor, key)
	if err != nil {
		return result, err
	}
	rows, err := s.q.ListImageGallery(ctx, query.ListImageGalleryParams{UserID: owner, Quality: f.Quality, State: f.State, FromTime: f.From, UntilTime: f.Until, BeforeTime: point.Time, BeforeID: &point.ID, PageLimit: f.Limit + 1})
	if err != nil {
		return result, fmt.Errorf("list image gallery: %w", err)
	}
	if len(rows) > int(f.Limit) {
		rows = rows[:f.Limit]
		last := rows[len(rows)-1]
		result.NextCursor, err = pagination.Encode(last.CreatedAt, last.ID, key)
		if err != nil {
			return result, err
		}
	}
	for _, row := range rows {
		file := s.files.Decorate(media.File{ID: row.ID, Kind: row.Kind, MIME: row.Mime, Size: row.Size, Width: row.Width, Height: row.Height, ThumbnailWidth: row.ThumbnailWidth, ThumbnailHeight: row.ThumbnailHeight, CreatedAt: row.CreatedAt.UTC()}, owner)
		result.Items = append(result.Items, GalleryImage{File: file, TaskID: *row.TaskID, ConversationID: row.ConversationID, ModelID: row.ModelID, ModelName: row.ModelName, Prompt: row.Prompt, Quality: row.Quality, Size: row.RequestedSize, Ratio: row.Ratio, Status: row.TaskStatus, UnitPrice: row.UnitPrice})
	}
	return result, nil
}
func (s *Service) ReferenceLibrary(ctx context.Context, owner uuid.UUID, cursor string, limit int32) (Page[media.File], error) {
	result := Page[media.File]{Items: []media.File{}}
	if limit < 1 || limit > 100 {
		return result, problem.Invalid()
	}
	key := pagination.Fingerprint("image-library", owner.String())
	point, err := pagination.Decode(cursor, key)
	if err != nil {
		return result, err
	}
	rows, err := s.q.ListImageReferenceLibrary(ctx, query.ListImageReferenceLibraryParams{UserID: owner, BeforeTime: point.Time, BeforeID: &point.ID, PageLimit: limit + 1})
	if err != nil {
		return result, fmt.Errorf("list reference library: %w", err)
	}
	if len(rows) > int(limit) {
		rows = rows[:limit]
		last := rows[len(rows)-1]
		result.NextCursor, err = pagination.Encode(last.CreatedAt, last.ID, key)
		if err != nil {
			return result, err
		}
	}
	for _, row := range rows {
		result.Items = append(result.Items, s.files.View(row, owner))
	}
	return result, nil
}
func (s *Service) DeleteFile(ctx context.Context, actor user.Actor, id uuid.UUID, admin bool) error {
	return db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if admin {
			if err := user.LockAdmin(ctx, q, actor); err != nil {
				return err
			}
		} else if err := checkOwner(ctx, q, actor); err != nil {
			return err
		}
		row, err := q.GetImageFile(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && !admin && row.UserID != actor.ID) {
			return problem.New("FILE_NOT_FOUND", 404)
		}
		if err != nil {
			return fmt.Errorf("read deleted file: %w", err)
		}
		busy, err := q.ImageFileInUse(ctx, id)
		if err != nil {
			return fmt.Errorf("check reference use: %w", err)
		}
		if busy {
			return problem.New("FILE_IN_USE", 409)
		}
		if _, err := q.DeleteImageFile(ctx, query.DeleteImageFileParams{ID: id, UserID: row.UserID}); err != nil {
			return fmt.Errorf("delete image metadata: %w", err)
		}
		if admin {
			return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "image.delete", TargetType: "file", TargetID: &id, IP: actor.IP})
		}
		return nil
	})
}
