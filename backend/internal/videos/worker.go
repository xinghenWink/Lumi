package videos

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xinghenWink/Lumi/backend/internal/catalog"
	"github.com/xinghenWink/Lumi/backend/internal/credits"
	"github.com/xinghenWink/Lumi/backend/internal/media"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/upstream/video"
)

func (s *Service) Run(ctx context.Context) {
	var group sync.WaitGroup
	for range 4 {
		group.Go(func() {
			ticker := time.NewTicker(time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					if err := s.step(ctx); err != nil && ctx.Err() == nil {
						s.logger.ErrorContext(ctx, "video worker step failed", "error_type", fmt.Sprintf("%T", err))
					}
				}
			}
		})
	}
	group.Wait()
}

func (s *Service) step(ctx context.Context) error {
	token, err := validation.NewID()
	if err != nil {
		return err
	}
	var claim query.ClaimVideoItemRow
	err = db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := q.LockVideoScheduler(ctx); err != nil {
			return fmt.Errorf("lock video scheduler: %w", err)
		}
		var err error
		claim, err = q.ClaimVideoItem(ctx, &token)
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("claim video slot: %w", err)
	}
	item := claim.VideoTaskItem
	task, err := s.q.VideoTaskByID(ctx, item.TaskID)
	if err != nil {
		return fmt.Errorf("read claimed video task: %w", err)
	}
	if time.Now().After(task.Deadline) {
		code := "VIDEO_TASK_TIMEOUT"
		if item.Status == "submitting" && claim.PreviousStatus != "queued" {
			code = "VIDEO_SUBMIT_UNCONFIRMED"
		}
		return s.finish(ctx, task, item, nil, code)
	}
	if err := s.q.SetVideoTaskRunning(ctx, task.ID); err != nil {
		return fmt.Errorf("mark video task running: %w", err)
	}
	var routes []catalog.VideoRoute
	if err := json.Unmarshal(task.Routes, &routes); err != nil {
		return fmt.Errorf("decode video route snapshots: %w", err)
	}
	var input Input
	if err := json.Unmarshal(task.Request, &input); err != nil {
		return fmt.Errorf("decode video worker input: %w", err)
	}
	if claim.PreviousStatus == "queued" {
		return s.submitItem(ctx, task, item, input, routes)
	}
	if item.RouteIndex < 0 || int(item.RouteIndex) >= len(routes) {
		return s.finish(ctx, task, item, nil, "VIDEO_MODEL_UNAVAILABLE")
	}
	client, err := s.byModel.OpenVideoRoute(routes[item.RouteIndex])
	if err != nil {
		return s.finish(ctx, task, item, nil, "VIDEO_MODEL_UNAVAILABLE")
	}
	if item.RemoteID == "" {
		if recovery, ok := client.(video.RecoveryAdapter); ok {
			id, err := recovery.Recover(ctx, videoRequestID(task.ID, item.Position))
			if err == nil {
				return s.release(ctx, item, "running", id, time.Now())
			}
			return s.release(ctx, item, "submitting", "", minTime(task.Deadline, time.Now().Add(20*time.Second)))
		}
		return s.release(ctx, item, "submitting", "", task.Deadline)
	}
	snapshot, err := client.Query(ctx, item.RemoteID)
	if err != nil {
		return s.release(ctx, item, "running", item.RemoteID, time.Now().Add(20*time.Second))
	}
	switch snapshot.State {
	case video.Failed:
		return s.finish(ctx, task, item, nil, "VIDEO_UPSTREAM_FAILED")
	case video.Succeeded:
		stream, err := client.Download(ctx, snapshot)
		if err != nil {
			return s.release(ctx, item, "running", item.RemoteID, time.Now().Add(20*time.Second))
		}
		result, prepareErr := s.files.PrepareAV(ctx, task.UserID, &task.ID, stream, "video_generated", MaxOutput, !input.GenerateAudio)
		closeErr := stream.Close()
		if prepareErr != nil {
			return s.finish(ctx, task, item, nil, "VIDEO_RESULT_INVALID")
		}
		if closeErr != nil {
			if err := s.files.Discard(result.Params); err != nil {
				return err
			}
			return s.release(ctx, item, "running", item.RemoteID, time.Now().Add(20*time.Second))
		}
		if err := s.finish(ctx, task, item, &result, ""); err != nil {
			return errors.Join(err, s.files.Discard(result.Params))
		}
		return nil
	default:
		return s.release(ctx, item, "running", item.RemoteID, time.Now().Add(10*time.Second))
	}
}

func (s *Service) submitItem(ctx context.Context, task query.VideoTask, item query.VideoTaskItem, input Input, routes []catalog.VideoRoute) error {
	expires := task.Deadline.Unix()
	request := video.Request{Prompt: input.Prompt, Options: input.Options, RequestID: videoRequestID(task.ID, item.Position)}
	for _, asset := range input.References {
		scope := task.ID.String()
		sig := s.files.VideoTicket(asset.FileID, task.ID, "reference", expires)
		path := s.publicOrigin + "/api/v1/video-media/" + asset.FileID.String() + "/reference?task=" + scope + "&expires=" + strconv.FormatInt(expires, 10) + "&sig=" + sig
		request.References = append(request.References, video.ReferenceInput{Token: asset.Token, Role: asset.Role, URL: path})
	}
	for i, route := range routes {
		adapter, err := s.byModel.OpenVideoRoute(route)
		if err != nil {
			continue
		}
		n, err := s.q.SetVideoItemRoute(ctx, query.SetVideoItemRouteParams{TaskID: item.TaskID, Position: item.Position, LeaseToken: item.LeaseToken, RouteIndex: int32(i), RouteID: &route.ID, ChannelID: &route.ChannelID, ChannelVersion: &route.ChannelVersion, Protocol: route.Protocol, Profile: route.Profile})
		if err != nil {
			return fmt.Errorf("persist attempted video route: %w", err)
		}
		if n != 1 {
			return nil
		}
		request.Model = route.RemoteModel
		id, err := adapter.Submit(ctx, request)
		if err == nil {
			// Preserve an accepted task even during graceful shutdown.
			persisted, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			defer cancel()
			return s.release(persisted, item, "running", id, time.Now().Add(5*time.Second))
		}
		if !video.IsDefinite(err) {
			next := task.Deadline
			if _, ok := adapter.(video.RecoveryAdapter); ok {
				next = minTime(next, time.Now().Add(20*time.Second))
			}
			return s.release(ctx, item, "submitting", "", next)
		}
		var failed *video.Failure
		if errors.As(err, &failed) && failed.Code == "UPSTREAM_REQUEST_INVALID" {
			return s.finish(ctx, task, item, nil, failed.Code)
		}
	}
	return s.finish(ctx, task, item, nil, "VIDEO_MODEL_UNAVAILABLE")
}

func videoRequestID(task uuid.UUID, position int32) string {
	return task.String() + "-" + strconv.Itoa(int(position))
}

func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

func (s *Service) release(ctx context.Context, item query.VideoTaskItem, status, id string, next time.Time) error {
	_, err := s.q.ReleaseVideoItem(ctx, query.ReleaseVideoItemParams{TaskID: item.TaskID, Position: item.Position, LeaseToken: item.LeaseToken, Status: status, RemoteID: id, NextRun: next})
	if err != nil {
		return fmt.Errorf("release video slot: %w", err)
	}
	return nil
}

func (s *Service) finish(ctx context.Context, task query.VideoTask, item query.VideoTaskItem, result *media.AVFile, code string) error {
	return db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if _, err := q.LockCreditOwnerForSettlement(ctx, task.UserID); err != nil {
			return fmt.Errorf("lock video settlement owner: %w", err)
		}
		current, err := q.LockVideoTask(ctx, task.ID)
		if err != nil {
			return fmt.Errorf("lock video settlement: %w", err)
		}
		if current.Status != "queued" && current.Status != "running" {
			return fmt.Errorf("video task is already closed")
		}
		var id *uuid.UUID
		status := "failed"
		if result != nil {
			file, err := q.InsertImageFile(ctx, result.Params)
			if err != nil {
				return fmt.Errorf("store video file: %w", err)
			}
			if err := q.SetFileDuration(ctx, query.SetFileDurationParams{ID: file.ID, DurationMs: result.Duration}); err != nil {
				return fmt.Errorf("record video duration: %w", err)
			}
			id = &file.ID
			status = "succeeded"
		}
		changed, err := q.ReleaseVideoItem(ctx, query.ReleaseVideoItemParams{TaskID: item.TaskID, Position: item.Position, LeaseToken: item.LeaseToken, Status: status, RemoteID: item.RemoteID, NextRun: time.Now(), ErrorCode: code, FileID: id})
		if err != nil {
			return fmt.Errorf("finish video slot: %w", err)
		}
		if changed != 1 {
			return fmt.Errorf("video slot lease was lost")
		}
		items, err := q.GetVideoTaskItems(ctx, task.ID)
		if err != nil {
			return fmt.Errorf("read video settlement slots: %w", err)
		}
		var succeeded int
		for _, part := range items {
			switch part.Status {
			case "succeeded":
				succeeded++
			case "failed":
			default:
				return nil
			}
		}
		var quote credits.VideoQuote
		if err := json.Unmarshal(task.Quote, &quote); err != nil {
			return fmt.Errorf("read video settlement price: %w", err)
		}
		refund := quote.UnitPrice * int64(len(items)-succeeded)
		if err := s.billing.ApplyVideoTx(ctx, q, task.UserID, task.ID, quote.Pool, refund, "video-refund:"+task.ID.String()); err != nil {
			return err
		}
		status = "succeeded"
		if succeeded == 0 {
			status = "failed"
		} else if succeeded < len(items) {
			status = "partial"
		}
		if err := q.FinishVideoTask(ctx, query.FinishVideoTaskParams{ID: task.ID, Status: status, Refunded: refund}); err != nil {
			return fmt.Errorf("close video task: %w", err)
		}
		return nil
	})
}
