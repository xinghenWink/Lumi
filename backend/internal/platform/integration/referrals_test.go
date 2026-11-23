//go:build integration

package integration_test

import (
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/auth"
	"github.com/xinghenWink/Lumi/backend/internal/credits"
	"github.com/xinghenWink/Lumi/backend/internal/settings"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

func TestRegistrationReferrals(t *testing.T) {
	f := newAccountFixture(t)
	f.services.PublicBaseURL = "https://lumi.test/"
	actor := creditActor(t, f)
	inviter := creditMember(t, f, actor, 20)
	adminClient, memberClient := f.client(t), f.client(t)
	admin := f.login(t, adminClient, f.adminEmail, f.adminPassword)
	member := f.login(t, memberClient, inviter.Email, "Integration-password-1")
	const referralPath = "/api/v1/me/referral"
	const pricingPath = "/api/v1/admin/pricing"
	type referralView struct {
		credits.Referral
		InviteURL string `json:"invite_url"`
	}

	read := func(t *testing.T, method string) referralView {
		t.Helper()
		response := f.call(t, memberClient, method, referralPath, member.AccessToken, nil)
		expectStatus(t, response, http.StatusOK)
		return decodeReply[referralView](t, response)
	}
	setRewards := func(t *testing.T, inviterBonus, inviteeBonus int64) {
		t.Helper()
		pricing, err := f.services.Credits.Pricing(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		pricing.Configuration.ReferralInviterBonusCredits = &inviterBonus
		pricing.Configuration.ReferralInviteeBonusCredits = &inviteeBonus
		pricing.Configuration.SignupBonusCredits = 10
		response := f.call(t, adminClient, http.MethodPut, pricingPath, admin.AccessToken, pricing)
		expectStatus(t, response, http.StatusOK)
	}
	setVerification := func(t *testing.T, enabled bool) {
		t.Helper()
		cfg, err := f.services.Settings.Read(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		cfg.Registration.EmailVerificationEnabled = enabled
		if _, err := f.services.Settings.Save(f.ctx, actor, "registration", settings.Update{Registration: &cfg.Registration}); err != nil {
			t.Fatal(err)
		}
	}
	input := func(code string) auth.RegisterInput {
		return auth.RegisterInput{Email: uuid.NewString() + "@lumi.test", Password: "Integration-password-1", Nickname: "Referred", AcceptTerms: true, InviteCode: code}
	}
	register := func(t *testing.T, value auth.RegisterInput, ip string) auth.Result {
		t.Helper()
		result, err := f.services.Auth.Register(f.ctx, value, auth.Client{IP: netip.MustParseAddr(ip)})
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	ledger := func(t *testing.T, owner uuid.UUID, kind string, count int) []credits.LedgerRecord {
		t.Helper()
		page, err := f.services.Credits.Ledger(f.ctx, credits.LedgerFilter{UserID: &owner, Type: kind, Limit: 20})
		if err != nil || len(page.Items) != count {
			t.Fatalf("%s ledger: got %d entries, want %d (%v)", kind, len(page.Items), count, err)
		}
		return page.Items
	}

	expectStatus(t, f.call(t, f.client(t), http.MethodGet, referralPath, "", nil), http.StatusUnauthorized)
	if result := read(t, http.MethodGet); result != (referralView{}) {
		t.Fatalf("unexpected initial referral: %+v", result)
	}
	const attempts = 6
	var wg sync.WaitGroup
	codes := make(chan string, attempts)
	for range attempts {
		wg.Go(func() {
			result, err := f.services.Credits.GenerateReferral(f.ctx, user.Actor{ID: inviter.ID, IP: actor.IP})
			if err != nil {
				t.Error(err)
			}
			codes <- result.InviteCode
		})
	}
	wg.Wait()
	close(codes)
	code := read(t, http.MethodPut).InviteCode
	if len(code) != 16 || read(t, http.MethodGet).InviteURL != "https://lumi.test/register?invite_code="+code {
		t.Fatalf("invalid invite code or URL: %q", code)
	}
	for result := range codes {
		if result != code {
			t.Fatalf("concurrent generation returned %q instead of %q", result, code)
		}
	}

	t.Run("old pricing requests preserve configured rewards", func(t *testing.T) {
		setRewards(t, 7, 3)
		pricing, err := f.services.Credits.Pricing(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		pricing.Configuration.ReferralInviterBonusCredits = nil
		pricing.Configuration.ReferralInviteeBonusCredits = nil
		expectStatus(t, f.call(t, adminClient, http.MethodPut, pricingPath, admin.AccessToken, pricing), http.StatusOK)
		if result := read(t, http.MethodGet); result.InviterBonusCredits != 7 || result.InviteeBonusCredits != 3 {
			t.Fatalf("saved amounts were reset: %+v", result)
		}
		invalid := int64(-1)
		pricing.Configuration.ReferralInviterBonusCredits = &invalid
		expectStatus(t, f.call(t, adminClient, http.MethodPut, pricingPath, admin.AccessToken, pricing), http.StatusBadRequest)
	})

	t.Run("concurrent registrations and duplicate email award exactly once", func(t *testing.T) {
		setVerification(t, false)
		var results [3]auth.Result
		var failures [3]error
		first := input("  " + strings.ToLower(code) + " ")
		for index, value := range []auth.RegisterInput{first, first, input(code)} {
			wg.Go(func() {
				results[index], failures[index] = f.services.Auth.Register(f.ctx, value, auth.Client{IP: netip.MustParseAddr("198.51.100.11")})
			})
		}
		wg.Wait()
		duplicates := 0
		for index, result := range results {
			if failures[index] != nil {
				if creditCode(failures[index]) != "EMAIL_ALREADY_EXISTS" {
					t.Fatal(failures[index])
				}
				duplicates++
				continue
			}
			if balance := creditBalance(t, f, result.User.ID).PermanentBalance; balance != 13 {
				t.Fatalf("invitee permanent balance: %d", balance)
			}
			entry := ledger(t, result.User.ID, "referral_invitee_bonus", 1)[0]
			if entry.Bucket != "permanent" || entry.Delta != 3 || entry.RefID == nil {
				t.Fatalf("unexpected invitee ledger entry: %+v", entry)
			}
		}
		entries := ledger(t, inviter.ID, "referral_inviter_bonus", 2)
		if duplicates != 1 || creditBalance(t, f, inviter.ID).PermanentBalance != 34 || entries[0].Delta != 7 || entries[1].Delta != 7 {
			t.Fatalf("incorrect inviter awards: duplicates=%d, entries=%+v", duplicates, entries)
		}
		export := f.call(t, adminClient, http.MethodGet, "/api/v1/admin/credit-ledger/export?type=referral_inviter_bonus", admin.AccessToken, nil)
		expectStatus(t, export, http.StatusOK)
		if !strings.Contains(string(export.body), "邀请好友奖励") || strings.Contains(string(export.body), "受邀注册奖励") {
			t.Fatal("CSV did not filter and translate the referral ledger")
		}
	})

	t.Run("invalid code leaves email verification usable", func(t *testing.T) {
		setVerification(t, true)
		client := f.client(t)
		value := input("INVALID")
		expectStatus(t, f.call(t, client, http.MethodPost, "/api/v1/auth/send-code", "", auth.CodeInput{Email: value.Email, Locale: "en"}), http.StatusOK)
		value.Code = f.sender.code(value.Email)
		response := f.call(t, client, http.MethodPost, "/api/v1/auth/register", "", value)
		expectStatus(t, response, http.StatusBadRequest)
		if !strings.Contains(string(response.body), "REFERRAL_CODE_INVALID") {
			t.Fatal("invalid referral did not return a field error")
		}
		value.InviteCode = code
		expectStatus(t, f.call(t, client, http.MethodPost, "/api/v1/auth/register", "", value), http.StatusCreated)
		setVerification(t, false)
	})

	t.Run("zero amounts keep attribution without zero ledger movements", func(t *testing.T) {
		for _, amounts := range [][2]int64{{0, 0}, {2, 0}, {0, 4}} {
			setRewards(t, amounts[0], amounts[1])
			result := register(t, input(code), "198.51.100.12")
			var inviterID uuid.UUID
			var granted [2]int64
			err := f.pool.QueryRow(f.ctx, "SELECT inviter_id, inviter_credits, invitee_credits FROM registration_referrals WHERE invitee_id=$1", result.User.ID).Scan(&inviterID, &granted[0], &granted[1])
			if err != nil || inviterID != inviter.ID || granted != amounts {
				t.Fatalf("referral attribution: %v, %v", granted, err)
			}
			count := 0
			if amounts[1] > 0 {
				count = 1
			}
			ledger(t, result.User.ID, "referral_invitee_bonus", count)
			if balance := creditBalance(t, f, result.User.ID).PermanentBalance; balance != 10+amounts[1] {
				t.Fatalf("invitee permanent balance: %d", balance)
			}
		}
		ledger(t, inviter.ID, "referral_inviter_bonus", 4)
	})

	t.Run("overflow rolls back rewards and permits an ordinary signup", func(t *testing.T) {
		setRewards(t, 7, 3)
		if _, err := f.pool.Exec(f.ctx, "UPDATE credit_accounts SET permanent_balance=$1 WHERE user_id=$2", credits.MaxBalance, inviter.ID); err != nil {
			t.Fatal(err)
		}
		value := input(code)
		client := auth.Client{IP: netip.MustParseAddr("198.51.100.13")}
		if _, err := f.services.Auth.Register(f.ctx, value, client); creditCode(err) != "REFERRAL_REWARD_LIMIT" {
			t.Fatalf("unexpected balance-limit error: %v", err)
		}
		value.InviteCode = ""
		result := register(t, value, client.IP.String())
		if balance := creditBalance(t, f, result.User.ID).PermanentBalance; balance != 10 {
			t.Fatalf("ordinary signup permanent balance: %d", balance)
		}
		ledger(t, inviter.ID, "referral_inviter_bonus", 4)
		var count int
		if err := f.pool.QueryRow(f.ctx, "SELECT count(*) FROM registration_referrals WHERE inviter_id=$1", inviter.ID).Scan(&count); err != nil || count != 6 {
			t.Fatalf("referral count after rollback: %d (%v)", count, err)
		}
	})

	t.Run("disabled and deleted inviters cannot refer", func(t *testing.T) {
		status := "disabled"
		if _, err := f.services.Users.Update(f.ctx, actor, inviter.ID, user.UpdateInput{Status: &status}); err != nil {
			t.Fatal(err)
		}
		client := auth.Client{IP: netip.MustParseAddr("198.51.100.14")}
		if _, err := f.services.Auth.Register(f.ctx, input(code), client); creditCode(err) != "REFERRAL_CODE_INVALID" {
			t.Fatalf("disabled inviter: %v", err)
		}
		if err := f.services.Users.Delete(f.ctx, actor, inviter.ID, inviter.Email); err != nil {
			t.Fatal(err)
		}
		if _, err := f.services.Auth.Register(f.ctx, input(code), client); creditCode(err) != "REFERRAL_CODE_INVALID" {
			t.Fatalf("deleted inviter: %v", err)
		}
	})
}
