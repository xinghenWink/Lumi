package images

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/catalog"
	"github.com/xinghenWink/Lumi/backend/internal/credits"
	"github.com/xinghenWink/Lumi/backend/internal/media"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/pagination"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

func checkOwner(ctx context.Context, q *query.Queries, actor user.Actor) error {
	row, err := q.GetUserForUpdate(ctx, actor.ID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (row.Status != "active" || row.TokenVersion != actor.TokenVersion)) {
		return problem.Unauthorized()
	}
	if err != nil {
		return fmt.Errorf("lock image owner: %w", err)
	}
	return nil
}
func validateInput(input Input, c Configuration, model catalog.PublicModel) error {
	if input.ConversationID == uuid.Nil || input.ModelID == uuid.Nil || strings.TrimSpace(input.Prompt) == "" || len(input.Prompt) > 64000 || !utf8.ValidString(input.Prompt) || strings.ContainsRune(input.Prompt, 0) || input.Count < 1 || input.Count > c.MaxN || input.Count > model.Capabilities.MaxN || !slices.Contains(model.Capabilities.Qualities, input.Quality) || !slices.Contains(model.Capabilities.Sizes, input.Size) || !slices.Contains(c.Sizes, input.Size) {
		return problem.Invalid()
	}
	if input.Ratio != "" && (c.RatioSizes[input.Ratio] != input.Size || input.Size == "auto") {
		return problem.Invalid()
	}
	if len(input.ReferenceFileIDs) > int(c.MaxReferences) || len(input.ReferenceFileIDs) > int(model.Capabilities.MaxReferenceImages) || (len(input.ReferenceFileIDs) > 0 && !model.Capabilities.SupportsEdit) {
		return problem.New("IMAGE_REFERENCES_INVALID", 400)
	}
	seen := map[uuid.UUID]bool{}
	for _, id := range input.ReferenceFileIDs {
		if id == uuid.Nil || seen[id] {
			return problem.Invalid()
		}
		seen[id] = true
	}
	return nil
}
func shortTitle(text string) string {
	text = strings.TrimSpace(strings.Split(strings.Split(text, "\n")[0], "。")[0])
	runes := []rune(text)
	return string(runes[:min(20, len(runes))])
}
func (s *Service) Submit(ctx context.Context, actor user.Actor, key string, input Input) (Task, error) {
	settings, settingsErr := s.q.ListSettings(ctx)
	if settingsErr != nil {
		return Task{}, fmt.Errorf("read content settings: %w", settingsErr)
	}
	for _, record := range settings {
		if record.Key == "operations" {
			var cfg struct {
				Words []string `json:"sensitive_words"`
			}
			if err := json.Unmarshal(record.Value, &cfg); err != nil {
				return Task{}, fmt.Errorf("decode content settings: %w", err)
			}
			for _, word := range cfg.Words {
				if strings.Contains(strings.ToLower(input.Prompt), strings.ToLower(word)) {
					return Task{}, problem.New("CONTENT_BLOCKED", 400)
				}
			}
		}
	}
	if !credits.ValidKey(key) {
		return Task{}, problem.New("IDEMPOTENCY_KEY_INVALID", 400)
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return Task{}, fmt.Errorf("encode image request: %w", err)
	}
	digest := sha256.Sum256(encoded)
	hash := hex.EncodeToString(digest[:])
	var task query.ImageTask
	replay := false
	input.ReferenceFileIDs = append([]uuid.UUID{}, input.ReferenceFileIDs...)
	err = db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := checkOwner(ctx, q, actor); err != nil {
			return err
		}
		old, err := q.ImageTaskByKey(ctx, query.ImageTaskByKeyParams{UserID: actor.ID, IdempotencyKey: key})
		if err == nil {
			if old.RequestHash != hash {
				return problem.New("IDEMPOTENCY_CONFLICT", 409)
			}
			task = old
			replay = true
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("read original image request: %w", err)
		}
		cfgRow, err := q.GetImageSettings(ctx)
		if err != nil {
			return fmt.Errorf("read submission settings: %w", err)
		}
		cfg, err := configView(cfgRow)
		if err != nil {
			return err
		}
		model, client, _, err := s.catalog.ImageTarget(ctx, input.ModelID)
		if err != nil {
			return err
		}
		client.Close()
		if err := validateInput(input, cfg, model); err != nil {
			return err
		}
		if _, err := q.LockImageConversation(ctx, query.LockImageConversationParams{ID: input.ConversationID, UserID: actor.ID}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return problem.New("IMAGE_CONVERSATION_NOT_FOUND", 404)
			}
			return fmt.Errorf("lock image conversation: %w", err)
		}
		refs, err := q.GetImageReferenceFiles(ctx, query.GetImageReferenceFilesParams{UserID: actor.ID, Ids: input.ReferenceFileIDs})
		if err != nil {
			return fmt.Errorf("validate reference owners: %w", err)
		}
		if len(refs) != len(input.ReferenceFileIDs) {
			return problem.New("FILE_NOT_FOUND", 404)
		}
		for _, file := range refs {
			if file.Size > 10<<20 {
				return problem.New("FILE_TOO_LARGE", 413)
			}
		}
		if err := s.queue.Ping(ctx); err != nil {
			return problem.New("DEPENDENCY_UNAVAILABLE", 503)
		}
		id, err := validation.NewID()
		if err != nil {
			return err
		}
		userID, err := validation.NewID()
		if err != nil {
			return err
		}
		messageID, err := validation.NewID()
		if err != nil {
			return err
		}
		operation := "generate"
		if len(refs) > 0 {
			operation = "edit"
		}
		charge, err := s.billing.ChargeTx(ctx, q, actor.ID, "task-charge:"+id.String(), id, credits.QuoteInput{ModelID: &input.ModelID, Operation: operation, Quality: input.Quality, Size: input.Size, Count: int64(input.Count)})
		if err != nil {
			return err
		}
		params, err := json.Marshal(struct {
			Quality string `json:"quality"`
			Size    string `json:"size"`
			Ratio   string `json:"ratio"`
			N       int32  `json:"n"`
		}{input.Quality, input.Size, input.Ratio, input.Count})
		if err != nil {
			return fmt.Errorf("encode image parameters: %w", err)
		}
		for _, message := range []query.InsertChatMessageParams{{ID: userID, ConversationID: input.ConversationID, RequestID: id, Role: "user", Content: input.Prompt, Status: "completed", ModelID: &input.ModelID, RequestHash: hash}, {ID: messageID, ConversationID: input.ConversationID, RequestID: id, Role: "assistant", Content: "", Status: "streaming", ModelID: &input.ModelID, RequestHash: hash}} {
			if _, err := q.InsertChatMessage(ctx, message); err != nil {
				return fmt.Errorf("save image conversation turn: %w", err)
			}
		}
		task, err = q.CreateImageTask(ctx, query.CreateImageTaskParams{ID: id, UserID: actor.ID, ConversationID: input.ConversationID, MessageID: messageID, UserMessageID: userID, Operation: operation, ModelID: input.ModelID, ModelName: model.DisplayName, Prompt: input.Prompt, Params: params, Quality: input.Quality, Size: input.Size, Ratio: input.Ratio, ImageCount: input.Count, ReferenceFileIds: input.ReferenceFileIDs, ChargeID: charge.ID, UnitPrice: charge.Quote.UnitPrice, TotalCost: charge.Quote.TotalCost, IdempotencyKey: key, RequestHash: hash, SplitRequests: cfg.SplitRequests, TimeoutSeconds: cfg.TimeoutSeconds, QueueTimeout: cfg.QueueTimeoutSeconds})
		if err != nil {
			return fmt.Errorf("create charged image task: %w", err)
		}
		for position := int32(0); position < input.Count; position++ {
			if err := q.CreateImageTaskItem(ctx, query.CreateImageTaskItemParams{TaskID: id, Position: position}); err != nil {
				return fmt.Errorf("create image slots: %w", err)
			}
		}
		if err := q.TouchImageConversation(ctx, query.TouchImageConversationParams{ID: input.ConversationID, UserID: actor.ID, ModelID: &input.ModelID, Title: shortTitle(input.Prompt)}); err != nil {
			return fmt.Errorf("touch image conversation: %w", err)
		}
		return nil
	})
	if err != nil {
		return Task{}, err
	}
	if !replay {
		// A lost Redis enqueue cannot lose a charged task; reconciliation reads PostgreSQL.
		if err := s.queue.EnqueueImage(ctx, task.ID.String(), task.CreatedAt); err != nil {
			s.report(ctx, "image queue delivery delayed", err)
		}
	}
	views, err := s.views(ctx, []query.ImageTask{task}, actor.ID, true)
	if err != nil {
		return Task{}, err
	}
	return views[0], nil
}
func (s *Service) report(ctx context.Context, message string, err error) {
	if s.logger != nil {
		s.logger.ErrorContext(ctx, message, "error_type", fmt.Sprintf("%T", err))
	}
}
func (s *Service) views(ctx context.Context, rows []query.ImageTask, viewer uuid.UUID, content bool) ([]Task, error) {
	result := make([]Task, 0, len(rows))
	ids := make([]uuid.UUID, 0, len(rows))
	queued := []uuid.UUID{}
	for _, row := range rows {
		ids = append(ids, row.ID)
		if row.Status == "queued" {
			queued = append(queued, row.ID)
		}
	}
	items := []query.ListImageTaskItemsRow{}
	var err error
	if len(ids) > 0 {
		items, err = s.q.ListImageTaskItems(ctx, ids)
		if err != nil {
			return nil, fmt.Errorf("read image items: %w", err)
		}
	}
	ranks := map[uuid.UUID]int32{}
	if len(queued) > 0 {
		positions, err := s.q.ImageQueuePositions(ctx, queued)
		if err != nil {
			return nil, fmt.Errorf("read queue positions: %w", err)
		}
		for _, position := range positions {
			ranks[position.ID] = position.Position
		}
	}
	byTask := map[uuid.UUID][]Item{}
	for _, item := range items {
		view := Item{Position: item.Position, Status: item.Status, FileID: item.FileID, ErrorCode: item.ErrorCode}
		if item.FileDeletedAt != nil {
			view.FileID = nil
		}
		if content && item.FileID != nil && item.FileDeletedAt == nil && item.FileSize != nil && item.FileCreatedAt != nil {
			file := s.files.Decorate(media.File{ID: *item.FileID, Kind: item.FileKind.String, MIME: item.FileMime.String, Size: *item.FileSize, Width: item.FileWidth.Int32, Height: item.FileHeight.Int32, ThumbnailWidth: item.ThumbnailWidth.Int32, ThumbnailHeight: item.ThumbnailHeight.Int32, CreatedAt: item.FileCreatedAt.UTC()}, viewer)
			view.File = &file
		}
		byTask[item.TaskID] = append(byTask[item.TaskID], view)
	}
	for _, row := range rows {
		actual := int64(0)
		if Terminal(row.Status) {
			actual = row.TotalCost - row.RefundedCost
		}
		view := Task{ID: row.ID, UserID: row.UserID, ConversationID: row.ConversationID, ModelID: row.ModelID, ModelName: row.ModelName, Operation: row.Operation, Quality: row.Quality, Size: row.Size, Ratio: row.Ratio, Count: row.ImageCount, ReferenceFileIDs: []uuid.UUID{}, UnitPrice: row.UnitPrice, TotalCost: row.TotalCost, RefundedCost: row.RefundedCost, ActualCost: actual, Status: row.Status, SuccessfulImages: row.SuccessfulImages, QueuePosition: ranks[row.ID], CancelRequested: row.CancelRequested, ErrorCode: row.ErrorCode, StartedAt: row.StartedAt, FinishedAt: row.FinishedAt, CreatedAt: row.CreatedAt.UTC(), Version: row.Version, Items: byTask[row.ID], ContentVisible: content}
		if content {
			view.Prompt = row.Prompt
			view.ReferenceFileIDs = append(view.ReferenceFileIDs, row.ReferenceFileIds...)
		}
		if view.Items == nil {
			view.Items = []Item{}
		}
		result = append(result, view)
	}
	return result, nil
}
func (s *Service) adminAccess(ctx context.Context, actor user.Actor, action string, id *uuid.UUID) (bool, error) {
	visible := false
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		cfg, err := q.GetImageSettings(ctx)
		if err != nil {
			return fmt.Errorf("read content visibility: %w", err)
		}
		visible = cfg.AdminCanViewContent
		if visible {
			return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: action, TargetType: "image", TargetID: id, IP: actor.IP})
		}
		return nil
	})
	return visible, err
}
func (s *Service) AllowFileView(ctx context.Context, actor user.Actor, id uuid.UUID) error {
	visible, err := s.adminAccess(ctx, actor, "image.view", &id)
	if err != nil {
		return err
	}
	if !visible {
		return problem.New("FILE_NOT_FOUND", 404)
	}
	return nil
}
func (s *Service) Get(ctx context.Context, actor user.Actor, id uuid.UUID, admin bool) (Task, error) {
	row, err := s.q.GetImageTask(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !admin && row.UserID != actor.ID) {
		return Task{}, problem.New("IMAGE_TASK_NOT_FOUND", 404)
	}
	if err != nil {
		return Task{}, fmt.Errorf("read image task: %w", err)
	}
	visible := true
	if admin {
		visible, err = s.adminAccess(ctx, actor, "image.view", &id)
		if err != nil {
			return Task{}, err
		}
	}
	items, err := s.views(ctx, []query.ImageTask{row}, actor.ID, visible)
	if err != nil {
		return Task{}, err
	}
	return items[0], nil
}
func validateFilter(f Filter) error {
	if f.Limit < 1 || f.Limit > 100 || (!slices.Contains([]string{"", "queued", "running", "succeeded", "partial", "failed", "canceled"}, f.State)) || !slices.Contains([]string{"", "low", "medium", "high"}, f.Quality) || (f.From != nil && f.Until != nil && !f.From.Before(*f.Until)) {
		return problem.Invalid()
	}
	return nil
}
func filterKey(owner string, f Filter) string {
	text := func(t *time.Time) string {
		if t == nil {
			return ""
		}
		return t.UTC().Format(time.RFC3339Nano)
	}
	id := func(id *uuid.UUID) string {
		if id == nil {
			return ""
		}
		return id.String()
	}
	return pagination.Fingerprint(owner, id(f.Owner), id(f.Conversation), f.State, f.Quality, text(f.From), text(f.Until))
}
func (s *Service) List(ctx context.Context, actor user.Actor, f Filter, admin bool) (Page[Task], error) {
	result := Page[Task]{Items: []Task{}}
	if err := validateFilter(f); err != nil {
		return result, err
	}
	visible := true
	if !admin {
		f.Owner = &actor.ID
	} else {
		var err error
		visible, err = s.adminAccess(ctx, actor, "image.list", nil)
		if err != nil {
			return result, err
		}
	}
	if f.Conversation != nil && !admin {
		if _, err := s.q.GetImageConversation(ctx, query.GetImageConversationParams{ID: *f.Conversation, UserID: actor.ID}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return result, problem.New("IMAGE_CONVERSATION_NOT_FOUND", 404)
			}
			return result, fmt.Errorf("check image history owner: %w", err)
		}
	}
	key := filterKey(actor.ID.String(), f)
	cursor, err := pagination.Decode(f.Cursor, key)
	if err != nil {
		return result, err
	}
	rows, err := s.q.ListImageTasks(ctx, query.ListImageTasksParams{Owner: f.Owner, Conversation: f.Conversation, State: f.State, Quality: f.Quality, FromTime: f.From, UntilTime: f.Until, BeforeTime: cursor.Time, BeforeID: &cursor.ID, PageLimit: f.Limit + 1})
	if err != nil {
		return result, fmt.Errorf("list image tasks: %w", err)
	}
	if len(rows) > int(f.Limit) {
		rows = rows[:f.Limit]
		last := rows[len(rows)-1]
		result.NextCursor, err = pagination.Encode(last.CreatedAt, last.ID, key)
		if err != nil {
			return result, err
		}
	}
	result.Items, err = s.views(ctx, rows, actor.ID, visible)
	return result, err
}
