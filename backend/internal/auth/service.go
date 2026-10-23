package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/netip"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/password"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/settings"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

type Settings interface {
	Read(context.Context) (settings.Snapshot, error)
}
type Gate interface {
	Allow(context.Context, string, string, int, time.Duration) (bool, int, error)
	LoginLocked(context.Context, string) (bool, int, error)
	LoginFailed(context.Context, string, int, time.Duration) error
	LoginSucceeded(context.Context, string) error
	Cooldown(context.Context, string) (bool, error)
	ClearCooldown(context.Context, string) error
}
type Mailer interface {
	SendCode(context.Context, string, string, string) error
}
type Client struct {
	IP        netip.Addr
	UserAgent string
}
type Service struct {
	pool      *pgxpool.Pool
	queries   *query.Queries
	passwords *password.Hasher
	tokens    *Tokens
	settings  Settings
	gate      Gate
	mailer    Mailer
	credits   SignupCredits
}

type SignupCredits interface {
	Signup(context.Context, *query.Queries, uuid.UUID) error
}

func New(pool *pgxpool.Pool, passwords *password.Hasher, tokens *Tokens, settings Settings, gate Gate, mailer Mailer, credits SignupCredits) *Service {
	return &Service{pool: pool, queries: query.New(pool), passwords: passwords, tokens: tokens, settings: settings, gate: gate, mailer: mailer, credits: credits}
}

type Result struct {
	AccessToken    string       `json:"access_token"`
	TokenType      string       `json:"token_type"`
	ExpiresIn      int          `json:"expires_in"`
	User           user.Profile `json:"user"`
	RefreshToken   string       `json:"-"`
	RefreshExpires time.Time    `json:"-"`
}
type RegisterInput struct {
	TurnstileToken string `json:"turnstile_token"`
	Email          string `json:"email"`
	Password       string `json:"password"`
	Nickname       string `json:"nickname"`
	Code           string `json:"code"`
	AcceptTerms    bool   `json:"accept_terms"`
}
type LoginInput struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}
type CodeInput struct {
	TurnstileToken string `json:"turnstile_token"`
	Email          string `json:"email"`
	Locale         string `json:"locale"`
}
type Principal struct {
	User     user.Profile
	Actor    user.Actor
	FamilyID uuid.UUID
}

func (s *Service) Authenticate(ctx context.Context, encoded string, ip netip.Addr) (Principal, error) {
	claims, err := s.tokens.Parse(encoded)
	if err != nil {
		return Principal{}, err
	}
	id, err := uuid.Parse(claims.Subject)
	if err != nil {
		return Principal{}, problem.Unauthorized()
	}
	family, err := uuid.Parse(claims.FamilyID)
	if err != nil {
		return Principal{}, problem.Unauthorized()
	}
	record, err := s.queries.GetAuthenticatedUser(ctx, query.GetAuthenticatedUserParams{ID: id, TokenVersion: claims.Version, FamilyID: family})
	if errors.Is(err, pgx.ErrNoRows) {
		return Principal{}, problem.Unauthorized()
	}
	if err != nil {
		return Principal{}, fmt.Errorf("authenticate session: %w", err)
	}
	return Principal{User: user.View(record), Actor: user.Actor{ID: id, TokenVersion: claims.Version, IP: ip}, FamilyID: family}, nil
}

func (s *Service) SendCode(ctx context.Context, input CodeInput, client Client) error {
	email, err := validation.Email(input.Email)
	if err != nil {
		return err
	}
	if input.Locale == "" {
		input.Locale = "zh-CN"
	}
	if input.Locale != "zh-CN" && input.Locale != "en" {
		return problem.Invalid()
	}
	cfg, err := s.settings.Read(ctx)
	if err != nil {
		return err
	}
	if err := registrationAllowed(cfg.Registration, email); err != nil {
		return err
	}
	if !cfg.Registration.EmailVerificationEnabled {
		return problem.New("VERIFICATION_NOT_REQUIRED", http.StatusBadRequest)
	}
	if err := ValidateTurnstile(ctx, nil, cfg.Operations, input.TurnstileToken, "send_code", client.IP.String()); err != nil {
		return err
	}
	if err := s.rate(ctx, "send-code-ip", client.IP.String(), cfg.Registration.CodePerMinute); err != nil {
		return err
	}
	if err := s.rate(ctx, "send-code-email", email, cfg.Registration.CodePerMinute); err != nil {
		return err
	}
	reserved, err := s.gate.Cooldown(ctx, email)
	if err != nil {
		return err
	}
	if !reserved {
		return problem.Retry("RATE_LIMITED", 60)
	}
	number, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return fmt.Errorf("generate verification code: %w", err)
	}
	code := fmt.Sprintf("%06d", number.Int64())
	digest, err := s.tokens.CodeHash(email, code)
	if err != nil {
		return err
	}
	id, err := validation.NewID()
	if err != nil {
		return err
	}
	err = db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := q.LockRegistration(ctx, email); err != nil {
			return fmt.Errorf("lock verification target: %w", err)
		}
		if err := q.InvalidateVerificationCodes(ctx, email); err != nil {
			return fmt.Errorf("expire previous verification: %w", err)
		}
		if err := q.CreateVerificationCode(ctx, query.CreateVerificationCodeParams{ID: id, Target: email, CodeHash: digest, ExpiresAt: time.Now().UTC().Add(10 * time.Minute)}); err != nil {
			return fmt.Errorf("store verification code: %w", err)
		}
		return nil
	})
	if err == nil {
		err = s.mailer.SendCode(ctx, email, code, input.Locale)
	}
	if err != nil {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), time.Second)
		defer cancel()
		if clearErr := s.gate.ClearCooldown(cleanup, email); clearErr != nil {
			return fmt.Errorf("clear failed verification cooldown: %w", clearErr)
		}
		return fmt.Errorf("send verification: %w", err)
	}
	return nil
}

func (s *Service) Register(ctx context.Context, input RegisterInput, client Client) (Result, error) {
	email, err := validation.Email(input.Email)
	if err != nil {
		return Result{}, err
	}
	input.Nickname = strings.TrimSpace(input.Nickname)
	if !input.AcceptTerms || !validation.Text(input.Nickname, 1, 30) {
		return Result{}, problem.Invalid()
	}
	if err := password.Validate(input.Password); err != nil {
		return Result{}, err
	}
	cfg, err := s.settings.Read(ctx)
	if err != nil {
		return Result{}, err
	}
	if err := registrationAllowed(cfg.Registration, email); err != nil {
		return Result{}, err
	}
	if err := s.rate(ctx, "register", client.IP.String(), cfg.Registration.RegisterPerMinute); err != nil {
		return Result{}, err
	}
	if err := ValidateTurnstile(ctx, nil, cfg.Operations, input.TurnstileToken, "register", client.IP.String()); err != nil {
		return Result{}, err
	}
	hash, err := s.passwords.Hash(ctx, input.Password)
	if err != nil {
		return Result{}, err
	}
	id, err := validation.NewID()
	if err != nil {
		return Result{}, err
	}
	var result Result
	var rejected error
	err = db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := q.LockRegistration(ctx, email); err != nil {
			return fmt.Errorf("lock registration: %w", err)
		}
		if cfg.Operations.RegisterPerIPDay > 0 {
			allowed, retry, err := s.gate.Allow(ctx, "register-ip-day", client.IP.String(), cfg.Operations.RegisterPerIPDay, 24*time.Hour)
			if err != nil {
				return err
			}
			if !allowed {
				return problem.Retry("REGISTRATION_IP_LIMIT", retry)
			}
		}
		if cfg.Registration.EmailVerificationEnabled {
			verification, err := q.GetVerificationForUpdate(ctx, email)
			if errors.Is(err, pgx.ErrNoRows) {
				rejected = problem.New("VERIFICATION_INVALID", http.StatusBadRequest)
				return nil
			}
			if err != nil {
				return fmt.Errorf("read verification: %w", err)
			}
			if verification.Attempts >= 5 || !verification.ExpiresAt.After(time.Now()) {
				rejected = problem.New("VERIFICATION_INVALID", http.StatusBadRequest)
				return nil
			}
			digest, err := s.tokens.CodeHash(email, input.Code)
			if err != nil {
				return err
			}
			if len(input.Code) != 6 || !hmac.Equal(digest, verification.CodeHash) {
				if err := q.FailVerification(ctx, verification.ID); err != nil {
					return fmt.Errorf("record verification failure: %w", err)
				}
				rejected = problem.New("VERIFICATION_INVALID", http.StatusBadRequest)
				return nil
			}
			if err := q.ConsumeVerification(ctx, verification.ID); err != nil {
				return fmt.Errorf("consume verification: %w", err)
			}
		}
		now := time.Now().UTC()
		record, err := q.CreateUser(ctx, query.CreateUserParams{ID: id, Email: email, PasswordHash: hash, Nickname: input.Nickname, Role: "user", Status: "active", TermsAcceptedAt: &now})
		if err != nil {
			return user.DatabaseError("register user", err)
		}
		if err := s.credits.Signup(ctx, q, id); err != nil {
			return err
		}
		if err := q.UpdateLogin(ctx, query.UpdateLoginParams{ID: id, LastLoginIp: &client.IP}); err != nil {
			return fmt.Errorf("record registration login: %w", err)
		}
		record.LastLoginAt = &now
		record.LastLoginIp = &client.IP
		result, err = s.newSession(ctx, q, record, uuid.Nil, nil, client)
		if err != nil {
			return err
		}
		return audit.Write(ctx, q, audit.Entry{ActorID: &id, Action: "auth.register", TargetType: "user", TargetID: &id, After: audit.UserSnapshot(record), IP: client.IP})
	})
	if err != nil {
		return Result{}, err
	}
	if rejected != nil {
		return Result{}, rejected
	}
	return result, nil
}

func (s *Service) Login(ctx context.Context, input LoginInput, client Client) (Result, error) {
	cfg, err := s.settings.Read(ctx)
	if err != nil {
		return Result{}, err
	}
	if err := s.rate(ctx, "login", client.IP.String(), cfg.Registration.LoginPerMinute); err != nil {
		return Result{}, err
	}
	email, err := validation.Email(input.Email)
	if err != nil || len(input.Password) > 512 {
		return Result{}, problem.New("AUTH_INVALID_CREDENTIALS", http.StatusUnauthorized)
	}
	identity := email + "\x00" + client.IP.String()
	locked, retry, err := s.gate.LoginLocked(ctx, identity)
	if err != nil {
		return Result{}, err
	}
	if locked {
		return Result{}, problem.Retry("LOGIN_LOCKED", retry)
	}
	record, err := s.queries.GetUserByEmail(ctx, email)
	if errors.Is(err, pgx.ErrNoRows) {
		if err := s.passwords.Dummy(ctx, input.Password); err != nil {
			return Result{}, err
		}
		return Result{}, s.failedLogin(ctx, identity, cfg.Registration)
	}
	if err != nil {
		return Result{}, fmt.Errorf("find login user: %w", err)
	}
	valid, err := s.passwords.Verify(ctx, record.PasswordHash, input.Password)
	if err != nil {
		return Result{}, err
	}
	if !valid {
		return Result{}, s.failedLogin(ctx, identity, cfg.Registration)
	}
	if record.Status != "active" {
		return Result{}, problem.New("ACCOUNT_DISABLED", http.StatusForbidden)
	}
	if err := s.gate.LoginSucceeded(ctx, identity); err != nil {
		return Result{}, err
	}
	var result Result
	err = db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		current, err := q.GetUserForUpdate(ctx, record.ID)
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.Unauthorized()
		}
		if err != nil {
			return fmt.Errorf("lock login user: %w", err)
		}
		if current.Status != "active" || current.TokenVersion != record.TokenVersion || current.PasswordHash != record.PasswordHash {
			return problem.Unauthorized()
		}
		if err := q.UpdateLogin(ctx, query.UpdateLoginParams{ID: record.ID, LastLoginIp: &client.IP}); err != nil {
			return fmt.Errorf("record login: %w", err)
		}
		now := time.Now().UTC()
		current.LastLoginAt = &now
		current.LastLoginIp = &client.IP
		result, err = s.newSession(ctx, q, current, uuid.Nil, nil, client)
		if err != nil {
			return err
		}
		return audit.Write(ctx, q, audit.Entry{ActorID: &record.ID, Action: "auth.login", TargetType: "user", TargetID: &record.ID, IP: client.IP})
	})
	return result, err
}

func (s *Service) Refresh(ctx context.Context, value string, client Client) (Result, error) {
	if err := s.rate(ctx, "refresh", client.IP.String(), 60); err != nil {
		return Result{}, err
	}
	if len(value) != 43 {
		return Result{}, problem.Unauthorized()
	}
	original, err := s.queries.GetSessionByHash(ctx, RefreshHash(value))
	if errors.Is(err, pgx.ErrNoRows) {
		return Result{}, problem.Unauthorized()
	}
	if err != nil {
		return Result{}, fmt.Errorf("find refresh session: %w", err)
	}
	var result Result
	var rejected error
	err = db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		// Always lock the user first, matching admin revocation and password changes.
		record, err := q.GetUserForUpdate(ctx, original.UserID)
		if errors.Is(err, pgx.ErrNoRows) {
			rejected = problem.Unauthorized()
			return nil
		}
		if err != nil {
			return fmt.Errorf("lock refresh user: %w", err)
		}
		session, err := q.GetSessionByHashForUpdate(ctx, RefreshHash(value))
		if err != nil {
			return fmt.Errorf("lock refresh session: %w", err)
		}
		if session.RevokedAt != nil || !session.ExpiresAt.After(time.Now()) || record.Status != "active" {
			if err := q.RevokeFamily(ctx, session.FamilyID); err != nil {
				return fmt.Errorf("revoke replayed session family: %w", err)
			}
			if session.RevokedAt != nil {
				if err := audit.Write(ctx, q, audit.Entry{ActorID: &record.ID, Action: "auth.refresh_replay", TargetType: "user", TargetID: &record.ID, IP: client.IP}); err != nil {
					return err
				}
			}
			rejected = problem.Unauthorized()
			return nil
		}
		if err := q.RevokeSession(ctx, session.ID); err != nil {
			return fmt.Errorf("rotate refresh session: %w", err)
		}
		result, err = s.newSession(ctx, q, record, session.FamilyID, &session.ID, client)
		return err
	})
	if err != nil {
		return Result{}, err
	}
	if rejected != nil {
		return Result{}, rejected
	}
	return result, nil
}

func (s *Service) Logout(ctx context.Context, value string, client Client) error {
	if err := s.rate(ctx, "logout", client.IP.String(), 60); err != nil {
		return err
	}
	if len(value) != 43 {
		return nil
	}
	session, err := s.queries.GetSessionByHash(ctx, RefreshHash(value))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("find logout session: %w", err)
	}
	return db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if _, err := q.GetUserForUpdate(ctx, session.UserID); errors.Is(err, pgx.ErrNoRows) {
			return nil
		} else if err != nil {
			return fmt.Errorf("lock logout user: %w", err)
		}
		if err := q.RevokeFamily(ctx, session.FamilyID); err != nil {
			return fmt.Errorf("revoke logout family: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{ActorID: &session.UserID, Action: "auth.logout", TargetType: "user", TargetID: &session.UserID, IP: client.IP})
	})
}

func (s *Service) newSession(ctx context.Context, q *query.Queries, record query.User, family uuid.UUID, previous *uuid.UUID, client Client) (Result, error) {
	id, err := validation.NewID()
	if err != nil {
		return Result{}, err
	}
	if family == uuid.Nil {
		family = id
	}
	token, err := NewRefreshToken()
	if err != nil {
		return Result{}, err
	}
	expires := time.Now().UTC().Add(30 * 24 * time.Hour)
	if _, err := q.CreateSession(ctx, query.CreateSessionParams{ID: id, UserID: record.ID, FamilyID: family, TokenHash: RefreshHash(token), Device: device(client.UserAgent), Ip: client.IP, UserAgent: cleanAgent(client.UserAgent), ExpiresAt: expires, RotatedFrom: previous}); err != nil {
		return Result{}, fmt.Errorf("create login session: %w", err)
	}
	access, err := s.tokens.Issue(record, family)
	if err != nil {
		return Result{}, err
	}
	return Result{AccessToken: access, TokenType: "Bearer", ExpiresIn: 900, User: user.View(record), RefreshToken: token, RefreshExpires: expires}, nil
}

func (s *Service) rate(ctx context.Context, scope, identity string, limit int) error {
	allowed, retry, err := s.gate.Allow(ctx, scope, identity, limit, time.Minute)
	if err != nil {
		return fmt.Errorf("check request limit: %w", err)
	}
	if !allowed {
		return problem.Retry("RATE_LIMITED", retry)
	}
	return nil
}
func (s *Service) failedLogin(ctx context.Context, identity string, cfg settings.Registration) error {
	if err := s.gate.LoginFailed(ctx, identity, cfg.LoginFailureLimit, time.Duration(cfg.LoginLockMinutes)*time.Minute); err != nil {
		return err
	}
	locked, retry, err := s.gate.LoginLocked(ctx, identity)
	if err != nil {
		return err
	}
	if locked {
		return problem.Retry("LOGIN_LOCKED", retry)
	}
	return problem.New("AUTH_INVALID_CREDENTIALS", http.StatusUnauthorized)
}
func registrationAllowed(cfg settings.Registration, email string) error {
	if !cfg.Enabled {
		return problem.New("REGISTRATION_CLOSED", http.StatusForbidden)
	}
	_, domain, _ := strings.Cut(email, "@")
	if slices.Contains(cfg.DomainBlocklist, domain) || (len(cfg.DomainAllowlist) > 0 && !slices.Contains(cfg.DomainAllowlist, domain)) {
		return problem.New("EMAIL_DOMAIN_BLOCKED", http.StatusForbidden)
	}
	return nil
}
func cleanAgent(value string) string {
	value = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, value)
	if len(value) > 512 {
		value = value[:512]
	}
	return strings.ToValidUTF8(value, "")
}
func device(agent string) string {
	browser := "Browser"
	for _, item := range []struct{ part, name string }{{"Edg/", "Edge"}, {"Firefox/", "Firefox"}, {"Chrome/", "Chrome"}, {"Safari/", "Safari"}} {
		if strings.Contains(agent, item.part) {
			browser = item.name
			break
		}
	}
	platform := "Other"
	for _, item := range []struct{ part, name string }{{"Windows", "Windows"}, {"Android", "Android"}, {"iPhone", "iOS"}, {"Macintosh", "macOS"}, {"Linux", "Linux"}} {
		if strings.Contains(agent, item.part) {
			platform = item.name
			break
		}
	}
	return browser + " / " + platform
}
