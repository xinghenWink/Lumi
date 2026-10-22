package credits

import (
	"context"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"net/http"
)

// Charge is an internal task API. HTTP clients cannot directly debit or settle tasks.
func (s *Service) Charge(ctx context.Context, owner uuid.UUID, key string, reference uuid.UUID, input QuoteInput) (Charge, error) {
	if reference == uuid.Nil {
		return Charge{}, problem.Invalid()
	}
	var result Charge
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := lockUser(ctx, q, owner, true); err != nil {
			return err
		}
		request := struct {
			Reference uuid.UUID
			Quote     QuoteInput
		}{reference, input}
		var err error
		result, err = idempotent(ctx, q, owner, key, "image_charge", request, func(id uuid.UUID) (Charge, error) {
			if err := q.ReadCreditConfigurationLock(ctx); err != nil {
				return Charge{}, fmt.Errorf("lock charge pricing: %w", err)
			}
			cfg, err := configuration(ctx, q)
			if err != nil {
				return Charge{}, err
			}
			quote, err := price(ctx, q, cfg, input)
			if err != nil {
				return Charge{}, err
			}
			record, err := s.account(ctx, q, owner, cfg)
			if err != nil {
				return Charge{}, err
			}
			if record.DailyBalance+record.PermanentBalance < quote.TotalCost {
				return Charge{}, problem.New("CREDITS_INSUFFICIENT", http.StatusConflict)
			}
			daily := min(quote.TotalCost, record.DailyBalance)
			permanent := quote.TotalCost - daily
			if err := change(ctx, q, &record, "image_charge", "daily", -daily, id.String()+":daily", "image_task", &reference, nil, ""); err != nil {
				return Charge{}, err
			}
			if err := change(ctx, q, &record, "image_charge", "permanent", -permanent, id.String()+":permanent", "image_task", &reference, nil, ""); err != nil {
				return Charge{}, err
			}
			if err := q.CreateCreditCharge(ctx, query.CreateCreditChargeParams{ID: id, UserID: owner, ReferenceID: reference, ModelID: input.ModelID, Operation: input.Operation, Quality: input.Quality, Size: input.Size, ImageCount: input.Count, UnitPrice: quote.UnitPrice, TotalCost: quote.TotalCost, DailyCharged: daily, PermanentCharged: permanent, DailyResetOn: *record.DailyResetOn}); err != nil {
				return Charge{}, fmt.Errorf("record charge snapshot: %w", err)
			}
			view, err := accountView(record, cfg, s.now())
			if err != nil {
				return Charge{}, err
			}
			return Charge{ID: id, Quote: quote, Account: view, DailyCharged: daily, PermanentCharged: permanent}, nil
		})
		return err
	})
	return result, err
}

// Settle closes one task once; failures refund the original snapshotted unit price.
// Daily credits from an earlier calendar day are returned to the permanent bucket.
func (s *Service) Settle(ctx context.Context, owner uuid.UUID, key string, chargeID uuid.UUID, failed int64) (Settlement, error) {
	if chargeID == uuid.Nil || failed < 0 || failed > 10 {
		return Settlement{}, problem.Invalid()
	}
	var result Settlement
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		// In-flight refunds remain possible during the soft-delete retention period.
		if _, err := q.LockCreditOwnerForSettlement(ctx, owner); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return problem.New("USER_NOT_FOUND", http.StatusNotFound)
			}
			return fmt.Errorf("lock settlement owner: %w", err)
		}
		var err error
		request := struct {
			ChargeID uuid.UUID
			Failed   int64
		}{chargeID, failed}
		result, err = idempotent(ctx, q, owner, key, "image_settle", request, func(operation uuid.UUID) (Settlement, error) {
			cfg, err := configuration(ctx, q)
			if err != nil {
				return Settlement{}, err
			}
			record, err := s.account(ctx, q, owner, cfg)
			if err != nil {
				return Settlement{}, err
			}
			charge, err := q.LockCreditCharge(ctx, query.LockCreditChargeParams{ID: chargeID, UserID: owner})
			if errors.Is(err, pgx.ErrNoRows) {
				return Settlement{}, problem.New("CHARGE_NOT_FOUND", http.StatusNotFound)
			}
			if err != nil {
				return Settlement{}, fmt.Errorf("lock charge settlement: %w", err)
			}
			if charge.Settled {
				return Settlement{}, problem.New("CHARGE_ALREADY_SETTLED", http.StatusConflict)
			}
			if failed > charge.ImageCount {
				return Settlement{}, problem.Invalid()
			}
			refund := failed * charge.UnitPrice
			daily := min(refund, charge.DailyCharged)
			permanent := refund - daily
			if record.DailyResetOn == nil || !charge.DailyResetOn.Equal(*record.DailyResetOn) {
				permanent += daily
				daily = 0
			}
			if err := change(ctx, q, &record, "image_refund", "daily", daily, operation.String()+":daily", "image_task", &charge.ReferenceID, nil, ""); err != nil {
				return Settlement{}, err
			}
			if err := change(ctx, q, &record, "image_refund", "permanent", permanent, operation.String()+":permanent", "image_task", &charge.ReferenceID, nil, ""); err != nil {
				return Settlement{}, err
			}
			if err := q.SettleCreditCharge(ctx, query.SettleCreditChargeParams{ID: chargeID, FailedImages: failed}); err != nil {
				return Settlement{}, fmt.Errorf("complete charge settlement: %w", err)
			}
			view, err := accountView(record, cfg, s.now())
			if err != nil {
				return Settlement{}, err
			}
			return Settlement{ChargeID: chargeID, FailedImages: failed, Refunded: refund, Account: view}, nil
		})
		return err
	})
	return result, err
}
