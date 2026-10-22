package images

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/upstream"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

// Claim serializes global capacity across instances and counts tasks rather than image slots.
func (s *Service) Claim(ctx context.Context, id uuid.UUID) (query.ImageTask, bool, error) {
	var result query.ImageTask
	claimed := false
	row, err := s.q.GetImageTask(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, false, nil
	}
	if err != nil {
		return result, false, fmt.Errorf("read queued image: %w", err)
	}
	result = row
	err = db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := q.LockImageScheduler(ctx); err != nil {
			return fmt.Errorf("lock image scheduler: %w", err)
		}
		owner, err := q.GetUserForUpdate(ctx, row.UserID)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && owner.Status != "active") {
			return nil
		}
		if err != nil {
			return fmt.Errorf("lock queued image owner: %w", err)
		}
		current, err := q.LockImageTask(ctx, id)
		if err != nil {
			return fmt.Errorf("lock queued image: %w", err)
		}
		if current.Status != "queued" || current.CancelRequested || current.QueueDeadline.Before(time.Now()) {
			result = current
			return nil
		}
		if _, err := q.GetImageConversation(ctx, query.GetImageConversationParams{ID: current.ConversationID, UserID: current.UserID}); errors.Is(err, pgx.ErrNoRows) {
			return nil
		} else if err != nil {
			return fmt.Errorf("check queued conversation: %w", err)
		}
		cfg, err := q.GetImageSettings(ctx)
		if err != nil {
			return fmt.Errorf("read scheduler limits: %w", err)
		}
		count, err := q.ImageRunningCounts(ctx, current.UserID)
		if err != nil {
			return fmt.Errorf("count running images: %w", err)
		}
		if count.GlobalRunning >= cfg.GlobalConcurrency || count.UserRunning >= cfg.PerUserConcurrency {
			return nil
		}
		token, err := validation.NewID()
		if err != nil {
			return err
		}
		result, err = q.StartImageTask(ctx, query.StartImageTaskParams{ID: id, RunToken: &token})
		if err != nil {
			return fmt.Errorf("claim queued image: %w", err)
		}
		claimed = true
		return nil
	})
	return result, claimed, err
}
func (s *Service) saveItem(ctx context.Context, task query.ImageTask, position int32, result upstream.ImageResult, client *upstream.Client, code string) error {
	var prepared query.InsertImageFileParams
	ready := false
	if code == "" {
		raw := result.Data
		var err error
		if len(raw) == 0 {
			raw, err = client.FetchImage(ctx, result.URL)
		}
		if err == nil {
			prepared, err = s.files.Prepare(ctx, task.UserID, &task.ID, "generated", raw, 20<<20)
		}
		if err != nil {
			code = "IMAGE_RESULT_INVALID"
		} else {
			ready = true
		}
	}
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		row, err := q.LockImageTask(ctx, task.ID)
		if err != nil {
			return fmt.Errorf("lock image result: %w", err)
		}
		if row.Status != "running" || row.RunToken == nil || task.RunToken == nil || *row.RunToken != *task.RunToken || row.CancelRequested {
			return problem.New("IMAGE_TASK_CANCELED", 409)
		}
		var fileID *uuid.UUID
		status := "failed"
		if ready {
			file, err := q.InsertImageFile(ctx, prepared)
			if err != nil {
				return fmt.Errorf("save result file: %w", err)
			}
			fileID = &file.ID
			status = "succeeded"
		}
		if err := q.SaveImageTaskItem(ctx, query.SaveImageTaskItemParams{TaskID: task.ID, Position: position, Status: status, FileID: fileID, ErrorCode: code}); err != nil {
			return fmt.Errorf("save image slot: %w", err)
		}
		if err := q.TouchImageTask(ctx, task.ID); err != nil {
			return fmt.Errorf("advance image progress: %w", err)
		}
		return nil
	})
	if err != nil && ready {
		return errors.Join(err, s.files.Discard(prepared))
	}
	return err
}
func (s *Service) finishTx(ctx context.Context, q *query.Queries, row query.ImageTask, status, code string, success int32) (query.ImageTask, error) {
	if Terminal(row.Status) {
		return row, nil
	}
	if status == "failed" || status == "canceled" {
		success = 0
		if err := q.DeleteCanceledImageFiles(ctx, &row.ID); err != nil {
			return row, fmt.Errorf("discard incomplete task images: %w", err)
		}
		if err := q.DiscardImageTaskItems(ctx, query.DiscardImageTaskItemsParams{TaskID: row.ID, ErrorCode: code}); err != nil {
			return row, fmt.Errorf("discard canceled image slots: %w", err)
		}
	}
	settlement, err := s.billing.SettleTx(ctx, q, row.UserID, "task-settle:"+row.ID.String(), row.ChargeID, int64(row.ImageCount-success))
	if err != nil {
		return row, err
	}
	if err := q.FailPendingImageItems(ctx, query.FailPendingImageItemsParams{TaskID: row.ID, ErrorCode: code}); err != nil {
		return row, fmt.Errorf("close pending image slots: %w", err)
	}
	final, err := q.FinishImageTask(ctx, query.FinishImageTaskParams{ID: row.ID, Status: status, SuccessfulImages: success, RefundedCost: settlement.Refunded, ErrorCode: code})
	if err != nil {
		return row, fmt.Errorf("finish settled image task: %w", err)
	}
	messageStatus := "completed"
	if status == "failed" {
		messageStatus = "error"
	}
	if status == "canceled" {
		messageStatus = "interrupted"
	}
	if err := q.FinishImageMessage(ctx, query.FinishImageMessageParams{ID: row.MessageID, Status: messageStatus, Meta: []byte(`{"task_id":"` + row.ID.String() + `"}`)}); err != nil {
		return row, fmt.Errorf("finish image conversation turn: %w", err)
	}
	return final, nil
}
func (s *Service) finalize(ctx context.Context, task query.ImageTask, status, code string) error {
	return db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if _, err := q.LockCreditOwnerForSettlement(ctx, task.UserID); err != nil {
			return fmt.Errorf("lock final image owner: %w", err)
		}
		current, err := q.LockImageTask(ctx, task.ID)
		if err != nil {
			return fmt.Errorf("lock final image task: %w", err)
		}
		if Terminal(current.Status) {
			return nil
		}
		if current.Status != "running" || current.RunToken == nil || task.RunToken == nil || *current.RunToken != *task.RunToken {
			return nil
		}
		owner, ownerErr := q.GetUser(ctx, current.UserID)
		if ownerErr != nil && !errors.Is(ownerErr, pgx.ErrNoRows) {
			return fmt.Errorf("check final image owner: %w", ownerErr)
		}
		if current.CancelRequested || errors.Is(ownerErr, pgx.ErrNoRows) || owner.Status != "active" {
			status, code = "canceled", "IMAGE_TASK_CANCELED"
		}
		items, err := q.ListImageTaskItems(ctx, []uuid.UUID{task.ID})
		if err != nil {
			return fmt.Errorf("count successful image slots: %w", err)
		}
		success := int32(0)
		for _, item := range items {
			if item.Status == "succeeded" {
				success++
			}
			if code == "" && item.ErrorCode != "" {
				code = item.ErrorCode
			}
		}
		if status == "" {
			status = "succeeded"
			if success == 0 {
				status = "failed"
				if code == "" {
					code = "IMAGE_GENERATION_FAILED"
				}
			} else if success < current.ImageCount {
				status = "partial"
				code = "IMAGE_PARTIAL"
			}
		}
		_, err = s.finishTx(ctx, q, current, status, code, success)
		return err
	})
}
func (s *Service) Execute(ctx context.Context, task query.ImageTask) {
	work, cancel := context.WithTimeout(ctx, time.Duration(task.TimeoutSeconds)*time.Second)
	defer cancel()
	heartbeatDone := make(chan struct{})
	go func() {
		defer close(heartbeatDone)
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-work.Done():
				return
			case <-ticker.C:
				owner, err := s.q.GetUser(work, task.UserID)
				if err != nil || owner.Status != "active" {
					cancel()
					return
				}
				conv, err := s.q.GetImageConversation(work, query.GetImageConversationParams{ID: task.ConversationID, UserID: task.UserID})
				if err != nil || conv.DeletedAt != nil {
					cancel()
					return
				}
				updated, err := s.q.HeartbeatImageTask(work, query.HeartbeatImageTaskParams{ID: task.ID, RunToken: task.RunToken})
				if err != nil || updated != 1 {
					cancel()
					return
				}
			}
		}
	}()
	_, client, remote, err := s.catalog.ImageTarget(work, task.ModelID)
	code := ""
	if err != nil {
		code = "IMAGE_MODEL_UNAVAILABLE"
	} else {
		refs := make([]upstream.Reference, 0, len(task.ReferenceFileIds))
		for _, id := range task.ReferenceFileIds {
			data, err := s.files.Reference(work, task.UserID, id)
			if err != nil {
				code = "FILE_NOT_FOUND"
				break
			}
			refs = append(refs, upstream.Reference{Name: id.String() + ".png", MIME: "image/png", Data: data})
		}
		if code == "" {
			request := upstream.ImageRequest{Model: remote, Prompt: task.Prompt, Quality: task.Quality, Size: task.Size, Count: int(task.ImageCount)}
			run := func(position int32, count int) {
				input := request
				input.Count = count
				var results []upstream.ImageResult
				var callErr error
				if task.Operation == "edit" {
					results, callErr = client.EditImages(work, upstream.EditRequest{ImageRequest: input, References: refs})
				} else {
					results, callErr = client.GenerateImages(work, input)
				}
				errorCode := upstream.FailureCode(callErr)
				for index := 0; index < count; index++ {
					result := upstream.ImageResult{}
					itemCode := errorCode
					if callErr == nil {
						if index < len(results) {
							result = results[index]
						} else {
							itemCode = "IMAGE_RESULT_MISSING"
						}
					}
					if err := s.saveItem(work, task, position+int32(index), result, client, itemCode); err != nil {
						s.report(work, "save image result failed", err)
					}
				}
			}
			if task.SplitRequests && task.ImageCount > 1 {
				var group sync.WaitGroup
				for position := int32(0); position < task.ImageCount; position++ {
					group.Go(func() { run(position, 1) })
				}
				group.Wait()
			} else {
				run(0, int(task.ImageCount))
			}
		}
		client.Close()
	}
	workErr := work.Err()
	cancel()
	<-heartbeatDone
	status := ""
	if workErr != nil {
		status = "failed"
		code = "UPSTREAM_TIMEOUT"
		if errors.Is(workErr, context.Canceled) {
			code = "IMAGE_INTERRUPTED"
		}
	}
	if code != "" && status == "" {
		status = "failed"
	}
	save, stop := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer stop()
	if err := s.finalize(save, task, status, code); err != nil {
		s.report(save, "settle image task failed", err)
	}
}
func (s *Service) Cancel(ctx context.Context, actor user.Actor, id uuid.UUID) (Task, error) {
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := checkOwner(ctx, q, actor); err != nil {
			return err
		}
		row, err := q.LockImageTask(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && row.UserID != actor.ID) {
			return problem.New("IMAGE_TASK_NOT_FOUND", 404)
		}
		if err != nil {
			return fmt.Errorf("lock canceled image: %w", err)
		}
		if Terminal(row.Status) {
			return nil
		}
		if row.Status == "queued" {
			_, err = s.finishTx(ctx, q, row, "canceled", "IMAGE_TASK_CANCELED", 0)
			return err
		}
		if err := q.CancelImageTask(ctx, id); err != nil {
			return fmt.Errorf("request image cancellation: %w", err)
		}
		return nil
	})
	if err != nil {
		return Task{}, err
	}
	return s.Get(ctx, actor, id, false)
}
func (s *Service) Recover(ctx context.Context) error {
	tasks, err := s.q.ExpiredImageTasks(ctx)
	if err != nil {
		return fmt.Errorf("scan expired images: %w", err)
	}
	for _, task := range tasks {
		err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
			if _, err := q.LockCreditOwnerForSettlement(ctx, task.UserID); err != nil {
				return fmt.Errorf("lock recovered owner: %w", err)
			}
			current, err := q.LockImageTask(ctx, task.ID)
			if err != nil {
				return fmt.Errorf("lock recovered image: %w", err)
			}
			if Terminal(current.Status) {
				return nil
			}
			owner, ownerErr := q.GetUser(ctx, current.UserID)
			inactive := errors.Is(ownerErr, pgx.ErrNoRows) || (ownerErr == nil && owner.Status != "active")
			if ownerErr != nil && !errors.Is(ownerErr, pgx.ErrNoRows) {
				return fmt.Errorf("check recovered owner: %w", ownerErr)
			}
			_, convErr := q.GetImageConversation(ctx, query.GetImageConversationParams{ID: current.ConversationID, UserID: current.UserID})
			if convErr != nil && !errors.Is(convErr, pgx.ErrNoRows) {
				return fmt.Errorf("check recovered conversation: %w", convErr)
			}
			dead := inactive || errors.Is(convErr, pgx.ErrNoRows)
			expired := (current.Status == "queued" && current.QueueDeadline.Before(time.Now())) || (current.Status == "running" && current.LeaseUntil != nil && current.LeaseUntil.Before(time.Now()))
			if !dead && !expired {
				return nil
			}
			code := "IMAGE_TASK_EXPIRED"
			if dead {
				code = "IMAGE_TASK_CANCELED"
			}
			status := "failed"
			if dead || current.CancelRequested {
				status = "canceled"
			}
			_, err = s.finishTx(ctx, q, current, status, code, 0)
			return err
		})
		if err != nil {
			return err
		}
	}
	return nil
}
func (s *Service) reconcile(ctx context.Context) error {
	rows, err := s.q.ImageQueueCandidates(ctx)
	if err != nil {
		return fmt.Errorf("read durable image queue: %w", err)
	}
	for _, row := range rows {
		if err := s.queue.EnqueueImage(ctx, row.ID.String(), row.CreatedAt); err != nil {
			return err
		}
	}
	return nil
}
func (s *Service) Run(ctx context.Context) {
	work, cancel := context.WithCancel(ctx)
	defer cancel()
	var workers sync.WaitGroup
	defer workers.Wait()
	poll := time.NewTicker(500 * time.Millisecond)
	defer poll.Stop()
	recovery := time.NewTicker(15 * time.Second)
	defer recovery.Stop()
	cleanup := time.NewTicker(time.Hour)
	defer cleanup.Stop()
	for _, job := range []func(context.Context) error{s.Recover, s.reconcile} {
		if err := job(work); err != nil {
			s.report(work, "initialize image workers failed", err)
		}
	}
	for {
		select {
		case <-ctx.Done():
			cancel()
			return
		case <-recovery.C:
			if err := s.Recover(work); err != nil {
				s.report(work, "recover image tasks failed", err)
			}
			if err := s.reconcile(work); err != nil {
				s.report(work, "repair image queue failed", err)
			}
		case <-cleanup.C:
			cfg, err := s.Configuration(work)
			if err == nil {
				err = s.files.Cleanup(work, cfg.RetentionDays)
			}
			if err != nil {
				s.report(work, "clean image storage failed", err)
			}
		case <-poll.C:
			ids, err := s.queue.PopImages(work)
			if err != nil {
				s.report(work, "read image queue failed", err)
				continue
			}
			for _, text := range ids {
				id, err := uuid.Parse(text)
				if err != nil {
					continue
				}
				task, claimed, err := s.Claim(work, id)
				if err != nil {
					s.report(work, "claim image task failed", err)
				}
				if claimed {
					workers.Go(func() { s.Execute(work, task) })
				} else if task.Status == "queued" && task.QueueDeadline.After(time.Now()) {
					if err := s.queue.EnqueueImage(work, text, time.Now().Add(time.Second)); err != nil {
						s.report(work, "defer image task failed", err)
					}
				}
			}
		}
	}
}
