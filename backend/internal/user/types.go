package user

import (
	"net/netip"
	"time"

	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
)

type Profile struct {
	PermanentBalance *int64     `json:"permanent_balance,omitempty"`
	DailyBalance     *int64     `json:"daily_balance,omitempty"`
	TotalCredits     *int64     `json:"total_credits,omitempty"`
	ID               uuid.UUID  `json:"id"`
	Email            string     `json:"email"`
	Nickname         string     `json:"nickname"`
	AvatarFileID     *uuid.UUID `json:"avatar_file_id"`
	Role             string     `json:"role"`
	Status           string     `json:"status"`
	Locale           string     `json:"locale"`
	Timezone         string     `json:"timezone"`
	CreatedAt        time.Time  `json:"created_at"`
	LastLoginAt      *time.Time `json:"last_login_at"`
	LastLoginIP      string     `json:"last_login_ip"`
}

type Actor struct {
	ID           uuid.UUID
	TokenVersion int64
	IP           netip.Addr
}

func View(record query.User) Profile {
	ip := ""
	if record.LastLoginIp != nil {
		ip = record.LastLoginIp.String()
	}
	return Profile{ID: record.ID, Email: record.Email, Nickname: record.Nickname, AvatarFileID: record.AvatarFileID,
		Role: record.Role, Status: record.Status, Locale: record.Locale, Timezone: record.Timezone,
		CreatedAt: record.CreatedAt.UTC(), LastLoginAt: UTCTime(record.LastLoginAt), LastLoginIP: ip}
}

func UTCTime(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	at := value.UTC()
	return &at
}
