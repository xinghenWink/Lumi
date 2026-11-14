package canvas

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xinghenWink/Lumi/backend/internal/chat"
	"github.com/xinghenWink/Lumi/backend/internal/credits"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

type TextRunInput struct {
	Version   int64     `json:"version"`
	NodeID    uuid.UUID `json:"node_id"`
	ModelID   uuid.UUID `json:"model_id"`
	Reasoning string    `json:"reasoning"`
	Count     int32     `json:"n"`
}

type TextItem struct {
	Position  int32  `json:"position"`
	Status    string `json:"status"`
	Content   string `json:"content"`
	ErrorCode string `json:"error_code"`
}

type TextRun struct {
	ID    uuid.UUID  `json:"id"`
	Items []TextItem `json:"items"`
}

type TextSubmission struct {
	Canvas Canvas  `json:"canvas"`
	Task   TextRun `json:"task"`
}

func (s *Service) SubmitText(ctx context.Context, chats *chat.Service, actor user.Actor, id uuid.UUID, key string, input TextRunInput) (TextSubmission, error) {
	if input.Version < 1 || input.NodeID == uuid.Nil || input.ModelID == uuid.Nil || input.Count < 1 || input.Count > 3 {
		return TextSubmission{}, problem.Invalid()
	}
	if !credits.ValidKey(key) {
		return TextSubmission{}, problem.New("IDEMPOTENCY_KEY_INVALID", 400)
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return TextSubmission{}, fmt.Errorf("encode canvas text request: %w", err)
	}
	digest := sha256.Sum256(encoded)
	hash := hex.EncodeToString(digest[:])
	var row query.Canvas
	var runID uuid.UUID
	err = db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := checkOwner(ctx, q, actor); err != nil {
			return err
		}
		row, err = q.LockCanvas(ctx, query.LockCanvasParams{ID: id, UserID: actor.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound()
		}
		if err != nil {
			return fmt.Errorf("lock canvas for text generation: %w", err)
		}
		old, err := q.CanvasTextRunByKey(ctx, query.CanvasTextRunByKeyParams{CanvasID: id, UserID: actor.ID, IdempotencyKey: key})
		if err == nil {
			if old.RequestHash != hash {
				return problem.New("IDEMPOTENCY_CONFLICT", 409)
			}
			runID = old.ID
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("read canvas text replay: %w", err)
		}
		if row.Version != input.Version {
			return problem.New("CANVAS_CONFLICT", 409)
		}
		doc, err := Decode(row.Document)
		if err != nil {
			return err
		}
		index := slices.IndexFunc(doc.Nodes, func(node Node) bool { return node.ID == input.NodeID })
		if index < 0 || doc.Nodes[index].Text == nil || doc.Nodes[index].Text.State == StatePending || doc.Nodes[index].TextSettings == nil {
			return problem.Invalid()
		}
		node := doc.Nodes[index]
		settings := node.TextSettings
		prompt, files, err := resolveInputs(doc, node, settings.Prompt, settings.Mentions, false)
		if err != nil {
			return err
		}
		if strings.TrimSpace(prompt) == "" {
			return problem.Invalid()
		}
		if original := strings.TrimSpace(node.Text.Content); original != "" {
			prompt += "\n\n<source_text>\n" + original + "\n</source_text>"
		}
		runID, err = validation.NewID()
		if err != nil {
			return err
		}
		if err := placeTextResults(&doc, index, runID, input.Count); err != nil {
			return err
		}
		raw, err := Encode(doc)
		if err != nil {
			return problem.Invalid()
		}
		if err := chats.AdmitCanvas(ctx, q, chat.CanvasPrompt{Owner: actor.ID, ModelID: input.ModelID, Content: prompt, Reasoning: input.Reasoning, Files: files}, input.Count); err != nil {
			return err
		}
		if err := q.CreateCanvasTextRun(ctx, query.CreateCanvasTextRunParams{ID: runID, CanvasID: id, UserID: actor.ID, IdempotencyKey: key, RequestHash: hash, ModelID: input.ModelID, Prompt: prompt, ReferenceFileIds: files, Reasoning: input.Reasoning}); err != nil {
			return fmt.Errorf("create canvas text run: %w", err)
		}
		for position := range input.Count {
			if err := q.CreateCanvasTextItem(ctx, query.CreateCanvasTextItemParams{RunID: runID, Position: position}); err != nil {
				return fmt.Errorf("create canvas text item: %w", err)
			}
		}
		row, err = q.SaveCanvas(ctx, query.SaveCanvasParams{ID: id, UserID: actor.ID, Title: row.Title, Document: raw,
			NodeCount: int32(len(doc.Nodes)), CoverFileID: row.CoverFileID}) // #nosec G115 -- placeTextResults enforces MaxNodes.
		if err != nil {
			return fmt.Errorf("save canvas text slots: %w", err)
		}
		return nil
	})
	if err != nil {
		return TextSubmission{}, err
	}
	board, err := s.view(ctx, s.q, row, actor.ID)
	if err != nil {
		return TextSubmission{}, err
	}
	run, err := s.textItems(ctx, runID)
	return TextSubmission{Canvas: board, Task: run}, err
}

func placeTextResults(doc *Document, index int, id uuid.UUID, count int32) error {
	source := doc.Nodes[index]
	inPlace := strings.TrimSpace(source.Text.Content) == ""
	add := int(count)
	if inPlace {
		add--
	}
	if len(doc.Nodes)+add > MaxNodes || len(doc.Edges)+add > MaxEdges {
		return problem.New("CANVAS_DOCUMENT_LIMIT", 409)
	}
	x, y := source.X+source.W+96, source.Y
	if x > MaxCoordinate {
		x = source.X - 356
	}
	for position := range count {
		slot := &TextContent{RunID: &id, Position: &position, State: StatePending}
		if position == 0 && inPlace {
			doc.Nodes[index].Text = slot
			continue
		}
		y = clearResultSpace(doc.Nodes, x, y, 260, 140)
		if y > MaxCoordinate {
			return problem.New("CANVAS_DOCUMENT_LIMIT", 409)
		}
		nodeID, err := validation.NewID()
		if err != nil {
			return err
		}
		edgeID, err := validation.NewID()
		if err != nil {
			return err
		}
		doc.Nodes = append(doc.Nodes, Node{ID: nodeID, Kind: KindText, X: x, Y: y, W: 260, H: 140, Text: slot})
		doc.Edges = append(doc.Edges, Edge{ID: edgeID, From: source.ID, To: nodeID, Kind: EdgeResult})
		y += 164
	}
	return nil
}

func (s *Service) textItems(ctx context.Context, id uuid.UUID) (TextRun, error) {
	rows, err := s.q.ListCanvasTextItems(ctx, id)
	if err != nil {
		return TextRun{}, fmt.Errorf("read canvas text results: %w", err)
	}
	result := TextRun{ID: id, Items: make([]TextItem, 0, len(rows))}
	for _, row := range rows {
		result.Items = append(result.Items, TextItem{Position: row.Position, Status: row.Status, Content: row.Content, ErrorCode: row.ErrorCode})
	}
	return result, nil
}

func (s *Service) TextRun(ctx context.Context, owner, board, run uuid.UUID, cancel bool) (TextRun, error) {
	_, err := s.q.GetCanvasTextRun(ctx, query.GetCanvasTextRunParams{CanvasID: board, UserID: owner, ID: run})
	if errors.Is(err, pgx.ErrNoRows) {
		return TextRun{}, notFound()
	}
	if err != nil {
		return TextRun{}, fmt.Errorf("read canvas text run: %w", err)
	}
	if cancel {
		if err := s.q.CancelCanvasTextRun(ctx, run); err != nil {
			return TextRun{}, fmt.Errorf("cancel canvas text run: %w", err)
		}
	}
	return s.textItems(ctx, run)
}

// WorkText runs a bounded database queue. An expired lease fails the candidate
// instead of making a second provider call for an ambiguous result.
func (s *Service) WorkText(ctx context.Context, chats *chat.Service, logger *slog.Logger) {
	var workers sync.WaitGroup
	for range 2 {
		workers.Go(func() {
			ticker := time.NewTicker(500 * time.Millisecond)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					if err := s.q.RecoverCanvasTextItems(ctx); err != nil {
						logger.ErrorContext(ctx, "recover canvas text queue", "error", err)
						continue
					}
					item, err := s.q.ClaimCanvasTextItem(ctx)
					if errors.Is(err, pgx.ErrNoRows) {
						continue
					}
					if err != nil {
						logger.ErrorContext(ctx, "claim canvas text candidate", "error", err)
						continue
					}
					if err := s.executeText(ctx, chats, item); err != nil {
						logger.ErrorContext(ctx, "settle canvas text candidate", "error", err)
					}
				}
			}
		})
	}
	workers.Wait()
}

func (s *Service) executeText(ctx context.Context, chats *chat.Service, item query.ClaimCanvasTextItemRow) error {
	work, cancel := context.WithCancel(ctx)
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-work.Done():
				return
			case <-ticker.C:
				changed, err := s.q.RenewCanvasTextItem(work, query.RenewCanvasTextItemParams{RunID: item.ID, Position: item.Position})
				if err != nil || changed == 0 {
					cancel()
					return
				}
			}
		}
	}()
	result, err := chats.GenerateCanvasText(work, chat.CanvasPrompt{Owner: item.UserID, ModelID: item.ModelID, Content: item.Prompt, Reasoning: item.Reasoning, Files: item.ReferenceFileIds}, MaxText)
	cancel()
	<-done
	status, code := "succeeded", ""
	if err != nil {
		status, code = "failed", "CHAT_INTERRUPTED"
		var failure *problem.Error
		if errors.As(err, &failure) {
			code = failure.Code
		}
	}
	save, stop := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer stop()
	if err := s.q.SettleCanvasTextItem(save, query.SettleCanvasTextItemParams{RunID: item.ID, Position: item.Position, Status: status, Content: result, ErrorCode: code}); err != nil {
		return fmt.Errorf("settle canvas text run: %w", err)
	}
	return nil
}
