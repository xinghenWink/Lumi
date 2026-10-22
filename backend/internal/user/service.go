package user

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/pagination"
	"github.com/xinghenWink/Lumi/backend/internal/platform/password"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
)

type Service struct {
	pool      *pgxpool.Pool
	queries   *query.Queries
	passwords *password.Hasher
}

func New(pool *pgxpool.Pool, passwords *password.Hasher) *Service {
	return &Service{pool: pool, queries: query.New(pool), passwords: passwords}
}

// LockAdmin serializes privilege changes and rechecks the actor inside the transaction.
func LockAdmin(ctx context.Context, q *query.Queries, actor Actor) error {
	if err := q.LockAdminChanges(ctx); err != nil {
		return fmt.Errorf("lock administrator changes: %w", err)
	}
	current, err := q.GetUserForUpdate(ctx, actor.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return problem.Forbidden()
	}
	if err != nil {
		return fmt.Errorf("read administrator: %w", err)
	}
	if current.Role != "admin" || current.Status != "active" || current.TokenVersion != actor.TokenVersion {
		return problem.Forbidden()
	}
	return nil
}

type CreateInput struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Nickname string `json:"nickname"`
	Role     string `json:"role"`
}
type UpdateInput struct {
	Email    *string `json:"email"`
	Password *string `json:"password"`
	Nickname *string `json:"nickname"`
	Role     *string `json:"role"`
	Status   *string `json:"status"`
}
type SelfInput struct {
	Nickname *string `json:"nickname"`
	Locale   *string `json:"locale"`
	Timezone *string `json:"timezone"`
}
type PasswordInput struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

func (s *Service) Create(ctx context.Context, actor Actor, input CreateInput) (Profile, error) {
	email, err := validation.Email(input.Email)
	if err != nil {
		return Profile{}, err
	}
	input.Nickname = strings.TrimSpace(input.Nickname)
	if !validation.Text(input.Nickname, 1, 30) || (input.Role != "user" && input.Role != "admin") {
		return Profile{}, problem.Invalid()
	}
	if err := password.Validate(input.Password); err != nil {
		return Profile{}, err
	}
	hash, err := s.passwords.Hash(ctx, input.Password)
	if err != nil {
		return Profile{}, err
	}
	id, err := validation.NewID()
	if err != nil {
		return Profile{}, err
	}
	var record query.User
	err = db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		var err error
		record, err = q.CreateUser(ctx, query.CreateUserParams{ID: id, Email: email, PasswordHash: hash, Nickname: input.Nickname, Role: input.Role, Status: "active"})
		if err != nil {
			return DatabaseError("create user", err)
		}
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "user.create", TargetType: "user", TargetID: &record.ID, After: audit.UserSnapshot(record), IP: actor.IP})
	})
	return View(record), err
}

func (s *Service) Update(ctx context.Context, actor Actor, id uuid.UUID, input UpdateInput) (Profile, error) {
	if input.Email == nil && input.Password == nil && input.Nickname == nil && input.Role == nil && input.Status == nil {
		return Profile{}, problem.Invalid()
	}
	var newHash string
	if input.Password != nil {
		if err := password.Validate(*input.Password); err != nil {
			return Profile{}, err
		}
		hash, err := s.passwords.Hash(ctx, *input.Password)
		if err != nil {
			return Profile{}, err
		}
		newHash = hash
	}
	var result query.User
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		before, err := q.GetUserForUpdate(ctx, id)
		if err != nil {
			return DatabaseError("read user", err)
		}
		after := before
		if input.Email != nil {
			after.Email, err = validation.Email(*input.Email)
			if err != nil {
				return err
			}
		}
		if input.Nickname != nil {
			after.Nickname = strings.TrimSpace(*input.Nickname)
			if !validation.Text(after.Nickname, 1, 30) {
				return problem.Invalid()
			}
		}
		if input.Role != nil {
			if *input.Role != "user" && *input.Role != "admin" {
				return problem.Invalid()
			}
			after.Role = *input.Role
		}
		if input.Status != nil {
			if *input.Status != "active" && *input.Status != "disabled" {
				return problem.Invalid()
			}
			after.Status = *input.Status
		}
		if actor.ID == id && (after.Role != before.Role || after.Status != "active") {
			return problem.New("CANNOT_MODIFY_SELF", http.StatusConflict)
		}
		if err := protectLastAdmin(ctx, q, before, after.Role == "admin" && after.Status == "active"); err != nil {
			return err
		}
		if newHash != "" {
			after.PasswordHash = newHash
		}
		if before.Email != after.Email || before.Role != after.Role || before.Status != after.Status || newHash != "" {
			after.TokenVersion++
			if err := q.RevokeUserSessions(ctx, id); err != nil {
				return fmt.Errorf("revoke changed user sessions: %w", err)
			}
		}
		result, err = q.UpdateUser(ctx, updateParams(after))
		if err != nil {
			return DatabaseError("update user", err)
		}
		snapshot := audit.UserSnapshot(result)
		snapshot["password_changed"] = newHash != ""
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "user.update", TargetType: "user", TargetID: &id, Before: audit.UserSnapshot(before), After: snapshot, IP: actor.IP})
	})
	return View(result), err
}

func (s *Service) Delete(ctx context.Context, actor Actor, id uuid.UUID, confirmation string) error {
	if actor.ID == id {
		return problem.New("CANNOT_MODIFY_SELF", http.StatusConflict)
	}
	return db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		record, err := q.GetUserForUpdate(ctx, id)
		if err != nil {
			return DatabaseError("read deleted user", err)
		}
		email, err := validation.Email(confirmation)
		if err != nil || email != record.Email {
			return problem.New("EMAIL_CONFIRMATION_MISMATCH", http.StatusBadRequest)
		}
		if err := protectLastAdmin(ctx, q, record, false); err != nil {
			return err
		}
		if err := q.SoftDeleteUser(ctx, id); err != nil {
			return fmt.Errorf("soft delete user: %w", err)
		}
		if err := q.RevokeUserSessions(ctx, id); err != nil {
			return fmt.Errorf("revoke deleted user sessions: %w", err)
		}
		before := audit.UserSnapshot(record)
		now := time.Now().UTC()
		record.DeletedAt = &now
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "user.delete", TargetType: "user", TargetID: &id, Before: before, After: audit.UserSnapshot(record), IP: actor.IP})
	})
}

// PurgeDeleted removes expired accounts and their cascading sessions atomically
// with an audit entry. SKIP LOCKED lets multiple application instances cooperate.
func (s *Service) PurgeDeleted(ctx context.Context, limit int32) (int, error) {
	if limit < 1 || limit > 100 {
		return 0, problem.Invalid()
	}
	count := 0
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		records, err := q.ListUsersForPurge(ctx, limit)
		if err != nil {
			return fmt.Errorf("list expired accounts: %w", err)
		}
		for _, record := range records {
			if err := q.PurgeDeletedUser(ctx, record.ID); err != nil {
				return fmt.Errorf("purge expired account: %w", err)
			}
			if err := audit.Write(ctx, q, audit.Entry{Action: "user.purge", TargetType: "user", TargetID: &record.ID, Before: audit.UserSnapshot(record), After: map[string]bool{"purged": true}, IP: netip.MustParseAddr("127.0.0.1")}); err != nil {
				return err
			}
		}
		count = len(records)
		return nil
	})
	if err != nil {
		return 0, err
	}
	return count, nil
}

func (s *Service) UpdateSelf(ctx context.Context, actor Actor, input SelfInput) (Profile, error) {
	if input.Nickname == nil && input.Locale == nil && input.Timezone == nil {
		return Profile{}, problem.Invalid()
	}
	var result query.User
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		record, err := q.GetUserForUpdate(ctx, actor.ID)
		if err != nil {
			return DatabaseError("read profile", err)
		}
		if record.Status != "active" || record.TokenVersion != actor.TokenVersion {
			return problem.Unauthorized()
		}
		before := audit.UserSnapshot(record)
		if input.Nickname != nil {
			record.Nickname = strings.TrimSpace(*input.Nickname)
			if !validation.Text(record.Nickname, 1, 30) {
				return problem.Invalid()
			}
		}
		if input.Locale != nil {
			if *input.Locale != "zh-CN" && *input.Locale != "en" {
				return problem.Invalid()
			}
			record.Locale = *input.Locale
		}
		if input.Timezone != nil {
			if len(*input.Timezone) > 100 {
				return problem.Invalid()
			}
			if _, err := time.LoadLocation(*input.Timezone); err != nil {
				return problem.Invalid()
			}
			record.Timezone = *input.Timezone
		}
		result, err = q.UpdateUser(ctx, updateParams(record))
		if err != nil {
			return fmt.Errorf("update profile: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "profile.update", TargetType: "user", TargetID: &actor.ID, Before: before, After: audit.UserSnapshot(result), IP: actor.IP})
	})
	return View(result), err
}

func (s *Service) ChangePassword(ctx context.Context, actor Actor, input PasswordInput) error {
	if len(input.CurrentPassword) > 512 {
		return problem.Invalid()
	}
	if err := password.Validate(input.NewPassword); err != nil {
		return err
	}
	hash, err := s.passwords.Hash(ctx, input.NewPassword)
	if err != nil {
		return err
	}
	return db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		record, err := q.GetUserForUpdate(ctx, actor.ID)
		if err != nil {
			return DatabaseError("read password user", err)
		}
		if record.Status != "active" || record.TokenVersion != actor.TokenVersion {
			return problem.Unauthorized()
		}
		valid, err := s.passwords.Verify(ctx, record.PasswordHash, input.CurrentPassword)
		if err != nil {
			return err
		}
		if !valid {
			return problem.New("CURRENT_PASSWORD_INVALID", http.StatusBadRequest)
		}
		record.PasswordHash = hash
		record.TokenVersion++
		if _, err := q.UpdateUser(ctx, updateParams(record)); err != nil {
			return fmt.Errorf("change password: %w", err)
		}
		if err := q.RevokeUserSessions(ctx, actor.ID); err != nil {
			return fmt.Errorf("revoke password sessions: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "profile.password_change", TargetType: "user", TargetID: &actor.ID, After: map[string]bool{"password_changed": true}, IP: actor.IP})
	})
}

type Filter struct {
	Search, Role, Status, Sort, Cursor string
	From, Until                        *time.Time
	Limit                              int32
}
type Page struct {
	Items      []Profile `json:"items"`
	NextCursor string    `json:"next_cursor"`
}

func (s *Service) List(ctx context.Context, filter Filter) (Page, error) {
	if filter.Limit < 1 || filter.Limit > 100 || len(filter.Search) > 254 || (filter.Role != "" && filter.Role != "admin" && filter.Role != "user") || (filter.Status != "" && filter.Status != "active" && filter.Status != "disabled") || (filter.Sort != "created_at" && filter.Sort != "last_login_at") {
		return Page{}, problem.Invalid()
	}
	encoded, err := json.Marshal([]any{filter.Search, filter.Role, filter.Status, filter.Sort, filter.From, filter.Until})
	if err != nil {
		return Page{}, fmt.Errorf("encode user filters: %w", err)
	}
	fingerprint := pagination.Fingerprint(string(encoded))
	cursor, err := pagination.Decode(filter.Cursor, fingerprint)
	if err != nil {
		return Page{}, err
	}
	records, err := s.queries.ListUsers(ctx, query.ListUsersParams{Search: filter.Search, RoleFilter: filter.Role, StatusFilter: filter.Status, SortBy: filter.Sort, CreatedFrom: filter.From, CreatedUntil: filter.Until, CursorTime: cursor.Time, CursorID: cursor.ID, PageLimit: filter.Limit + 1})
	if err != nil {
		return Page{}, fmt.Errorf("list users: %w", err)
	}
	page := Page{Items: make([]Profile, 0, len(records))}
	if len(records) > int(filter.Limit) {
		records = records[:filter.Limit]
		last := records[len(records)-1]
		at := last.CreatedAt
		if filter.Sort == "last_login_at" {
			at = time.Unix(0, 0)
			if last.LastLoginAt != nil {
				at = *last.LastLoginAt
			}
		}
		page.NextCursor, err = pagination.Encode(at, last.ID, fingerprint)
		if err != nil {
			return Page{}, err
		}
	}
	for _, record := range records {
		page.Items = append(page.Items, View(record))
	}
	return page, nil
}

type Session struct {
	ID        uuid.UUID  `json:"id"`
	Device    string     `json:"device"`
	IP        string     `json:"ip"`
	UserAgent string     `json:"user_agent"`
	CreatedAt time.Time  `json:"created_at"`
	ExpiresAt time.Time  `json:"expires_at"`
	RevokedAt *time.Time `json:"revoked_at"`
}
type Detail struct {
	User     Profile   `json:"user"`
	Sessions []Session `json:"sessions"`
}

func (s *Service) Detail(ctx context.Context, id uuid.UUID) (Detail, error) {
	record, err := s.queries.GetUser(ctx, id)
	if err != nil {
		return Detail{}, DatabaseError("get user detail", err)
	}
	sessions, err := s.queries.ListUserSessions(ctx, id)
	if err != nil {
		return Detail{}, fmt.Errorf("list user sessions: %w", err)
	}
	result := Detail{User: View(record), Sessions: make([]Session, 0, len(sessions))}
	for _, session := range sessions {
		result.Sessions = append(result.Sessions, Session{ID: session.ID, Device: session.Device, IP: session.Ip.String(), UserAgent: session.UserAgent, CreatedAt: session.CreatedAt.UTC(), ExpiresAt: session.ExpiresAt.UTC(), RevokedAt: UTCTime(session.RevokedAt)})
	}
	return result, nil
}

func (s *Service) Bootstrap(ctx context.Context, email, value string, required bool) error {
	return db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := q.LockAdminChanges(ctx); err != nil {
			return fmt.Errorf("lock bootstrap: %w", err)
		}
		count, err := q.CountAllAdmins(ctx)
		if err != nil {
			return fmt.Errorf("count administrators: %w", err)
		}
		if count > 0 {
			return nil
		}
		if email == "" && value == "" && !required {
			return nil
		}
		email, err = validation.Email(email)
		if err != nil {
			return problem.New("ADMIN_BOOTSTRAP_INVALID", http.StatusBadRequest)
		}
		if err := password.Validate(value); err != nil {
			return err
		}
		hash, err := s.passwords.Hash(ctx, value)
		if err != nil {
			return err
		}
		id, err := validation.NewID()
		if err != nil {
			return err
		}
		record, err := q.CreateUser(ctx, query.CreateUserParams{ID: id, Email: email, PasswordHash: hash, Nickname: "Lumi Admin", Role: "admin", Status: "active"})
		if err != nil {
			return DatabaseError("bootstrap administrator", err)
		}
		return audit.Write(ctx, q, audit.Entry{Action: "admin.bootstrap", TargetType: "user", TargetID: &id, After: audit.UserSnapshot(record), IP: netip.MustParseAddr("127.0.0.1")})
	})
}

func (s *Service) ResetAdminPassword(ctx context.Context, email, value string) error {
	email, err := validation.Email(email)
	if err != nil {
		return err
	}
	if err := password.Validate(value); err != nil {
		return err
	}
	hash, err := s.passwords.Hash(ctx, value)
	if err != nil {
		return err
	}
	return db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := q.LockAdminChanges(ctx); err != nil {
			return fmt.Errorf("lock administrator reset: %w", err)
		}
		record, err := q.GetUserByEmail(ctx, email)
		if err != nil {
			return DatabaseError("find reset administrator", err)
		}
		if record.Role != "admin" {
			return problem.Forbidden()
		}
		record, err = q.GetUserForUpdate(ctx, record.ID)
		if err != nil {
			return fmt.Errorf("lock reset administrator: %w", err)
		}
		record.PasswordHash = hash
		record.TokenVersion++
		if _, err := q.UpdateUser(ctx, updateParams(record)); err != nil {
			return fmt.Errorf("reset administrator password: %w", err)
		}
		if err := q.RevokeUserSessions(ctx, record.ID); err != nil {
			return fmt.Errorf("revoke reset sessions: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{Action: "admin.password_reset_cli", TargetType: "user", TargetID: &record.ID, After: map[string]bool{"password_changed": true}, IP: netip.MustParseAddr("127.0.0.1")})
	})
}

func protectLastAdmin(ctx context.Context, q *query.Queries, record query.User, remainsActive bool) error {
	if record.Role != "admin" || record.Status != "active" || remainsActive {
		return nil
	}
	count, err := q.CountActiveAdmins(ctx)
	if err != nil {
		return fmt.Errorf("count active administrators: %w", err)
	}
	if count <= 1 {
		return problem.New("LAST_ADMIN_REQUIRED", http.StatusConflict)
	}
	return nil
}

func updateParams(record query.User) query.UpdateUserParams {
	return query.UpdateUserParams{ID: record.ID, Email: record.Email, Nickname: record.Nickname, Role: record.Role, Status: record.Status, PasswordHash: record.PasswordHash, TokenVersion: record.TokenVersion, Locale: record.Locale, Timezone: record.Timezone}
}

func DatabaseError(operation string, err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return problem.New("USER_NOT_FOUND", http.StatusNotFound)
	}
	var pgError *pgconn.PgError
	if errors.As(err, &pgError) && pgError.Code == "23505" {
		return problem.New("EMAIL_ALREADY_EXISTS", http.StatusConflict)
	}
	return fmt.Errorf("%s: %w", operation, err)
}
