package credits

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

func (s *Service) BatchGrant(ctx context.Context, actor user.Actor, ids []uuid.UUID, key string, amount int64, note string) error {
	if len(ids) < 1 || len(ids) > 100 || amount < 1 || amount > MaxBalance || !validation.Text(note, 1, 200) {
		return problem.Invalid()
	}
	ids = slices.Clone(ids)
	slices.SortFunc(ids, func(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) })
	for i, id := range ids {
		if id == uuid.Nil || (i > 0 && ids[i-1] == id) {
			return problem.Invalid()
		}
	}
	return db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		request := struct {
			IDs    []uuid.UUID
			Amount int64
			Note   string
		}{ids, amount, note}
		_, err := idempotent(ctx, q, actor.ID, key, "batch_grant", request, func(operation uuid.UUID) (bool, error) {
			cfg, err := configuration(ctx, q)
			if err != nil {
				return false, err
			}
			for _, id := range ids {
				if err := lockUser(ctx, q, id, false); err != nil {
					return false, err
				}
				record, err := s.account(ctx, q, id, cfg)
				if err != nil {
					return false, err
				}
				if err := change(ctx, q, &record, "admin_adjust", "permanent", amount, operation.String()+":"+id.String(), "user", &id, &actor.ID, note); err != nil {
					return false, err
				}
				if err := audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "credits.batch_grant", TargetType: "user", TargetID: &id, After: map[string]int64{"amount": amount}, IP: actor.IP}); err != nil {
					return false, err
				}
			}
			return true, nil
		})
		return err
	})
}

// ManualRefundTx returns only the still-charged portion; the task lock fences repeats.
func (s *Service) ManualRefundTx(ctx context.Context, q *query.Queries, owner uuid.UUID, chargeID uuid.UUID, already int64, actor user.Actor, note string) error {
	cfg, err := configuration(ctx, q)
	if err != nil {
		return err
	}
	account, err := s.account(ctx, q, owner, cfg)
	if err != nil {
		return err
	}
	charge, err := q.LockCreditCharge(ctx, query.LockCreditChargeParams{ID: chargeID, UserID: owner})
	if err != nil {
		return fmt.Errorf("lock manual refund charge: %w", err)
	}
	if !charge.Settled || already < 0 || already > charge.TotalCost {
		return problem.New("IMAGE_REFUND_INVALID", 409)
	}
	refund := charge.TotalCost - already
	if refund == 0 {
		return nil
	}
	daily := charge.DailyCharged - min(already, charge.DailyCharged)
	permanent := refund - daily
	if account.DailyResetOn == nil || !charge.DailyResetOn.Equal(*account.DailyResetOn) {
		permanent += daily
		daily = 0
	}
	if err := change(ctx, q, &account, "image_refund", "daily", daily, "manual-refund:"+chargeID.String()+":daily", "image_task", &charge.ReferenceID, &actor.ID, note); err != nil {
		return err
	}
	return change(ctx, q, &account, "image_refund", "permanent", permanent, "manual-refund:"+chargeID.String()+":permanent", "image_task", &charge.ReferenceID, &actor.ID, note)
}
