package auth

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/password"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
)

type ResetInput struct {
	Token    string `json:"token"`
	Password string `json:"password"`
}
type ResetMailer interface {
	SendReset(context.Context, string, string, string) error
}

// ForgotPassword always accepts unknown accounts to avoid account enumeration.
func (s *Service) ForgotPassword(ctx context.Context, input CodeInput, client Client, baseURL string) error {
	email, err := validation.Email(input.Email)
	if err != nil {
		return err
	}
	if input.Locale != "zh-CN" && input.Locale != "en" && input.Locale != "" {
		return problem.Invalid()
	}
	if err := s.rate(ctx, "forgot-ip", client.IP.String(), 5); err != nil {
		return err
	}
	if err := s.rate(ctx, "forgot-email", email, 1); err != nil {
		return err
	}
	row, err := s.queries.GetUserByEmail(ctx, email)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("find reset account: %w", err)
	}
	if row.Status != "active" {
		return nil
	}
	token, err := NewRefreshToken()
	if err != nil {
		return err
	}
	err = db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		current, err := q.GetUserForUpdate(ctx, row.ID)
		if err != nil {
			return fmt.Errorf("lock reset account: %w", err)
		}
		if current.Status != "active" {
			return nil
		}
		if err := q.InvalidatePasswordResets(ctx, row.ID); err != nil {
			return fmt.Errorf("invalidate reset tokens: %w", err)
		}
		if err := q.CreatePasswordReset(ctx, query.CreatePasswordResetParams{TokenHash: RefreshHash(token), UserID: row.ID, TokenVersion: current.TokenVersion}); err != nil {
			return fmt.Errorf("store reset token: %w", err)
		}
		return nil
	})
	if err != nil {
		return err
	}
	sender, ok := s.mailer.(ResetMailer)
	if !ok {
		return problem.New("SMTP_UNAVAILABLE", 503)
	}
	// The URL fragment never reaches HTTP access logs or referrer headers.
	return sender.SendReset(ctx, email, baseURL+"/reset-password#token="+url.QueryEscape(token), input.Locale)
}
func (s *Service) ResetPassword(ctx context.Context, input ResetInput, client Client) error {
	if len(input.Token) != 43 {
		return problem.New("RESET_INVALID", 400)
	}
	if err := s.rate(ctx, "reset-ip", client.IP.String(), 10); err != nil {
		return err
	}
	if err := password.Validate(input.Password); err != nil {
		return err
	}
	reset, err := s.queries.GetPasswordReset(ctx, RefreshHash(input.Token))
	if errors.Is(err, pgx.ErrNoRows) {
		return problem.New("RESET_INVALID", 400)
	}
	if err != nil {
		return fmt.Errorf("find reset token: %w", err)
	}
	if reset.UsedAt != nil || !reset.ExpiresAt.After(time.Now()) {
		return problem.New("RESET_INVALID", 400)
	}
	hash, err := s.passwords.Hash(ctx, input.Password)
	if err != nil {
		return err
	}
	return db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		row, err := q.GetUserForUpdate(ctx, reset.UserID)
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.New("RESET_INVALID", 400)
		}
		if err != nil {
			return fmt.Errorf("lock password reset: %w", err)
		}
		if row.TokenVersion != reset.TokenVersion || row.Status != "active" {
			return problem.New("RESET_INVALID", 400)
		}
		count, err := q.ConsumePasswordReset(ctx, reset.TokenHash)
		if err != nil {
			return fmt.Errorf("consume reset token: %w", err)
		}
		if count != 1 {
			return problem.New("RESET_INVALID", 400)
		}
		row.PasswordHash = hash
		row.TokenVersion++
		_, err = q.UpdateUser(ctx, query.UpdateUserParams{ID: row.ID, Email: row.Email, Nickname: row.Nickname, Role: row.Role, Status: row.Status, PasswordHash: hash, TokenVersion: row.TokenVersion, Locale: row.Locale, Timezone: row.Timezone})
		if err != nil {
			return fmt.Errorf("reset password: %w", err)
		}
		if err := q.RevokeUserSessions(ctx, row.ID); err != nil {
			return fmt.Errorf("revoke reset sessions: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{ActorID: &row.ID, Action: "auth.password_reset", TargetType: "user", TargetID: &row.ID, IP: client.IP})
	})
}
