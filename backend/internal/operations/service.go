package operations

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/pagination"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

type Service struct {
	pool      *pgxpool.Pool
	q         *query.Queries
	StartedAt time.Time
}

func New(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool, q: query.New(pool), StartedAt: time.Now()}
}

type Page[T any] struct {
	Items      []T    `json:"items"`
	NextCursor string `json:"next_cursor"`
}
type Announcement struct {
	ID        uuid.UUID  `json:"id"`
	Content   string     `json:"content"`
	StartsAt  time.Time  `json:"starts_at"`
	EndsAt    *time.Time `json:"ends_at"`
	Enabled   bool       `json:"enabled"`
	Version   int64      `json:"version"`
	CreatedAt time.Time  `json:"created_at"`
}

func announcement(r query.Announcement) Announcement {
	return Announcement{ID: r.ID, Content: r.Content, StartsAt: r.StartsAt, EndsAt: r.EndsAt, Enabled: r.Enabled, Version: r.Version, CreatedAt: r.CreatedAt}
}
func (s *Service) Announcements(ctx context.Context, active bool, cursor string, limit int32) (Page[Announcement], error) {
	result := Page[Announcement]{Items: []Announcement{}}
	if limit < 1 || limit > 100 {
		return result, problem.Invalid()
	}
	key := pagination.Fingerprint("announcements", fmt.Sprint(active))
	point, err := pagination.Decode(cursor, key)
	if err != nil {
		return result, err
	}
	rows, err := s.q.ListAnnouncements(ctx, query.ListAnnouncementsParams{ActiveOnly: active, CursorTime: point.Time, CursorID: point.ID, PageLimit: limit + 1})
	if err != nil {
		return result, fmt.Errorf("list announcements: %w", err)
	}
	if len(rows) > int(limit) {
		rows = rows[:limit]
		last := rows[len(rows)-1]
		result.NextCursor, err = pagination.Encode(last.CreatedAt, last.ID, key)
		if err != nil {
			return result, err
		}
	}
	for _, row := range rows {
		result.Items = append(result.Items, announcement(row))
	}
	return result, nil
}
func (s *Service) SaveAnnouncement(ctx context.Context, actor user.Actor, id uuid.UUID, input Announcement, remove bool) (Announcement, error) {
	if !remove && (!validation.Text(input.Content, 1, 10000) || input.StartsAt.IsZero() || (input.EndsAt != nil && !input.EndsAt.After(input.StartsAt))) {
		return Announcement{}, problem.Invalid()
	}
	var result Announcement
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		var before any
		var saved query.Announcement
		if id != uuid.Nil {
			old, err := q.GetAnnouncement(ctx, id)
			if errors.Is(err, pgx.ErrNoRows) {
				return problem.New("ANNOUNCEMENT_NOT_FOUND", 404)
			}
			if err != nil {
				return fmt.Errorf("read announcement: %w", err)
			}
			before = announcement(old)
			if !remove && old.Version != input.Version {
				return problem.New("CONFIGURATION_CONFLICT", 409)
			}
		}
		var err error
		action := "announcement.save"
		if remove {
			err = q.DeleteAnnouncement(ctx, id)
			action = "announcement.delete"
		} else if id == uuid.Nil {
			id, err = validation.NewID()
			if err != nil {
				return err
			}
			saved, err = q.CreateAnnouncement(ctx, query.CreateAnnouncementParams{ID: id, Content: input.Content, StartsAt: input.StartsAt, EndsAt: input.EndsAt, Enabled: input.Enabled})
		} else {
			saved, err = q.UpdateAnnouncement(ctx, query.UpdateAnnouncementParams{ID: id, Content: input.Content, StartsAt: input.StartsAt, EndsAt: input.EndsAt, Enabled: input.Enabled, Version: input.Version})
		}
		if err != nil {
			return fmt.Errorf("save announcement: %w", err)
		}
		result = announcement(saved)
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: action, TargetType: "announcement", TargetID: &id, Before: before, After: result, IP: actor.IP})
	})
	return result, err
}

type Day struct {
	SignupCredits  int64  `json:"signup_credits"`
	DailyCredits   int64  `json:"daily_credits"`
	RedeemCredits  int64  `json:"redeem_credits"`
	AdminCredits   int64  `json:"admin_credits"`
	Date           string `json:"date"`
	NewUsers       int64  `json:"new_users"`
	ActiveUsers    int64  `json:"active_users"`
	ChatMessages   int64  `json:"chat_messages"`
	ImageSuccess   int64  `json:"image_success"`
	ImageFailed    int64  `json:"image_failed"`
	CreditsGranted int64  `json:"credits_granted"`
	CreditsSpent   int64  `json:"credits_spent"`
}
type Dashboard struct {
	Users         int64                              `json:"users"`
	ActiveStreams int64                              `json:"active_streams"`
	CreditChanges int64                              `json:"credit_changes"`
	Days          []Day                              `json:"days"`
	Upstreams     []query.OperationsUpstreamStatsRow `json:"upstreams"`
	Tasks         []query.OperationsTaskCountsRow    `json:"tasks"`
}

func (s *Service) Dashboard(ctx context.Context, days int32) (Dashboard, error) {
	var result Dashboard
	if days != 1 && days != 7 && days != 30 {
		return result, problem.Invalid()
	}
	totals, err := s.q.DashboardTotals(ctx)
	if err != nil {
		return result, fmt.Errorf("read dashboard totals: %w", err)
	}
	result.Users = totals.Users
	result.ActiveStreams = totals.ActiveStreams
	result.CreditChanges = totals.CreditChanges
	result.Days = []Day{}
	trend, err := s.q.DashboardTrend(ctx, days)
	if err != nil {
		return result, fmt.Errorf("read dashboard trend: %w", err)
	}
	for _, d := range trend {
		result.Days = append(result.Days, Day{SignupCredits: d.SignupCredits, DailyCredits: d.DailyCredits, RedeemCredits: d.RedeemCredits, AdminCredits: d.AdminCredits, Date: d.Day.UTC().Format(time.DateOnly), NewUsers: d.NewUsers, ActiveUsers: d.ActiveUsers, ChatMessages: d.ChatMessages, ImageSuccess: d.ImageSuccess, ImageFailed: d.ImageFailed, CreditsGranted: d.CreditsGranted, CreditsSpent: d.CreditsSpent})
	}
	result.Upstreams, err = s.q.OperationsUpstreamStats(ctx, days)
	if err != nil {
		return result, fmt.Errorf("read upstream statistics: %w", err)
	}
	result.Tasks, err = s.q.OperationsTaskCounts(ctx)
	if err != nil {
		return result, fmt.Errorf("read task statistics: %w", err)
	}
	return result, nil
}

type ChatMetadata struct {
	ID            uuid.UUID  `json:"id"`
	UserID        uuid.UUID  `json:"user_id"`
	ModelID       *uuid.UUID `json:"model_id"`
	LastMessageAt time.Time  `json:"last_message_at"`
	CreatedAt     time.Time  `json:"created_at"`
	Busy          bool       `json:"busy"`
}

func (s *Service) Chats(ctx context.Context, owner *uuid.UUID, cursor string, limit int32) (Page[ChatMetadata], error) {
	result := Page[ChatMetadata]{Items: []ChatMetadata{}}
	if limit < 1 || limit > 100 {
		return result, problem.Invalid()
	}
	key := pagination.Fingerprint("admin-chats", fmt.Sprint(owner))
	point, err := pagination.Decode(cursor, key)
	if err != nil {
		return result, err
	}
	rows, err := s.q.AdminChatConversations(ctx, query.AdminChatConversationsParams{Owner: owner, CursorTime: point.Time, CursorID: point.ID, PageLimit: limit + 1})
	if err != nil {
		return result, fmt.Errorf("list admin chats: %w", err)
	}
	if len(rows) > int(limit) {
		rows = rows[:limit]
		last := rows[len(rows)-1]
		result.NextCursor, err = pagination.Encode(last.LastMessageAt, last.ID, key)
		if err != nil {
			return result, err
		}
	}
	for _, r := range rows {
		result.Items = append(result.Items, ChatMetadata{ID: r.ID, UserID: r.UserID, ModelID: r.ModelID, LastMessageAt: r.LastMessageAt, CreatedAt: r.CreatedAt, Busy: r.ActiveRunID != nil})
	}
	return result, nil
}
func (s *Service) CheckDatabase(ctx context.Context) error { return s.pool.Ping(ctx) }
func (s *Service) AuditAction(ctx context.Context, actor user.Actor, action string) error {
	return db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: action, TargetType: "system", IP: actor.IP})
	})
}

func (s *Service) AuditContent(ctx context.Context, actor user.Actor, id uuid.UUID) error {
	return db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "chat.content_view", TargetType: "conversation", TargetID: &id, IP: actor.IP})
	})
}
