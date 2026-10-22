package images

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

func (s *Service) ManualRefund(ctx context.Context, actor user.Actor, id uuid.UUID, note string) error {
	note = strings.TrimSpace(note)
	if !validation.Text(note, 1, 200) {
		return problem.Invalid()
	}
	original, err := s.q.GetImageTask(ctx, id)
	if err != nil {
		return problem.New("IMAGE_TASK_NOT_FOUND", 404)
	}
	return db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		if _, err := q.LockCreditOwnerForSettlement(ctx, original.UserID); err != nil {
			return fmt.Errorf("lock manual refund owner: %w", err)
		}
		row, err := q.LockImageTask(ctx, id)
		if err != nil {
			return fmt.Errorf("lock manual refund task: %w", err)
		}
		if !Terminal(row.Status) {
			return problem.New("IMAGE_REFUND_INVALID", 409)
		}
		if row.RefundedCost == row.TotalCost {
			return nil
		}
		if err := s.billing.ManualRefundTx(ctx, q, row.UserID, row.ChargeID, row.RefundedCost, actor, note); err != nil {
			return err
		}
		if err := q.AddManualRefund(ctx, id); err != nil {
			return fmt.Errorf("save manual task refund: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "image.refund", TargetType: "image_task", TargetID: &id, After: map[string]any{"refund": row.TotalCost - row.RefundedCost, "note": note}, IP: actor.IP})
	})
}

func (s *Service) BatchDelete(ctx context.Context, actor user.Actor, ids []uuid.UUID) error {
	if len(ids) < 1 || len(ids) > 100 {
		return problem.Invalid()
	}
	seen := map[uuid.UUID]bool{}
	for _, id := range ids {
		if id == uuid.Nil || seen[id] {
			return problem.Invalid()
		}
		seen[id] = true
	}
	return db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := checkOwner(ctx, q, actor); err != nil {
			return err
		}
		for _, id := range ids {
			row, err := q.GetImageFile(ctx, id)
			if err != nil || row.UserID != actor.ID || row.Kind != "generated" {
				return problem.New("FILE_NOT_FOUND", 404)
			}
			busy, err := q.ImageFileInUse(ctx, id)
			if err != nil {
				return fmt.Errorf("check batch image use: %w", err)
			}
			if busy {
				return problem.New("FILE_IN_USE", 409)
			}
			if _, err := q.DeleteImageFile(ctx, query.DeleteImageFileParams{ID: id, UserID: actor.ID}); err != nil {
				return fmt.Errorf("delete batch image: %w", err)
			}
		}
		return nil
	})
}
