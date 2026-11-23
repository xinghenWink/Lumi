package credits

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

const referralCodeBytes = 8

func (s *Service) Referral(ctx context.Context, owner uuid.UUID) (Referral, error) {
	return readReferral(ctx, s.queries, owner)
}

func readReferral(ctx context.Context, q *query.Queries, owner uuid.UUID) (Referral, error) {
	cfg, err := configuration(ctx, q)
	if err != nil {
		return Referral{}, err
	}
	code, err := q.GetReferralCode(ctx, owner)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Referral{}, fmt.Errorf("read referral code: %w", err)
	}
	return Referral{InviteCode: code, InviterBonusCredits: *cfg.ReferralInviterBonusCredits, InviteeBonusCredits: *cfg.ReferralInviteeBonusCredits}, nil
}

func (s *Service) GenerateReferral(ctx context.Context, actor user.Actor) (Referral, error) {
	var result Referral
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		// Lock the owner to serialize issuance and account status changes.
		owner, err := q.GetUserForUpdate(ctx, actor.ID)
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.Unauthorized()
		}
		if err != nil {
			return fmt.Errorf("lock referral code owner: %w", err)
		}
		if owner.Status != "active" || owner.TokenVersion != actor.TokenVersion {
			return problem.Unauthorized()
		}
		result, err = readReferral(ctx, q, actor.ID)
		if err != nil || result.InviteCode != "" {
			return err
		}
		for range 3 {
			var raw [referralCodeBytes]byte
			if _, err := rand.Read(raw[:]); err != nil {
				return fmt.Errorf("generate referral code: %w", err)
			}
			code := strings.ToUpper(hex.EncodeToString(raw[:]))
			result.InviteCode, err = q.CreateReferralCode(ctx, query.CreateReferralCodeParams{UserID: actor.ID, Code: code})
			if !errors.Is(err, pgx.ErrNoRows) {
				if err != nil {
					return fmt.Errorf("store referral code: %w", err)
				}
				return nil
			}
		}
		return errors.New("could not allocate a unique referral code")
	})
	return result, err
}

func (s *Service) rewardReferral(ctx context.Context, q *query.Queries, invitee *query.CreditAccount, cfg Configuration, code string) error {
	if len(code) != 2*referralCodeBytes {
		return problem.New("REFERRAL_CODE_INVALID", http.StatusBadRequest)
	}
	if _, err := hex.DecodeString(code); err != nil {
		return problem.New("REFERRAL_CODE_INVALID", http.StatusBadRequest)
	}
	inviter, err := q.LockReferralInviter(ctx, code)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && inviter == invitee.UserID) {
		return problem.New("REFERRAL_CODE_INVALID", http.StatusBadRequest)
	}
	if err != nil {
		return fmt.Errorf("lock referral inviter: %w", err)
	}
	id, err := validation.NewID()
	if err != nil {
		return err
	}
	inviterCredits, inviteeCredits := *cfg.ReferralInviterBonusCredits, *cfg.ReferralInviteeBonusCredits
	if err := q.CreateRegistrationReferral(ctx, query.CreateRegistrationReferralParams{ID: id, InviteeID: invitee.UserID, InviterID: inviter, InviterCredits: inviterCredits, InviteeCredits: inviteeCredits}); err != nil {
		return fmt.Errorf("record registration referral: %w", err)
	}
	key := "referral:" + invitee.UserID.String()
	if err := grantReferral(ctx, q, invitee, "referral_invitee_bonus", inviteeCredits, key+":invitee", id); err != nil {
		return err
	}
	if inviterCredits == 0 {
		return nil
	}
	owner, err := s.account(ctx, q, inviter, cfg)
	if err != nil {
		return err
	}
	return grantReferral(ctx, q, &owner, "referral_inviter_bonus", inviterCredits, key+":inviter", id)
}

func grantReferral(ctx context.Context, q *query.Queries, account *query.CreditAccount, kind string, amount int64, key string, id uuid.UUID) error {
	if amount > MaxBalance-account.PermanentBalance {
		return problem.New("REFERRAL_REWARD_LIMIT", http.StatusConflict)
	}
	return change(ctx, q, account, kind, "permanent", amount, key, "registration_referral", &id, nil, "")
}
