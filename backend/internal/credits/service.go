package credits

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/secrets"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

type Gate interface {
	Allow(context.Context, string, string, int, time.Duration) (bool, int, error)
	LoginLocked(context.Context, string) (bool, int, error)
	LoginFailed(context.Context, string, int, time.Duration) error
	LoginSucceeded(context.Context, string) error
}
type Service struct {
	pool    *pgxpool.Pool
	queries *query.Queries
	vault   *secrets.Vault
	gate    Gate
	now     func() time.Time
}

func New(pool *pgxpool.Pool, vault *secrets.Vault, gate Gate, clock func() time.Time) *Service {
	if clock == nil {
		clock = time.Now
	}
	return &Service{pool: pool, queries: query.New(pool), vault: vault, gate: gate, now: clock}
}
func lockUser(ctx context.Context, q *query.Queries, id uuid.UUID, active bool) error {
	record, err := q.LockCreditUser(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return problem.New("USER_NOT_FOUND", http.StatusNotFound)
	}
	if err != nil {
		return fmt.Errorf("lock credit owner: %w", err)
	}
	if active && record.Status != "active" {
		return problem.New("ACCOUNT_DISABLED", http.StatusForbidden)
	}
	return nil
}
func ValidKey(value string) bool {
	if len(value) < 8 || len(value) > 128 {
		return false
	}
	for _, ch := range value {
		if (ch < 'a' || ch > 'z') && (ch < 'A' || ch > 'Z') && (ch < '0' || ch > '9') && !strings.ContainsRune("-_:.", ch) {
			return false
		}
	}
	return true
}

// idempotent stores the response in the same transaction as the financial mutation.
func idempotent[T any](ctx context.Context, q *query.Queries, owner uuid.UUID, key, kind string, input any, action func(uuid.UUID) (T, error)) (T, error) {
	var result T
	if !ValidKey(key) {
		return result, problem.New("IDEMPOTENCY_KEY_INVALID", http.StatusBadRequest)
	}
	payload, err := json.Marshal(input)
	if err != nil {
		return result, fmt.Errorf("encode operation request: %w", err)
	}
	digest := sha256.Sum256(payload)
	fingerprint := hex.EncodeToString(digest[:])
	if err := q.LockCreditOperation(ctx, owner.String()+":"+key); err != nil {
		return result, fmt.Errorf("lock credit operation: %w", err)
	}
	previous, err := q.GetCreditOperation(ctx, query.GetCreditOperationParams{UserID: owner, Key: key})
	if err == nil {
		if previous.Kind != kind || previous.RequestHash != fingerprint {
			return result, problem.New("IDEMPOTENCY_CONFLICT", http.StatusConflict)
		}
		if err := json.Unmarshal(previous.Response, &result); err != nil {
			return result, fmt.Errorf("decode original operation: %w", err)
		}
		return result, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return result, fmt.Errorf("read credit operation: %w", err)
	}
	id, err := validation.NewID()
	if err != nil {
		return result, err
	}
	result, err = action(id)
	if err != nil {
		return result, err
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return result, fmt.Errorf("encode operation result: %w", err)
	}
	if err := q.CreateCreditOperation(ctx, query.CreateCreditOperationParams{ID: id, UserID: owner, Key: key, Kind: kind, RequestHash: fingerprint, Response: encoded}); err != nil {
		return result, fmt.Errorf("record credit operation: %w", err)
	}
	return result, nil
}
func calendar(now time.Time, zone string) (time.Time, *time.Location, error) {
	location, err := time.LoadLocation(zone)
	if err != nil {
		return time.Time{}, nil, fmt.Errorf("load credit timezone: %w", err)
	}
	local := now.In(location)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC), location, nil
}
func accountView(record query.CreditAccount, cfg Configuration, now time.Time) (Account, error) {
	today, location, err := calendar(now, cfg.CreditsTimezone)
	if err != nil {
		return Account{}, err
	}
	if record.DailyResetOn != nil && record.DailyResetOn.After(today) {
		today = *record.DailyResetOn
	}
	next := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, location).AddDate(0, 0, 1)
	date := ""
	if record.DailyResetOn != nil {
		date = record.DailyResetOn.Format(time.DateOnly)
	}
	return Account{UserID: record.UserID, PermanentBalance: record.PermanentBalance, DailyBalance: record.DailyBalance, Total: record.PermanentBalance + record.DailyBalance, DailyResetOn: date, NextResetAt: next.UTC(), Timezone: cfg.CreditsTimezone, Version: record.Version}, nil
}
func saveAccount(ctx context.Context, q *query.Queries, account *query.CreditAccount) error {
	if err := q.SaveCreditAccount(ctx, query.SaveCreditAccountParams{UserID: account.UserID, PermanentBalance: account.PermanentBalance, DailyBalance: account.DailyBalance, DailyResetOn: account.DailyResetOn}); err != nil {
		return fmt.Errorf("save credit account: %w", err)
	}
	account.Version++
	return nil
}
func change(ctx context.Context, q *query.Queries, account *query.CreditAccount, kind, bucket string, delta int64, key, refType string, refID, operator *uuid.UUID, note string) error {
	if delta == 0 {
		return nil
	}
	balance := &account.PermanentBalance
	if bucket == "daily" {
		balance = &account.DailyBalance
	} else if bucket != "permanent" {
		return problem.Invalid()
	}
	if delta < -*balance {
		return problem.New("CREDITS_INSUFFICIENT", http.StatusConflict)
	}
	if delta > MaxBalance-*balance {
		return problem.New("CREDITS_LIMIT", http.StatusConflict)
	}
	*balance += delta
	if err := saveAccount(ctx, q, account); err != nil {
		return err
	}
	id, err := validation.NewID()
	if err != nil {
		return err
	}
	if err := q.AppendCreditLedger(ctx, query.AppendCreditLedgerParams{ID: id, UserID: account.UserID, Type: kind, Bucket: bucket, Delta: delta, BucketBalanceAfter: *balance, TotalAfter: account.PermanentBalance + account.DailyBalance, RefType: refType, RefID: refID, IdempotencyKey: key, OperatorID: operator, Note: note}); err != nil {
		return fmt.Errorf("append credit ledger: %w", err)
	}
	return nil
}
func (s *Service) account(ctx context.Context, q *query.Queries, id uuid.UUID, cfg Configuration) (query.CreditAccount, error) {
	record, err := q.LockCreditAccount(ctx, id)
	if err != nil {
		return record, fmt.Errorf("lock credit account: %w", err)
	}
	today, _, err := calendar(s.now(), cfg.CreditsTimezone)
	if err != nil {
		return record, err
	}
	if record.DailyResetOn == nil || record.DailyResetOn.Before(today) {
		record.DailyResetOn = &today
		key := "daily:" + id.String() + ":" + today.Format(time.DateOnly)
		if err := change(ctx, q, &record, "daily_expire", "daily", -record.DailyBalance, key+":expire", "", nil, nil, ""); err != nil {
			return record, err
		}
		if err := change(ctx, q, &record, "daily_grant", "daily", cfg.DailyFreeCredits, key+":grant", "", nil, nil, ""); err != nil {
			return record, err
		}
		if err := saveAccount(ctx, q, &record); err != nil {
			return record, err
		}
	}
	return record, nil
}
func (s *Service) Read(ctx context.Context, id uuid.UUID) (Account, error) {
	cfg, err := configuration(ctx, s.queries)
	if err != nil {
		return Account{}, err
	}
	now := s.now()
	today, _, err := calendar(now, cfg.CreditsTimezone)
	if err != nil {
		return Account{}, err
	}
	expireID, err := validation.NewID()
	if err != nil {
		return Account{}, err
	}
	grantID, err := validation.NewID()
	if err != nil {
		return Account{}, err
	}
	row, err := s.queries.ReadCreditAccount(ctx, query.ReadCreditAccountParams{UserID: id, GrantAmount: cfg.DailyFreeCredits, Today: today, ExpireID: expireID, GrantID: grantID})
	if errors.Is(err, pgx.ErrNoRows) {
		return Account{}, problem.New("USER_NOT_FOUND", http.StatusNotFound)
	}
	if err != nil {
		return Account{}, fmt.Errorf("read and reset credit account: %w", err)
	}
	return accountView(query.CreditAccount{UserID: row.UserID, PermanentBalance: row.PermanentBalance, DailyBalance: row.DailyBalance, DailyResetOn: &row.DailyResetOn, Version: row.Version}, cfg, now)
}
func (s *Service) Summary(ctx context.Context, id uuid.UUID) (int64, int64, error) {
	result, err := s.Read(ctx, id)
	return result.PermanentBalance, result.DailyBalance, err
}
func (s *Service) Day(ctx context.Context) (string, int64, error) {
	cfg, err := configuration(ctx, s.queries)
	if err != nil {
		return "", 0, err
	}
	today, _, err := calendar(s.now(), cfg.CreditsTimezone)
	return today.Format(time.DateOnly), cfg.DailyFreeCredits, err
}

// Signup is called after CreateUser inside the registration transaction.
func (s *Service) Signup(ctx context.Context, q *query.Queries, id uuid.UUID) error {
	cfg, err := configuration(ctx, q)
	if err != nil {
		return err
	}
	record, err := q.LockCreditAccount(ctx, id)
	if err != nil {
		return fmt.Errorf("lock signup credit account: %w", err)
	}
	return change(ctx, q, &record, "signup_bonus", "permanent", cfg.SignupBonusCredits, "signup:"+id.String(), "user", &id, nil, "")
}
func (s *Service) Initialize(ctx context.Context, q *query.Queries, id, operator uuid.UUID, amount int64, ip netip.Addr) error {
	if amount < 0 || amount > MaxBalance {
		return problem.Invalid()
	}
	record, err := q.LockCreditAccount(ctx, id)
	if err != nil {
		return fmt.Errorf("lock initial credit account: %w", err)
	}
	if err := change(ctx, q, &record, "admin_adjust", "permanent", amount, "initial:"+id.String(), "user_create", &id, &operator, ""); err != nil {
		return err
	}
	if amount == 0 {
		return nil
	}
	return audit.Write(ctx, q, audit.Entry{ActorID: &operator, Action: "credits.initialize", TargetType: "user", TargetID: &id, After: map[string]int64{"permanent_balance": amount}, IP: ip})
}
func (s *Service) Adjust(ctx context.Context, actor user.Actor, target uuid.UUID, key string, input AdjustInput) (Account, error) {
	if input.Bucket == "" {
		input.Bucket = "permanent"
	}
	input.Note = strings.TrimSpace(input.Note)
	if input.Amount < 0 || input.Amount > MaxBalance || (input.Bucket != "daily" && input.Bucket != "permanent") || (input.Action != "add" && input.Action != "subtract" && input.Action != "set") || !validation.Text(input.Note, 1, 200) {
		return Account{}, problem.Invalid()
	}
	var result Account
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		if err := lockUser(ctx, q, target, false); err != nil {
			return err
		}
		var err error
		request := struct {
			UserID uuid.UUID
			Input  AdjustInput
		}{target, input}
		result, err = idempotent(ctx, q, actor.ID, key, "admin_adjust", request, func(operation uuid.UUID) (Account, error) {
			cfg, err := configuration(ctx, q)
			if err != nil {
				return Account{}, err
			}
			record, err := s.account(ctx, q, target, cfg)
			if err != nil {
				return Account{}, err
			}
			before, err := accountView(record, cfg, s.now())
			if err != nil {
				return Account{}, err
			}
			delta := input.Amount
			if input.Action == "subtract" {
				delta = -delta
			}
			if input.Action == "set" {
				balance := record.PermanentBalance
				if input.Bucket == "daily" {
					balance = record.DailyBalance
				}
				delta -= balance
			}
			if err := change(ctx, q, &record, "admin_adjust", input.Bucket, delta, operation.String(), "user", &target, &actor.ID, input.Note); err != nil {
				return Account{}, err
			}
			after, err := accountView(record, cfg, s.now())
			if err != nil {
				return Account{}, err
			}
			err = audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "credits.adjust", TargetType: "user", TargetID: &target, Before: before, After: after, IP: actor.IP})
			return after, err
		})
		return err
	})
	return result, err
}
