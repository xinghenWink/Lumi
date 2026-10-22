package credits

import (
	"github.com/google/uuid"
	"time"
)

const MaxBalance int64 = 1_000_000_000_000

type Configuration struct {
	SignupBonusCredits int64             `json:"signup_bonus_credits"`
	DailyFreeCredits   int64             `json:"daily_free_credits"`
	CreditsTimezone    string            `json:"credits_timezone"`
	EditMultiplier     string            `json:"edit_multiplier"`
	SizeMultipliers    map[string]string `json:"size_multipliers"`
}
type Account struct {
	UserID           uuid.UUID `json:"user_id"`
	PermanentBalance int64     `json:"permanent_balance"`
	DailyBalance     int64     `json:"daily_balance"`
	Total            int64     `json:"total"`
	DailyResetOn     string    `json:"daily_reset_on"`
	NextResetAt      time.Time `json:"next_reset_at"`
	Timezone         string    `json:"timezone"`
	Version          int64     `json:"version"`
}
type Rule struct {
	ModelID         *uuid.UUID `json:"model_id"`
	Operation       string     `json:"operation"`
	Quality         string     `json:"quality"`
	CreditsPerImage int64      `json:"credits_per_image"`
	Enabled         bool       `json:"enabled"`
}
type Pricing struct {
	Rules         []Rule        `json:"rules"`
	Configuration Configuration `json:"configuration"`
}
type QuoteInput struct {
	ModelID   *uuid.UUID `json:"model_id"`
	Operation string     `json:"operation"`
	Quality   string     `json:"quality"`
	Size      string     `json:"size"`
	Count     int64      `json:"count"`
}
type Quote struct {
	UnitPrice int64 `json:"unit_price"`
	TotalCost int64 `json:"total_cost"`
	Count     int64 `json:"count"`
}
type Charge struct {
	ID               uuid.UUID `json:"id"`
	Quote            Quote     `json:"quote"`
	Account          Account   `json:"account"`
	DailyCharged     int64     `json:"daily_charged"`
	PermanentCharged int64     `json:"permanent_charged"`
}
type Settlement struct {
	ChargeID     uuid.UUID `json:"charge_id"`
	FailedImages int64     `json:"failed_images"`
	Refunded     int64     `json:"refunded"`
	Account      Account   `json:"account"`
}
type AdjustInput struct {
	Bucket string `json:"bucket"`
	Action string `json:"action"`
	Amount int64  `json:"amount"`
	Note   string `json:"note"`
}
type LedgerRecord struct {
	ID                 uuid.UUID  `json:"id"`
	UserID             uuid.UUID  `json:"user_id"`
	Type               string     `json:"type"`
	Bucket             string     `json:"bucket"`
	Delta              int64      `json:"delta"`
	BucketBalanceAfter int64      `json:"bucket_balance_after"`
	TotalAfter         int64      `json:"total_after"`
	RefType            string     `json:"ref_type"`
	RefID              *uuid.UUID `json:"ref_id"`
	OperatorID         *uuid.UUID `json:"operator_id"`
	Note               string     `json:"note"`
	CreatedAt          time.Time  `json:"created_at"`
}
type LedgerFilter struct {
	UserID       *uuid.UUID
	Type, Cursor string
	From, Until  *time.Time
	Limit        int32
}
type LedgerPage struct {
	Items      []LedgerRecord `json:"items"`
	NextCursor string         `json:"next_cursor"`
}
type UsageDay struct {
	Date     string `json:"date"`
	Consumed int64  `json:"consumed"`
}
type Usage struct {
	Days            []UsageDay       `json:"days"`
	MonthConsumed   int64            `json:"month_consumed"`
	ImagesByQuality map[string]int64 `json:"images_by_quality"`
	Timezone        string           `json:"timezone"`
}
