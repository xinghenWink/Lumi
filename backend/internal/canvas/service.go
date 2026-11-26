package canvas

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xinghenWink/Lumi/backend/internal/media"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/pagination"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

type Canvas struct {
	ID             uuid.UUID    `json:"id"`
	Title          string       `json:"title"`
	ConversationID uuid.UUID    `json:"conversation_id"`
	Document       Document     `json:"document"`
	Files          []media.File `json:"files"`
	NodeCount      int32        `json:"node_count"`
	Version        int64        `json:"version"`
	CreatedAt      time.Time    `json:"created_at"`
	UpdatedAt      time.Time    `json:"updated_at"`
}

type Summary struct {
	ID        uuid.UUID   `json:"id"`
	Title     string      `json:"title"`
	NodeCount int32       `json:"node_count"`
	Cover     *media.File `json:"cover"`
	Version   int64       `json:"version"`
	CreatedAt time.Time   `json:"created_at"`
	UpdatedAt time.Time   `json:"updated_at"`
}

type Page struct {
	Items      []Summary `json:"items"`
	NextCursor string    `json:"next_cursor"`
}

type CreateInput struct {
	ID    uuid.UUID `json:"id"`
	Title string    `json:"title"`
}

type SaveInput struct {
	Title    string   `json:"title"`
	Document Document `json:"document"`
	Version  int64    `json:"version"`
}

type Service struct {
	pool  *pgxpool.Pool
	q     *query.Queries
	files *media.Store
}

// errCreateRace marks a concurrent create of the same ID; the transaction rolls back
// (dropping its conversation) and the winner's row is returned instead.
var errCreateRace = errors.New("canvas created concurrently")

func New(pool *pgxpool.Pool, files *media.Store) *Service {
	return &Service{pool: pool, q: query.New(pool), files: files}
}

func notFound() error { return problem.New("CANVAS_NOT_FOUND", 404) }

func checkOwner(ctx context.Context, q *query.Queries, actor user.Actor) error {
	row, err := q.GetUserForUpdate(ctx, actor.ID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (row.Status != "active" || row.TokenVersion != actor.TokenVersion)) {
		return problem.Unauthorized()
	}
	if err != nil {
		return fmt.Errorf("lock canvas owner: %w", err)
	}
	return nil
}

func (s *Service) List(ctx context.Context, owner uuid.UUID, search, cursor string, limit int32) (Page, error) {
	result := Page{Items: []Summary{}}
	if !validation.Text(search, 0, 100) || limit < 1 || limit > 100 {
		return result, problem.Invalid()
	}
	key := pagination.Fingerprint("canvases", owner.String(), search)
	point, err := pagination.Decode(cursor, key)
	if err != nil {
		return result, err
	}
	escaped := strings.NewReplacer(`\`, `\\`, "%", "\\%", "_", "\\_").Replace(search)
	rows, err := s.q.ListCanvases(ctx, query.ListCanvasesParams{UserID: owner, Search: "%" + escaped + "%", BeforeTime: point.Time, BeforeID: &point.ID, PageLimit: limit + 1})
	if err != nil {
		return result, fmt.Errorf("list canvases: %w", err)
	}
	if len(rows) > int(limit) {
		rows = rows[:limit]
		last := rows[len(rows)-1]
		if result.NextCursor, err = pagination.Encode(last.UpdatedAt, last.ID, key); err != nil {
			return result, err
		}
	}
	covers := []uuid.UUID{}
	for _, row := range rows {
		if row.CoverFileID != nil {
			covers = append(covers, *row.CoverFileID)
		}
	}
	files, err := s.visibleFiles(ctx, s.q, owner, covers)
	if err != nil {
		return result, err
	}
	for _, row := range rows {
		item := Summary{ID: row.ID, Title: row.Title, NodeCount: row.NodeCount, Version: row.Version, CreatedAt: row.CreatedAt.UTC(), UpdatedAt: row.UpdatedAt.UTC()}
		if row.CoverFileID != nil {
			if file, ok := files[*row.CoverFileID]; ok {
				item.Cover = &file
			}
		}
		result.Items = append(result.Items, item)
	}
	return result, nil
}

// Create is idempotent per ID: replaying the request returns the existing canvas.
func (s *Service) Create(ctx context.Context, actor user.Actor, input CreateInput) (Canvas, error) {
	title := strings.TrimSpace(input.Title)
	if input.ID == uuid.Nil || !validation.Text(title, 0, MaxTitle) {
		return Canvas{}, problem.Invalid()
	}
	raw, err := Encode(Empty())
	if err != nil {
		return Canvas{}, err
	}
	var row query.Canvas
	err = db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := checkOwner(ctx, q, actor); err != nil {
			return err
		}
		existing, err := q.GetCanvas(ctx, query.GetCanvasParams{ID: input.ID, UserID: actor.ID})
		if err == nil {
			row = existing
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("check canvas: %w", err)
		}
		count, err := q.CountCanvases(ctx, actor.ID)
		if err != nil {
			return fmt.Errorf("count canvases: %w", err)
		}
		if count >= MaxCanvases {
			return problem.New("CANVAS_LIMIT", 409)
		}
		conversation, err := validation.NewID()
		if err != nil {
			return err
		}
		if err := q.CreateCanvasConversation(ctx, query.CreateCanvasConversationParams{ID: conversation, UserID: actor.ID}); err != nil {
			return fmt.Errorf("create canvas conversation: %w", err)
		}
		row, err = q.CreateCanvas(ctx, query.CreateCanvasParams{ID: input.ID, UserID: actor.ID, ConversationID: conversation, Title: title, Document: raw})
		if errors.Is(err, pgx.ErrNoRows) {
			return errCreateRace
		}
		if err != nil {
			return fmt.Errorf("create canvas: %w", err)
		}
		return nil
	})
	if errors.Is(err, errCreateRace) {
		// Another request owns the ID: either the same user won the race or the ID is taken.
		if row, err = s.q.GetCanvas(ctx, query.GetCanvasParams{ID: input.ID, UserID: actor.ID}); errors.Is(err, pgx.ErrNoRows) {
			return Canvas{}, notFound()
		}
	}
	if err != nil {
		return Canvas{}, err
	}
	return s.view(ctx, s.q, row, actor.ID)
}

func (s *Service) Get(ctx context.Context, owner, id uuid.UUID) (Canvas, error) {
	row, err := s.q.GetCanvas(ctx, query.GetCanvasParams{ID: id, UserID: owner})
	if errors.Is(err, pgx.ErrNoRows) {
		return Canvas{}, notFound()
	}
	if err != nil {
		return Canvas{}, fmt.Errorf("read canvas: %w", err)
	}
	return s.view(ctx, s.q, row, owner)
}

// Save replaces the whole document when the caller still holds the latest version.
func (s *Service) Save(ctx context.Context, actor user.Actor, id uuid.UUID, input SaveInput) (Canvas, error) {
	title := strings.TrimSpace(input.Title)
	if !validation.Text(title, 0, MaxTitle) || input.Version < 1 || Validate(input.Document) != nil {
		return Canvas{}, problem.Invalid()
	}
	raw, err := Encode(input.Document)
	if err != nil {
		return Canvas{}, problem.Invalid()
	}
	var result Canvas
	err = db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := checkOwner(ctx, q, actor); err != nil {
			return err
		}
		row, err := q.LockCanvas(ctx, query.LockCanvasParams{ID: id, UserID: actor.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound()
		}
		if err != nil {
			return fmt.Errorf("lock canvas: %w", err)
		}
		if row.Version != input.Version {
			return problem.New("CANVAS_CONFLICT", 409)
		}
		files := input.Document.FileIDs()
		videoFiles, videoTasks := videoReferences(input.Document)
		if len(videoFiles) > 0 {
			owned, err := q.CanvasOwnedVideoFileIDs(ctx, query.CanvasOwnedVideoFileIDsParams{UserID: actor.ID, Ids: videoFiles})
			if err != nil {
				return fmt.Errorf("check canvas video files: %w", err)
			}
			if len(owned) != len(videoFiles) {
				return problem.Invalid()
			}
		}
		if len(videoTasks) > 0 {
			owned, err := q.CanvasOwnedVideoTaskIDs(ctx, query.CanvasOwnedVideoTaskIDsParams{UserID: actor.ID, CanvasID: &id, Ids: videoTasks})
			if err != nil {
				return fmt.Errorf("check canvas video tasks: %w", err)
			}
			if len(owned) != len(videoTasks) {
				return problem.Invalid()
			}
		}
		owned, err := q.CanvasOwnedFileIDs(ctx, query.CanvasOwnedFileIDsParams{UserID: actor.ID, Ids: files})
		if err != nil {
			return fmt.Errorf("check canvas files: %w", err)
		}
		tasks := input.Document.TaskIDs()
		ownedTasks, err := q.CanvasOwnedTaskIDs(ctx, query.CanvasOwnedTaskIDsParams{UserID: actor.ID, ConversationID: row.ConversationID, Ids: tasks})
		if err != nil {
			return fmt.Errorf("check canvas tasks: %w", err)
		}
		if len(owned) != len(files) || len(ownedTasks) != len(tasks) {
			return problem.Invalid()
		}
		textRuns := make(map[uuid.UUID]bool)
		for _, node := range input.Document.Nodes {
			if node.Text != nil && node.Text.RunID != nil {
				textRuns[*node.Text.RunID] = true
			}
		}
		if len(textRuns) > 0 {
			ids := make([]uuid.UUID, 0, len(textRuns))
			for id := range textRuns {
				ids = append(ids, id)
			}
			ownedRuns, err := q.CanvasOwnedTextRuns(ctx, query.CanvasOwnedTextRunsParams{CanvasID: id, UserID: actor.ID, Ids: ids})
			if err != nil {
				return fmt.Errorf("check canvas text runs: %w", err)
			}
			if len(ownedRuns) != len(ids) {
				return problem.Invalid()
			}
		}
		row, err = q.SaveCanvas(ctx, query.SaveCanvasParams{ID: id, UserID: actor.ID, Title: title, Document: raw, NodeCount: int32(len(input.Document.Nodes)), CoverFileID: input.Document.Cover()}) // #nosec G115 -- Validate caps nodes at MaxNodes.
		if err != nil {
			return fmt.Errorf("save canvas: %w", err)
		}
		files = append(files, videoFiles...)
		if err := q.DeleteStaleCanvasFiles(ctx, query.DeleteStaleCanvasFilesParams{CanvasID: id, FileIds: files}); err != nil {
			return fmt.Errorf("drop canvas file references: %w", err)
		}
		if err := q.InsertCanvasFiles(ctx, query.InsertCanvasFilesParams{CanvasID: id, FileIds: files}); err != nil {
			return fmt.Errorf("record canvas file references: %w", err)
		}
		result, err = s.view(ctx, q, row, actor.ID)
		return err
	})
	return result, err
}

// Delete hides the canvas and its conversation; the image worker then cancels and refunds
// any task still queued or running in that conversation.
func (s *Service) Delete(ctx context.Context, actor user.Actor, id uuid.UUID) error {
	return db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := checkOwner(ctx, q, actor); err != nil {
			return err
		}
		conversation, err := q.RemoveCanvas(ctx, query.RemoveCanvasParams{ID: id, UserID: actor.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound()
		}
		if err != nil {
			return fmt.Errorf("delete canvas: %w", err)
		}
		if err := q.RemoveCanvasConversation(ctx, query.RemoveCanvasConversationParams{ID: conversation, UserID: actor.ID}); err != nil {
			return fmt.Errorf("delete canvas conversation: %w", err)
		}
		if err := q.RequestCanvasTaskCancellation(ctx, query.RequestCanvasTaskCancellationParams{
			ConversationID: conversation, UserID: actor.ID,
		}); err != nil {
			return fmt.Errorf("cancel canvas tasks: %w", err)
		}
		if err := q.CancelCanvasTextRuns(ctx, id); err != nil {
			return fmt.Errorf("cancel canvas text work: %w", err)
		}
		return nil
	})
}

func (s *Service) view(ctx context.Context, q *query.Queries, row query.Canvas, viewer uuid.UUID) (Canvas, error) {
	doc, err := Decode(row.Document)
	if err != nil {
		return Canvas{}, err
	}
	if err := resolveVideoSlots(ctx, q, &doc); err != nil {
		return Canvas{}, err
	}
	ids := doc.FileIDs()
	visible, err := s.visibleFiles(ctx, q, viewer, ids)
	if err != nil {
		return Canvas{}, err
	}
	files := make([]media.File, 0, len(visible))
	for _, id := range ids {
		if file, ok := visible[id]; ok {
			files = append(files, file)
		}
	}
	return Canvas{ID: row.ID, Title: row.Title, ConversationID: row.ConversationID, Document: doc, Files: files, NodeCount: row.NodeCount, Version: row.Version, CreatedAt: row.CreatedAt.UTC(), UpdatedAt: row.UpdatedAt.UTC()}, nil
}

// visibleFiles signs every file the viewer may still load; deleted files are omitted so the
// client shows an "unavailable" placeholder for them.
func (s *Service) visibleFiles(ctx context.Context, q *query.Queries, viewer uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]media.File, error) {
	result := make(map[uuid.UUID]media.File, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	rows, err := q.CanvasVisibleFiles(ctx, query.CanvasVisibleFilesParams{UserID: viewer, Ids: ids})
	if err != nil {
		return nil, fmt.Errorf("read canvas files: %w", err)
	}
	for _, row := range rows {
		result[row.ID] = s.files.View(row, viewer)
	}
	return result, nil
}
