package canvas

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xinghenWink/Lumi/backend/internal/credits"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/upstream/video"
	"github.com/xinghenWink/Lumi/backend/internal/user"
	"github.com/xinghenWink/Lumi/backend/internal/videos"
)

type VideoQuoteInput struct {
	Version int64     `json:"version"`
	NodeID  uuid.UUID `json:"node_id"`
	videos.Input
}

type VideoRunInput struct {
	VideoQuoteInput
	ConfirmedQuote credits.VideoQuote `json:"confirmed_quote"`
}

type VideoRun struct {
	Canvas Canvas      `json:"canvas"`
	Task   videos.Task `json:"task"`
}

func (s *Service) VideoQuote(ctx context.Context, service *videos.Service, actor user.Actor, id uuid.UUID, input VideoQuoteInput) (credits.VideoQuote, error) {
	return service.QuoteResolved(ctx, actor, func(q *query.Queries) (videos.Input, error) {
		_, _, _, prepared, err := s.resolveVideo(ctx, q, actor, id, input)
		return prepared, err
	})
}

func (s *Service) RunVideo(ctx context.Context, service *videos.Service, actor user.Actor, id uuid.UUID, key string, input VideoRunInput) (VideoRun, error) {
	var board query.Canvas
	var document Document
	var nodeIndex int
	task, err := service.SubmitResolved(ctx, actor, key, &id, struct {
		Canvas uuid.UUID
		Input  VideoRunInput
	}{id, input},
		func(q *query.Queries) (videos.Submission, error) {
			var ready videos.Input
			var err error
			board, document, nodeIndex, ready, err = s.resolveVideo(ctx, q, actor, id, input.VideoQuoteInput)
			return videos.Submission{Input: ready, ConfirmedQuote: input.ConfirmedQuote}, err
		},
		func(q *query.Queries, task uuid.UUID, count int) error {
			if err := placeVideoResults(&document, nodeIndex, task, count); err != nil {
				return err
			}
			raw, err := Encode(document)
			if err != nil {
				return problem.Invalid()
			}
			_, err = q.SaveCanvas(ctx, query.SaveCanvasParams{ID: id, UserID: actor.ID, Title: board.Title, Document: raw, NodeCount: int32(len(document.Nodes)), CoverFileID: document.Cover()}) // #nosec G115 -- Encode validates the node count.
			if err != nil {
				return fmt.Errorf("save canvas video slots: %w", err)
			}
			return nil
		})
	if err != nil {
		return VideoRun{}, err
	}
	current, err := s.Get(ctx, actor.ID, id)
	return VideoRun{Canvas: current, Task: task}, err
}

func (s *Service) resolveVideo(ctx context.Context, q *query.Queries, actor user.Actor, id uuid.UUID, input VideoQuoteInput) (query.Canvas, Document, int, videos.Input, error) {
	var document Document
	prepared := input.Input
	row, err := q.LockCanvas(ctx, query.LockCanvasParams{ID: id, UserID: actor.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		return row, document, 0, prepared, notFound()
	}
	if err != nil {
		return row, document, 0, prepared, fmt.Errorf("lock canvas video source: %w", err)
	}
	if row.Version != input.Version {
		return row, document, 0, prepared, problem.New("CANVAS_CONFLICT", 409)
	}
	document, err = Decode(row.Document)
	if err != nil {
		return row, document, 0, prepared, err
	}
	if err := resolveVideoSlots(ctx, q, &document); err != nil {
		return row, document, 0, prepared, err
	}
	nodes := make(map[uuid.UUID]Node, len(document.Nodes))
	index := -1
	for i, node := range document.Nodes {
		nodes[node.ID] = node
		if node.ID == input.NodeID && node.Video != nil && node.Video.State != StatePending {
			index = i
		}
	}
	if index < 0 {
		return row, document, 0, prepared, problem.Invalid()
	}
	prompt := []string{prepared.Prompt}
	refs := make(map[uuid.UUID]bool)
	prepared.References = append([]videos.AssetReference{}, prepared.References...)
	for _, ref := range prepared.References {
		refs[ref.FileID] = true
	}
	insert := func(id *uuid.UUID, role video.Role) {
		if id != nil && !refs[*id] && prepared.Mode == video.Reference {
			refs[*id] = true
			prepared.References = append(prepared.References, videos.AssetReference{FileID: *id, Role: role})
		}
	}
	for _, edge := range document.Edges {
		if edge.To != input.NodeID || edge.Kind != EdgeInput {
			continue
		}
		source := nodes[edge.From]
		switch {
		case source.Text != nil && source.Text.State != StatePending && source.Text.State != StateFailed:
			if strings.TrimSpace(source.Text.Content) != "" {
				prompt = append(prompt, source.Text.Content)
			}
		case source.Image != nil && source.Image.State == StateReady:
			insert(source.Image.FileID, video.Image)
		case source.Video != nil && source.Video.State == StateReady:
			insert(source.Video.FileID, video.Video)
		}
	}
	prepared.Prompt = strings.TrimSpace(strings.Join(prompt, "\n\n"))
	return row, document, index, prepared, nil
}

func placeVideoResults(doc *Document, nodeIndex int, task uuid.UUID, count int) error {
	source := doc.Nodes[nodeIndex]
	width, height := 320.0, 180.0
	x, y := source.X+source.W+96, source.Y
	if x > MaxCoordinate {
		x = max(-MaxCoordinate, source.X-width-96)
	}
	for index := range count {
		position := int32(index) // #nosec G115 -- Video submission limits the count to four.
		item := &ImageContent{State: StatePending, TaskID: &task, Position: &position}
		if index == 0 && source.Video.State != StateReady {
			doc.Nodes[nodeIndex].Video = item
			continue
		}
		y = clearResultSpace(doc.Nodes, x, y, width, height)
		if y > MaxCoordinate {
			return problem.Invalid()
		}
		id, err := validation.NewID()
		if err != nil {
			return err
		}
		edge, err := validation.NewID()
		if err != nil {
			return err
		}
		doc.Nodes = append(doc.Nodes, Node{ID: id, Kind: KindVideo, GroupID: source.GroupID, X: x, Y: y, W: width, H: height, Video: item})
		doc.Edges = append(doc.Edges, Edge{ID: edge, From: source.ID, To: id, Kind: EdgeResult})
		y += height + 24
	}
	return nil
}

func resolveVideoSlots(ctx context.Context, q *query.Queries, doc *Document) error {
	cached := make(map[uuid.UUID][]query.VideoTaskItem)
	for i, node := range doc.Nodes {
		slot := node.Video
		if slot == nil || slot.State != StatePending || slot.TaskID == nil || slot.Position == nil {
			continue
		}
		items, ok := cached[*slot.TaskID]
		if !ok {
			var err error
			items, err = q.GetVideoTaskItems(ctx, *slot.TaskID)
			if err != nil {
				return fmt.Errorf("read canvas video slots: %w", err)
			}
			cached[*slot.TaskID] = items
		}
		for _, item := range items {
			if item.Position != *slot.Position {
				continue
			}
			value := *slot
			switch item.Status {
			case "succeeded":
				value.State = StateReady
				value.FileID = item.FileID
			case "failed":
				value.State = StateFailed
				value.ErrorCode = item.ErrorCode
			default:
				continue
			}
			doc.Nodes[i].Video = &value
		}
	}
	return nil
}

func videoReferences(doc Document) (files, tasks []uuid.UUID) {
	fileIDs, taskIDs := make(map[uuid.UUID]bool), make(map[uuid.UUID]bool)
	for _, node := range doc.Nodes {
		if node.Video == nil {
			continue
		}
		if id := node.Video.FileID; id != nil && !fileIDs[*id] {
			fileIDs[*id] = true
			files = append(files, *id)
		}
		if id := node.Video.TaskID; id != nil && !taskIDs[*id] {
			taskIDs[*id] = true
			tasks = append(tasks, *id)
		}
	}
	return files, tasks
}
