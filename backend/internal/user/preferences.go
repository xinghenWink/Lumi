package user

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/pagination"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
)

type Preferences struct {
	Theme        string `json:"theme"`
	Instructions string `json:"instructions"`
	ImageQuality string `json:"image_quality"`
	ImageRatio   string `json:"image_ratio"`
	ImageCount   int32  `json:"image_count"`
}

func PreferenceView(row query.UserPreference) Preferences {
	return Preferences{Theme: row.Theme, Instructions: row.Instructions, ImageQuality: row.ImageQuality, ImageRatio: row.ImageRatio, ImageCount: row.ImageCount}
}
func DefaultPreferences() Preferences {
	return Preferences{Theme: "system", ImageQuality: "medium", ImageRatio: "1:1", ImageCount: 1}
}
func (s *Service) Preferences(ctx context.Context, id uuid.UUID) (Preferences, error) {
	row, err := s.queries.GetPreferences(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return DefaultPreferences(), nil
	}
	if err != nil {
		return Preferences{}, fmt.Errorf("read preferences: %w", err)
	}
	return PreferenceView(row), nil
}
func (s *Service) SavePreferences(ctx context.Context, actor Actor, v Preferences) (Preferences, error) {
	if !slices.Contains([]string{"system", "light", "dark"}, v.Theme) || !slices.Contains([]string{"low", "medium", "high"}, v.ImageQuality) || !slices.Contains([]string{"1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"}, v.ImageRatio) || v.ImageCount < 1 || v.ImageCount > 4 || !validation.Text(v.Instructions, 0, 4000) {
		return Preferences{}, problem.Invalid()
	}
	var result Preferences
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		row, err := q.GetUserForUpdate(ctx, actor.ID)
		if err != nil {
			return DatabaseError("lock preferences owner", err)
		}
		if row.Status != "active" || row.TokenVersion != actor.TokenVersion {
			return problem.Unauthorized()
		}
		saved, err := q.SavePreferences(ctx, query.SavePreferencesParams{UserID: actor.ID, Theme: v.Theme, Instructions: v.Instructions, ImageQuality: v.ImageQuality, ImageRatio: v.ImageRatio, ImageCount: v.ImageCount})
		if err != nil {
			return fmt.Errorf("save preferences: %w", err)
		}
		result = PreferenceView(saved)
		// Custom instructions are private content and are never copied into audit history.
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "profile.preferences", TargetType: "user", TargetID: &actor.ID, IP: actor.IP})
	})
	return result, err
}
func (s *Service) Devices(ctx context.Context, id uuid.UUID) ([]Session, error) {
	rows, err := s.queries.ActiveDevices(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("list active devices: %w", err)
	}
	result := make([]Session, 0, len(rows))
	for _, r := range rows {
		result = append(result, Session{ID: r.FamilyID, Device: r.Device, IP: r.Ip.String(), UserAgent: r.UserAgent, CreatedAt: r.CreatedAt, ExpiresAt: r.ExpiresAt})
	}
	return result, nil
}

type DevicePage struct {
	Items      []Session `json:"items"`
	NextCursor string    `json:"next_cursor"`
}

func (s *Service) DevicePage(ctx context.Context, id uuid.UUID, cursor string, limit int32) (DevicePage, error) {
	result := DevicePage{Items: []Session{}}
	if limit < 1 || limit > 100 {
		return result, problem.Invalid()
	}
	key := pagination.Fingerprint("devices", id.String())
	point, err := pagination.Decode(cursor, key)
	if err != nil {
		return result, err
	}
	rows, err := s.queries.ActiveDevicePage(ctx, query.ActiveDevicePageParams{UserID: id, CursorTime: point.Time, CursorID: point.ID, PageLimit: limit + 1})
	if err != nil {
		return result, fmt.Errorf("list device page: %w", err)
	}
	if len(rows) > int(limit) {
		rows = rows[:limit]
		last := rows[len(rows)-1]
		result.NextCursor, err = pagination.Encode(last.CreatedAt, last.FamilyID, key)
		if err != nil {
			return result, err
		}
	}
	for _, r := range rows {
		result.Items = append(result.Items, Session{ID: r.FamilyID, Device: r.Device, IP: r.Ip.String(), UserAgent: r.UserAgent, CreatedAt: r.CreatedAt, ExpiresAt: r.ExpiresAt})
	}
	return result, nil
}
func (s *Service) RevokeDevices(ctx context.Context, actor Actor, target uuid.UUID, family *uuid.UUID, admin bool) error {
	return db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if admin {
			if err := LockAdmin(ctx, q, actor); err != nil {
				return err
			}
		} else if actor.ID != target {
			return problem.Forbidden()
		}
		row, err := q.GetUserForUpdate(ctx, target)
		if err != nil {
			return DatabaseError("lock device account", err)
		}
		if !admin && (row.Status != "active" || row.TokenVersion != actor.TokenVersion) {
			return problem.Unauthorized()
		}
		if family == nil {
			err = q.RevokeUserSessions(ctx, target)
		} else {
			var count int64
			count, err = q.RevokeOwnedDevice(ctx, query.RevokeOwnedDeviceParams{UserID: target, FamilyID: *family})
			if err == nil && count == 0 {
				return problem.New("SESSION_NOT_FOUND", 404)
			}
		}
		if err != nil {
			return fmt.Errorf("revoke devices: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "user.sessions_revoke", TargetType: "user", TargetID: &target, IP: actor.IP})
	})
}
func (s *Service) DeleteSelf(ctx context.Context, actor Actor, email, currentPassword string) error {
	if len(currentPassword) > 512 {
		return problem.Invalid()
	}
	return db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := q.LockAdminChanges(ctx); err != nil {
			return fmt.Errorf("lock self deletion: %w", err)
		}
		row, err := q.GetUserForUpdate(ctx, actor.ID)
		if err != nil {
			return DatabaseError("lock self deletion owner", err)
		}
		if row.Status != "active" || row.TokenVersion != actor.TokenVersion {
			return problem.Unauthorized()
		}
		if !strings.EqualFold(strings.TrimSpace(email), row.Email) {
			return problem.New("EMAIL_CONFIRMATION_MISMATCH", 400)
		}
		valid, err := s.passwords.Verify(ctx, row.PasswordHash, currentPassword)
		if err != nil {
			return err
		}
		if !valid {
			return problem.New("CURRENT_PASSWORD_INVALID", 400)
		}
		if err := protectLastAdmin(ctx, q, row, false); err != nil {
			return err
		}
		if err := q.DeleteOwnAccount(ctx, actor.ID); err != nil {
			return fmt.Errorf("delete own account: %w", err)
		}
		if err := q.RevokeUserSessions(ctx, actor.ID); err != nil {
			return fmt.Errorf("revoke deleted account sessions: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "profile.delete", TargetType: "user", TargetID: &actor.ID, IP: actor.IP})
	})
}

// Batch changes are atomic and preserve the same administrator safeguards as single writes.
func (s *Service) Batch(ctx context.Context, actor Actor, ids []uuid.UUID, action string) error {
	if len(ids) < 1 || len(ids) > 100 || !slices.Contains([]string{"enable", "disable", "delete"}, action) {
		return problem.Invalid()
	}
	ids = slices.Clone(ids)
	slices.SortFunc(ids, func(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) })
	for i, id := range ids {
		if id == uuid.Nil || (i > 0 && id == ids[i-1]) {
			return problem.Invalid()
		}
		if id == actor.ID {
			return problem.New("CANNOT_MODIFY_SELF", 409)
		}
	}
	return db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		for _, id := range ids {
			row, err := q.GetUserForUpdate(ctx, id)
			if err != nil {
				return DatabaseError("lock batch target", err)
			}
			before := audit.UserSnapshot(row)
			if action != "enable" {
				if err := protectLastAdmin(ctx, q, row, false); err != nil {
					return err
				}
			}
			if action == "delete" {
				err = q.SoftDeleteUser(ctx, id)
			} else {
				row.Status = "active"
				if action == "disable" {
					row.Status = "disabled"
				}
				row.TokenVersion++
				_, err = q.UpdateUser(ctx, updateParams(row))
			}
			if err != nil {
				return fmt.Errorf("change batch target: %w", err)
			}
			if err := q.RevokeUserSessions(ctx, id); err != nil {
				return fmt.Errorf("revoke batch target: %w", err)
			}
			if err := audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "user.batch_" + action, TargetType: "user", TargetID: &id, Before: before, IP: actor.IP}); err != nil {
				return err
			}
		}
		return nil
	})
}
