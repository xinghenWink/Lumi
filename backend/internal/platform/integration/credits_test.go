//go:build integration

package integration_test

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"net/netip"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xinghenWink/Lumi/backend/internal/auth"
	"github.com/xinghenWink/Lumi/backend/internal/credits"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/settings"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

func creditCode(err error) string {
	var rejected *problem.Error
	if errors.As(err, &rejected) {
		return rejected.Code
	}
	if err != nil {
		return "internal"
	}
	return ""
}
func creditActor(t *testing.T, f *fixture) user.Actor {
	t.Helper()
	record, err := query.New(f.pool).GetUserByEmail(f.ctx, f.adminEmail)
	if err != nil {
		t.Fatal(err)
	}
	return user.Actor{ID: record.ID, TokenVersion: record.TokenVersion, IP: netip.MustParseAddr("127.0.0.1")}
}
func creditMember(t *testing.T, f *fixture, actor user.Actor, amount int64) user.Profile {
	t.Helper()
	value, err := f.services.Users.Create(f.ctx, actor, user.CreateInput{Email: uuid.NewString() + "@lumi.test", Password: "Integration-password-1", Nickname: "Credits", Role: "user", InitialCredits: amount})
	if err != nil {
		t.Fatal(err)
	}
	return value
}
func creditPricing(t *testing.T, f *fixture, actor user.Actor, daily int64) credits.Pricing {
	t.Helper()
	value, err := f.services.Credits.Pricing(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	value.Configuration.DailyFreeCredits = daily
	if _, err := f.services.Credits.SavePricing(f.ctx, actor, value); err != nil {
		t.Fatal(err)
	}
	return value
}
func creditBalance(t *testing.T, f *fixture, id uuid.UUID) credits.Account {
	t.Helper()
	value, err := f.services.Credits.Read(f.ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	return value
}
func TestM7CurrentBalanceReadDoesNotWaitForFinancialWrites(t *testing.T) {
	f := newAccountFixture(t)
	actor := creditActor(t, f)
	creditPricing(t, f, actor, 5)
	member := creditMember(t, f, actor, 10)
	before := creditBalance(t, f, member.ID)
	tx, err := f.pool.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := tx.Rollback(f.ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
			t.Error(err)
		}
	}()
	if _, err := tx.Exec(f.ctx, "UPDATE credit_accounts SET permanent_balance=permanent_balance+7 WHERE user_id=$1", member.ID); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(f.ctx, 500*time.Millisecond)
	defer cancel()
	current, err := f.services.Credits.Read(ctx, member.ID)
	if err != nil {
		t.Fatalf("current balance waited for an unrelated uncommitted write: %v", err)
	}
	if current.PermanentBalance != before.PermanentBalance || current.DailyBalance != 5 || current.Version != before.Version {
		t.Fatalf("balance did not retain the committed snapshot: before=%+v current=%+v", before, current)
	}
	if err := tx.Rollback(f.ctx); err != nil {
		t.Fatal(err)
	}
	after := creditBalance(t, f, member.ID)
	if after.PermanentBalance != before.PermanentBalance || after.Version != before.Version {
		t.Fatal("read-only balance access changed the financial account")
	}
}

func TestM2CreditConsistency(t *testing.T) {
	f := newAccountFixture(t)
	actor := creditActor(t, f)
	t.Run("registration gifts are atomic and zero stays zero", func(t *testing.T) {
		cfg, err := f.services.Settings.Read(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		cfg.Registration.EmailVerificationEnabled = false
		if _, err := f.services.Settings.Save(f.ctx, actor, "registration", settings.Update{Registration: &cfg.Registration}); err != nil {
			t.Fatal(err)
		}
		for _, bonus := range []int64{10, 0} {
			prices := creditPricing(t, f, actor, 5)
			prices.Configuration.SignupBonusCredits = bonus
			if _, err := f.services.Credits.SavePricing(f.ctx, actor, prices); err != nil {
				t.Fatal(err)
			}
			result, err := f.services.Auth.Register(f.ctx, auth.RegisterInput{Email: uuid.NewString() + "@lumi.test", Password: "Integration-password-1", Nickname: "Signup", AcceptTerms: true}, auth.Client{IP: actor.IP})
			if err != nil {
				t.Fatal(err)
			}
			value := creditBalance(t, f, result.User.ID)
			if value.PermanentBalance != bonus || value.DailyBalance != 5 {
				t.Fatalf("signup balances=%+v", value)
			}
			var count int
			if err := f.pool.QueryRow(f.ctx, "SELECT count(*) FROM credit_ledger WHERE user_id=$1 AND type='signup_bonus'", result.User.ID).Scan(&count); err != nil {
				t.Fatal(err)
			}
			want := 0
			if bonus > 0 {
				want = 1
			}
			if count != want {
				t.Fatalf("signup ledger count=%d want=%d", count, want)
			}
		}
	})
	t.Run("pricing changes invalidate cached daily settings immediately", func(t *testing.T) {
		creditPricing(t, f, actor, 0)
		old := creditMember(t, f, actor, 0)
		if balance := creditBalance(t, f, old.ID); balance.DailyBalance != 0 {
			t.Fatal("disabled gift was granted")
		}
		creditPricing(t, f, actor, 5)
		fresh := creditMember(t, f, actor, 0)
		if balance := creditBalance(t, f, fresh.ID); balance.DailyBalance != 5 {
			t.Fatal("cached configuration hid the enabled gift")
		}
		if balance := creditBalance(t, f, old.ID); balance.DailyBalance != 0 {
			t.Fatal("configuration change granted the same day's gift twice")
		}
	})
	t.Run("concurrent charges cannot overdraw", func(t *testing.T) {
		creditPricing(t, f, actor, 0)
		member := creditMember(t, f, actor, 100)
		var success atomic.Int32
		failures := make(chan error, 30)
		var group sync.WaitGroup
		for range 30 {
			group.Go(func() {
				_, err := f.services.Credits.Charge(f.ctx, member.ID, uuid.NewString(), uuid.New(), credits.QuoteInput{Operation: "generate", Quality: "low", Size: "1024x1024", Count: 1})
				if err == nil {
					success.Add(1)
				} else if creditCode(err) != "CREDITS_INSUFFICIENT" {
					failures <- err
				}
			})
		}
		group.Wait()
		close(failures)
		for err := range failures {
			t.Error(err)
		}
		balance := creditBalance(t, f, member.ID)
		if success.Load() != 20 || balance.Total != 0 {
			t.Fatalf("success=%d balance=%+v", success.Load(), balance)
		}
		if _, err := f.pool.Exec(f.ctx, "UPDATE credit_accounts SET permanent_balance=-1 WHERE user_id=$1", member.ID); err == nil {
			t.Fatal("database accepted negative credit balance")
		}
	})
	t.Run("idempotent partial settlement uses the original price", func(t *testing.T) {
		prices := creditPricing(t, f, actor, 5)
		member := creditMember(t, f, actor, 20)
		reference := uuid.New()
		key := uuid.NewString()
		input := credits.QuoteInput{Operation: "generate", Quality: "low", Size: "1024x1024", Count: 2}
		results := make(chan credits.Charge, 12)
		failures := make(chan error, 12)
		var group sync.WaitGroup
		for range 12 {
			group.Go(func() {
				result, err := f.services.Credits.Charge(f.ctx, member.ID, key, reference, input)
				if err != nil {
					failures <- err
				} else {
					results <- result
				}
			})
		}
		group.Wait()
		close(results)
		close(failures)
		for err := range failures {
			t.Error(err)
		}
		var charge credits.Charge
		for result := range results {
			if charge.ID != uuid.Nil && charge.ID != result.ID {
				t.Fatal("replay created another charge")
			}
			charge = result
		}
		if charge.Quote.TotalCost != 10 || charge.DailyCharged != 5 || charge.PermanentCharged != 5 || creditBalance(t, f, member.ID).Total != 15 {
			t.Fatalf("charge=%+v", charge)
		}
		input.Count = 1
		if _, err := f.services.Credits.Charge(f.ctx, member.ID, key, reference, input); creditCode(err) != "IDEMPOTENCY_CONFLICT" {
			t.Fatalf("changed replay error=%v", err)
		}
		for index := range prices.Rules {
			if prices.Rules[index].Operation == "generate" && prices.Rules[index].Quality == "low" {
				prices.Rules[index].CreditsPerImage = 99
			}
		}
		if _, err := f.services.Credits.SavePricing(f.ctx, actor, prices); err != nil {
			t.Fatal(err)
		}
		settlementKey := uuid.NewString()
		settled, err := f.services.Credits.Settle(f.ctx, member.ID, settlementKey, charge.ID, 1)
		if err != nil {
			t.Fatal(err)
		}
		if settled.Refunded != 5 || settled.Account.Total != 20 || settled.Account.DailyBalance != 5 {
			t.Fatalf("settlement=%+v", settled)
		}
		replay, err := f.services.Credits.Settle(f.ctx, member.ID, settlementKey, charge.ID, 1)
		if err != nil || replay.Account.Version != settled.Account.Version {
			t.Fatalf("settlement replay=%+v error=%v", replay, err)
		}
		if _, err := f.services.Credits.Settle(f.ctx, member.ID, uuid.NewString(), charge.ID, 1); creditCode(err) != "CHARGE_ALREADY_SETTLED" {
			t.Fatalf("second settlement=%v", err)
		}
		usage, err := f.services.Credits.Usage(f.ctx, member.ID)
		if err != nil || usage.MonthConsumed != 5 || usage.ImagesByQuality["low"] != 1 {
			t.Fatalf("usage=%+v error=%v", usage, err)
		}
		for index := range prices.Rules {
			if prices.Rules[index].Operation == "generate" && prices.Rules[index].Quality == "low" {
				prices.Rules[index].CreditsPerImage = 5
			}
		}
		if _, err := f.services.Credits.SavePricing(f.ctx, actor, prices); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("lazy read rolls back the reset and both ledger entries together", func(t *testing.T) {
		creditPricing(t, f, actor, 5)
		member := creditMember(t, f, actor, 0)
		stamp := time.Date(2026, 10, 22, 12, 0, 0, 0, time.UTC)
		billing := credits.New(f.pool, f.vault, f.cache, func() time.Time { return stamp })
		before, err := billing.Read(f.ctx, member.ID)
		if err != nil {
			t.Fatal(err)
		}
		stamp = stamp.Add(24 * time.Hour)
		if _, err := f.pool.Exec(f.ctx, "CREATE FUNCTION reject_daily_grant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='daily_grant' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END; $$; CREATE TRIGGER reject_daily_grant BEFORE INSERT ON credit_ledger FOR EACH ROW EXECUTE FUNCTION reject_daily_grant()"); err != nil {
			t.Fatal(err)
		}
		_, readErr := billing.Read(f.ctx, member.ID)
		if _, err := f.pool.Exec(f.ctx, "DROP TRIGGER reject_daily_grant ON credit_ledger; DROP FUNCTION reject_daily_grant()"); err != nil {
			t.Fatal(err)
		}
		row, err := query.New(f.pool).LockCreditAccount(f.ctx, member.ID)
		if readErr == nil || err != nil || row.DailyBalance != before.DailyBalance || row.DailyResetOn.Format(time.DateOnly) != before.DailyResetOn || row.Version != before.Version {
			t.Fatalf("failed grant changed the account: read=%v snapshot=%+v error=%v", readErr, row, err)
		}
		var count int
		if err := f.pool.QueryRow(f.ctx, "SELECT count(*) FROM credit_ledger WHERE user_id=$1", member.ID).Scan(&count); err != nil || count != 1 {
			t.Fatalf("failed grant left a partial ledger: count=%d error=%v", count, err)
		}
		if _, err := billing.Read(f.ctx, member.ID); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("cross-day reset and refund do not restore an expired daily bucket", func(t *testing.T) {
		creditPricing(t, f, actor, 5)
		stamp := time.Date(2026, 10, 22, 15, 59, 59, 0, time.UTC)
		billing := credits.New(f.pool, f.vault, f.cache, func() time.Time { return stamp })
		member := creditMember(t, f, actor, 20)
		charge, err := billing.Charge(f.ctx, member.ID, uuid.NewString(), uuid.New(), credits.QuoteInput{Operation: "generate", Quality: "low", Size: "1024x1024", Count: 2})
		if err != nil {
			t.Fatal(err)
		}
		stamp = stamp.Add(2 * time.Second)
		result, err := billing.Settle(f.ctx, member.ID, uuid.NewString(), charge.ID, 1)
		if err != nil {
			t.Fatal(err)
		}
		if result.Account.PermanentBalance != 20 || result.Account.DailyBalance != 5 || result.Account.DailyResetOn != "2026-10-23" {
			t.Fatalf("cross-day refund=%+v", result)
		}
		var bucket string
		if err := f.pool.QueryRow(f.ctx, "SELECT bucket FROM credit_ledger WHERE user_id=$1 AND type='image_refund'", member.ID).Scan(&bucket); err != nil || bucket != "permanent" {
			t.Fatalf("refund bucket=%s error=%v", bucket, err)
		}
		remaining := creditMember(t, f, actor, 0)
		stamp = time.Date(2026, 10, 23, 15, 59, 59, 0, time.UTC)
		if _, err := billing.Read(f.ctx, remaining.ID); err != nil {
			t.Fatal(err)
		}
		stamp = stamp.Add(2 * time.Second)
		failures := make(chan error, 10)
		var group sync.WaitGroup
		for range 10 {
			group.Go(func() { _, err := billing.Read(f.ctx, remaining.ID); failures <- err })
		}
		group.Wait()
		close(failures)
		for err := range failures {
			if err != nil {
				t.Error(err)
			}
		}
		var grants, expired int64
		if err := f.pool.QueryRow(f.ctx, "SELECT count(*) FILTER (WHERE type='daily_grant'),coalesce(sum(-delta) FILTER (WHERE type='daily_expire'),0) FROM credit_ledger WHERE user_id=$1", remaining.ID).Scan(&grants, &expired); err != nil || grants != 2 || expired != 5 {
			t.Fatalf("grants=%d expired=%d error=%v", grants, expired, err)
		}
	})
	t.Run("precision model overrides disabled rules and free settlement", func(t *testing.T) {
		prices := creditPricing(t, f, actor, 0)
		prices.Configuration.EditMultiplier = "1.10"
		prices.Configuration.SizeMultipliers["1024x1024"] = "1.25"
		model := uuid.New()
		prices.Rules = append(prices.Rules, credits.Rule{ModelID: &model, Operation: "edit", Quality: "medium", CreditsPerImage: 7, Enabled: true})
		if _, err := f.services.Credits.SavePricing(f.ctx, actor, prices); err != nil {
			t.Fatal(err)
		}
		quote, err := f.services.Credits.Quote(f.ctx, credits.QuoteInput{ModelID: &model, Operation: "edit", Quality: "medium", Size: "1024x1024", Count: 3})
		if err != nil || quote.UnitPrice != 10 || quote.TotalCost != 30 {
			t.Fatalf("precise quote=%+v error=%v", quote, err)
		}
		prices.Rules[len(prices.Rules)-1].Enabled = false
		if _, err := f.services.Credits.SavePricing(f.ctx, actor, prices); err != nil {
			t.Fatal(err)
		}
		if _, err := f.services.Credits.Quote(f.ctx, credits.QuoteInput{ModelID: &model, Operation: "edit", Quality: "medium", Size: "1024x1024", Count: 1}); creditCode(err) != "PRICE_UNAVAILABLE" {
			t.Fatalf("disabled override=%v", err)
		}
		prices.Rules = prices.Rules[:6]
		prices.Configuration.EditMultiplier = "1.00"
		prices.Configuration.SizeMultipliers["1024x1024"] = "1.00"
		for index := range prices.Rules {
			if prices.Rules[index].Operation == "generate" && prices.Rules[index].Quality == "high" {
				prices.Rules[index].CreditsPerImage = 0
			}
		}
		if _, err := f.services.Credits.SavePricing(f.ctx, actor, prices); err != nil {
			t.Fatal(err)
		}
		member := creditMember(t, f, actor, 0)
		charge, err := f.services.Credits.Charge(f.ctx, member.ID, uuid.NewString(), uuid.New(), credits.QuoteInput{Operation: "generate", Quality: "high", Size: "1024x1024", Count: 3})
		if err != nil {
			t.Fatal(err)
		}
		settled, err := f.services.Credits.Settle(f.ctx, member.ID, uuid.NewString(), charge.ID, 1)
		if err != nil || settled.Refunded != 0 {
			t.Fatalf("free settlement=%+v error=%v", settled, err)
		}
		usage, err := f.services.Credits.Usage(f.ctx, member.ID)
		if err != nil || usage.ImagesByQuality["high"] != 2 {
			t.Fatalf("free usage=%+v error=%v", usage, err)
		}
	})
	t.Run("administrator adjustment is idempotent audited and protected", func(t *testing.T) {
		creditPricing(t, f, actor, 0)
		member := creditMember(t, f, actor, 20)
		input := credits.AdjustInput{Action: "set", Amount: 7, Note: "Set for support"}
		key := uuid.NewString()
		after, err := f.services.Credits.Adjust(f.ctx, actor, member.ID, key, input)
		if err != nil || after.PermanentBalance != 7 {
			t.Fatalf("set=%+v error=%v", after, err)
		}
		replay, err := f.services.Credits.Adjust(f.ctx, actor, member.ID, key, input)
		if err != nil || replay.Version != after.Version {
			t.Fatal("adjustment replay changed balance")
		}
		input.Action = "subtract"
		input.Amount = 8
		if _, err := f.services.Credits.Adjust(f.ctx, actor, member.ID, uuid.NewString(), input); creditCode(err) != "CREDITS_INSUFFICIENT" {
			t.Fatalf("overdraw=%v", err)
		}
		badActor := user.Actor{ID: member.ID, IP: actor.IP}
		if _, err := f.services.Credits.Adjust(f.ctx, badActor, member.ID, uuid.NewString(), input); creditCode(err) != "FORBIDDEN" {
			t.Fatalf("unauthorized adjustment=%v", err)
		}
		page, err := f.services.Credits.Ledger(f.ctx, credits.LedgerFilter{UserID: &member.ID, Type: "admin_adjust", Limit: 100})
		if err != nil || len(page.Items) != 2 {
			t.Fatalf("adjustment ledger count=%d error=%v", len(page.Items), err)
		}
		for _, statement := range []string{"UPDATE credit_ledger SET note='edited' WHERE user_id=$1", "DELETE FROM credit_ledger WHERE user_id=$1"} {
			if _, err := f.pool.Exec(f.ctx, statement, member.ID); err == nil {
				t.Fatal("ledger history was mutable")
			}
		}
	})
	t.Run("single-use code has one winner and retries do not double grant", func(t *testing.T) {
		batch, err := f.services.Credits.CreateBatch(f.ctx, actor, uuid.NewString(), credits.BatchInput{Name: "Concurrent", Quantity: 1, Credits: 15, MaxUses: 1})
		if err != nil {
			t.Fatal(err)
		}
		page, err := f.services.Credits.Codes(f.ctx, credits.CodeFilter{BatchID: &batch.ID, Limit: 20})
		if err != nil || len(page.Items) != 1 {
			t.Fatal("batch did not create a code")
		}
		code := page.Items[0]
		members := make([]user.Profile, 12)
		for i := range members {
			members[i] = creditMember(t, f, actor, 0)
		}
		type outcome struct {
			owner uuid.UUID
			key   string
			err   error
		}
		results := make(chan outcome, len(members))
		var group sync.WaitGroup
		for _, member := range members {
			group.Go(func() {
				key := uuid.NewString()
				_, err := f.services.Credits.Redeem(f.ctx, member.ID, actor.IP, key, code.Code)
				results <- outcome{member.ID, key, err}
			})
		}
		group.Wait()
		close(results)
		success := 0
		for result := range results {
			if result.err == nil {
				success++
				replay, err := f.services.Credits.Redeem(f.ctx, result.owner, actor.IP, result.key, strings.ToLower(code.Code))
				if err != nil || replay.Credits != 15 {
					t.Fatalf("redeem replay=%+v error=%v", replay, err)
				}
				if value := creditBalance(t, f, result.owner); value.PermanentBalance != 15 {
					t.Fatal("code granted more than once")
				}
			} else if creditCode(result.err) != "REDEEM_USED" {
				t.Error(result.err)
			}
		}
		if success != 1 {
			t.Fatalf("code winners=%d", success)
		}
		if err := f.services.Credits.UpdateCodes(f.ctx, actor, credits.CodeUpdate{IDs: []uuid.UUID{code.ID}}, true); creditCode(err) != "REDEEM_DELETE_USED" {
			t.Fatalf("deleted used code=%v", err)
		}
	})
	t.Run("multi-use codes are once per person and bounded", func(t *testing.T) {
		batch, err := f.services.Credits.CreateBatch(f.ctx, actor, uuid.NewString(), credits.BatchInput{Name: "Shared", Quantity: 1, Credits: 8, MaxUses: 2})
		if err != nil {
			t.Fatal(err)
		}
		codes, err := f.services.Credits.Codes(f.ctx, credits.CodeFilter{BatchID: &batch.ID, Limit: 20})
		if err != nil {
			t.Fatal(err)
		}
		first := creditMember(t, f, actor, 0)
		second := creditMember(t, f, actor, 0)
		third := creditMember(t, f, actor, 0)
		if _, err := f.services.Credits.Redeem(f.ctx, first.ID, actor.IP, uuid.NewString(), codes.Items[0].Code); err != nil {
			t.Fatal(err)
		}
		if _, err := f.services.Credits.Redeem(f.ctx, first.ID, actor.IP, uuid.NewString(), codes.Items[0].Code); creditCode(err) != "REDEEM_ALREADY_USED" {
			t.Fatalf("same person redeemed twice: %v", err)
		}
		if _, err := f.services.Credits.Redeem(f.ctx, second.ID, actor.IP, uuid.NewString(), codes.Items[0].Code); err != nil {
			t.Fatal(err)
		}
		if _, err := f.services.Credits.Redeem(f.ctx, third.ID, actor.IP, uuid.NewString(), codes.Items[0].Code); creditCode(err) != "REDEEM_USED" {
			t.Fatalf("exhausted shared code=%v", err)
		}
	})
	t.Run("invalid expired disabled and overflow codes do not mutate balances", func(t *testing.T) {
		member := creditMember(t, f, actor, credits.MaxBalance)
		batch, err := f.services.Credits.CreateBatch(f.ctx, actor, uuid.NewString(), credits.BatchInput{Name: "States", Quantity: 1, Credits: 10})
		if err != nil {
			t.Fatal(err)
		}
		codes, err := f.services.Credits.Codes(f.ctx, credits.CodeFilter{BatchID: &batch.ID, Limit: 20})
		if err != nil {
			t.Fatal(err)
		}
		code := codes.Items[0]
		if _, err := f.services.Credits.Redeem(f.ctx, member.ID, actor.IP, uuid.NewString(), code.Code); creditCode(err) != "CREDITS_LIMIT" {
			t.Fatalf("overflow code=%v", err)
		}
		if _, err := f.pool.Exec(f.ctx, "UPDATE redeem_codes SET enabled=false WHERE id=$1", code.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.services.Credits.Redeem(f.ctx, member.ID, actor.IP, uuid.NewString(), code.Code); creditCode(err) != "REDEEM_DISABLED" {
			t.Fatalf("disabled code=%v", err)
		}
		if _, err := f.pool.Exec(f.ctx, "UPDATE redeem_codes SET enabled=true,expires_at=now()-interval '1 minute' WHERE id=$1", code.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.services.Credits.Redeem(f.ctx, member.ID, actor.IP, uuid.NewString(), code.Code); creditCode(err) != "REDEEM_EXPIRED" {
			t.Fatalf("expired code=%v", err)
		}
		if _, err := f.services.Credits.Redeem(f.ctx, member.ID, actor.IP, uuid.NewString(), "INVALID"); creditCode(err) != "REDEEM_INVALID" {
			t.Fatalf("invalid code=%v", err)
		}
		var uses int
		if err := f.pool.QueryRow(f.ctx, "SELECT used_count FROM redeem_codes WHERE id=$1", code.ID).Scan(&uses); err != nil || uses != 0 {
			t.Fatal("failed redemption consumed a use")
		}
	})
	t.Run("redemption rate and tenth consecutive failure cooldown", func(t *testing.T) {
		member := creditMember(t, f, actor, 0)
		for range 5 {
			if _, err := f.services.Credits.Redeem(f.ctx, member.ID, actor.IP, uuid.NewString(), "INVALID"); creditCode(err) != "REDEEM_INVALID" {
				t.Fatal(err)
			}
		}
		if _, err := f.services.Credits.Redeem(f.ctx, member.ID, actor.IP, uuid.NewString(), "INVALID"); creditCode(err) != "RATE_LIMITED" {
			t.Fatalf("rate limit=%v", err)
		}
		other := creditMember(t, f, actor, 0)
		for range 9 {
			if err := f.cache.LoginFailed(f.ctx, "redeem:"+other.ID.String(), 10, time.Hour); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := f.services.Credits.Redeem(f.ctx, other.ID, actor.IP, uuid.NewString(), "INVALID"); creditCode(err) != "REDEEM_INVALID" {
			t.Fatal(err)
		}
		_, err := f.services.Credits.Redeem(f.ctx, other.ID, actor.IP, uuid.NewString(), "INVALID")
		var rejected *problem.Error
		if !errors.As(err, &rejected) || rejected.Code != "REDEEM_COOLDOWN" || rejected.RetryAfter < 3500 {
			t.Fatalf("cooldown=%v", err)
		}
	})
	t.Run("account erasure preserves append-only financial history", func(t *testing.T) {
		member := creditMember(t, f, actor, 12)
		creditBalance(t, f, member.ID)
		var before int
		if err := f.pool.QueryRow(f.ctx, "SELECT count(*) FROM credit_ledger WHERE user_id=$1", member.ID).Scan(&before); err != nil {
			t.Fatal(err)
		}
		if err := f.services.Users.Delete(f.ctx, actor, member.ID, member.Email); err != nil {
			t.Fatal(err)
		}
		if _, err := f.pool.Exec(f.ctx, "UPDATE users SET deleted_at=now()-interval '31 days' WHERE id=$1", member.ID); err != nil {
			t.Fatal(err)
		}
		if count, err := f.services.Users.PurgeDeleted(f.ctx, 100); err != nil || count != 1 {
			t.Fatalf("purge=%d error=%v", count, err)
		}
		var after, accounts int
		if err := f.pool.QueryRow(f.ctx, "SELECT (SELECT count(*) FROM credit_ledger WHERE user_id=$1),(SELECT count(*) FROM credit_accounts WHERE user_id=$1)", member.ID).Scan(&after, &accounts); err != nil || after != before || accounts != 0 {
			t.Fatalf("history before=%d after=%d accounts=%d error=%v", before, after, accounts, err)
		}
	})
	t.Run("audit failure rolls back adjustments initial credits and batches", func(t *testing.T) {
		member := creditMember(t, f, actor, 10)
		before := creditBalance(t, f, member.ID)
		if _, err := f.pool.Exec(f.ctx, "CREATE FUNCTION lumi.test_credit_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END; $$; CREATE TRIGGER test_credit_reject_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION lumi.test_credit_reject_audit();"); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if _, err := f.pool.Exec(f.ctx, "DROP TRIGGER test_credit_reject_audit ON audit_logs; DROP FUNCTION lumi.test_credit_reject_audit();"); err != nil {
				t.Error(err)
			}
		})
		if _, err := f.services.Credits.Adjust(f.ctx, actor, member.ID, uuid.NewString(), credits.AdjustInput{Action: "add", Amount: 7, Note: "Must roll back"}); err == nil {
			t.Fatal("adjustment ignored audit failure")
		}
		if after := creditBalance(t, f, member.ID); after.Total != before.Total {
			t.Fatal("balance survived audit failure")
		}
		if _, err := f.services.Credits.CreateBatch(f.ctx, actor, uuid.NewString(), credits.BatchInput{Name: "Rollback", Quantity: 10, Credits: 1}); err == nil {
			t.Fatal("batch ignored audit failure")
		}
		var batches int
		if err := f.pool.QueryRow(f.ctx, "SELECT count(*) FROM redeem_batches WHERE name='Rollback'").Scan(&batches); err != nil || batches != 0 {
			t.Fatal("batch survived audit failure")
		}
		_, err := f.services.Users.Create(f.ctx, actor, user.CreateInput{Email: "credit-rollback@lumi.test", Password: "Integration-password-1", Nickname: "Rollback", Role: "user", InitialCredits: 50})
		if err == nil {
			t.Fatal("initial credits ignored audit failure")
		}
	})
	t.Run("HTTP isolation required idempotency exports and balance filters", func(t *testing.T) {
		client := f.client(t)
		admin := f.login(t, client, f.adminEmail, f.adminPassword)
		member := creditMember(t, f, actor, 30)
		userClient := f.client(t)
		normal := f.login(t, userClient, member.Email, "Integration-password-1")
		denied := f.call(t, userClient, "GET", "/api/v1/admin/credit-ledger", normal.AccessToken, nil)
		expectStatus(t, denied, 403)
		absent := f.call(t, userClient, "POST", "/api/v1/me/redeem", normal.AccessToken, map[string]string{"code": "INVALID"})
		expectStatus(t, absent, 400)
		mine := f.call(t, userClient, "GET", "/api/v1/me/credits/ledger?user_id="+actor.ID.String(), normal.AccessToken, nil)
		expectStatus(t, mine, 200)
		for _, row := range decodeReply[credits.LedgerPage](t, mine).Items {
			if row.UserID != member.ID {
				t.Fatal("own ledger leaked another account")
			}
		}
		result := f.call(t, client, "POST", "/api/v1/admin/redeem-batches", admin.AccessToken, credits.BatchInput{Name: "CSV", Quantity: 100, Credits: 5, Prefix: "LUMI"}, uuid.NewString())
		expectStatus(t, result, 201)
		batch := decodeReply[credits.Batch](t, result)
		exported := f.call(t, client, "GET", "/api/v1/admin/redeem-codes/export?batch_id="+batch.ID.String(), admin.AccessToken, nil)
		expectStatus(t, exported, 200)
		rows, err := csv.NewReader(strings.NewReader(string(exported.body))).ReadAll()
		if err != nil || len(rows) != 101 {
			t.Fatalf("CSV rows=%d error=%v", len(rows), err)
		}
		filtered := f.call(t, client, "GET", fmt.Sprintf("/api/v1/admin/users?search=%s&min_balance=30&max_balance=40&sort=balance&limit=1", member.ID), admin.AccessToken, nil)
		expectStatus(t, filtered, 200)
		users := decodeReply[user.Page](t, filtered)
		if len(users.Items) != 1 || users.Items[0].TotalCredits == nil || *users.Items[0].TotalCredits != 30 {
			t.Fatalf("balance filtered users=%+v", users)
		}
	})
}
