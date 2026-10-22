package credits

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/pagination"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"time"
)

func validLedgerType(value string) bool {
	switch value {
	case "", "signup_bonus", "daily_grant", "daily_expire", "redeem", "admin_adjust", "image_charge", "image_refund":
		return true
	}
	return false
}
func (s *Service) Ledger(ctx context.Context, filter LedgerFilter) (LedgerPage, error) {
	if filter.Limit < 1 || filter.Limit > 100 || !validLedgerType(filter.Type) || (filter.From != nil && filter.Until != nil && !filter.From.Before(*filter.Until)) {
		return LedgerPage{}, problem.Invalid()
	}
	encoded, err := json.Marshal([]any{filter.UserID, filter.Type, filter.From, filter.Until})
	if err != nil {
		return LedgerPage{}, fmt.Errorf("encode ledger filters: %w", err)
	}
	fingerprint := pagination.Fingerprint(string(encoded))
	cursor, err := pagination.Decode(filter.Cursor, fingerprint)
	if err != nil {
		return LedgerPage{}, err
	}
	records, err := s.queries.ListCreditLedger(ctx, query.ListCreditLedgerParams{UserFilter: filter.UserID, TypeFilter: filter.Type, CreatedFrom: filter.From, CreatedUntil: filter.Until, CursorTime: cursor.Time, CursorID: cursor.ID, PageLimit: filter.Limit + 1})
	if err != nil {
		return LedgerPage{}, fmt.Errorf("list credit ledger: %w", err)
	}
	result := LedgerPage{Items: make([]LedgerRecord, 0, len(records))}
	if len(records) > int(filter.Limit) {
		records = records[:filter.Limit]
		last := records[len(records)-1]
		result.NextCursor, err = pagination.Encode(last.CreatedAt, last.ID, fingerprint)
		if err != nil {
			return result, err
		}
	}
	for _, record := range records {
		result.Items = append(result.Items, LedgerRecord{ID: record.ID, UserID: record.UserID, Type: record.Type, Bucket: record.Bucket, Delta: record.Delta, BucketBalanceAfter: record.BucketBalanceAfter, TotalAfter: record.TotalAfter, RefType: record.RefType, RefID: record.RefID, OperatorID: record.OperatorID, Note: record.Note, CreatedAt: record.CreatedAt.UTC()})
	}
	return result, nil
}
func (s *Service) Usage(ctx context.Context, owner uuid.UUID) (Usage, error) {
	cfg, err := configuration(ctx, s.queries)
	if err != nil {
		return Usage{}, err
	}
	now := s.now()
	_, location, err := calendar(now, cfg.CreditsTimezone)
	if err != nil {
		return Usage{}, err
	}
	local := now.In(location)
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, location)
	start := today.AddDate(0, 0, -29)
	month := time.Date(local.Year(), local.Month(), 1, 0, 0, 0, 0, location)
	queryStart := start
	if month.Before(queryStart) {
		queryStart = month
	}
	records, err := s.queries.ListCreditUsage(ctx, query.ListCreditUsageParams{UserID: owner, CreatedAt: queryStart.UTC()})
	if err != nil {
		return Usage{}, fmt.Errorf("read credit usage: %w", err)
	}
	result := Usage{Days: make([]UsageDay, 0, 30), ImagesByQuality: map[string]int64{"low": 0, "medium": 0, "high": 0}, Timezone: cfg.CreditsTimezone}
	totals := make(map[string]int64, 30)
	for _, record := range records {
		consumed := record.TotalCost - record.UnitPrice*record.FailedImages
		at := record.CreatedAt.In(location)
		if !at.Before(month) {
			result.MonthConsumed += consumed
			if record.Settled {
				result.ImagesByQuality[record.Quality] += record.ImageCount - record.FailedImages
			}
		}
		if !at.Before(start) && at.Before(today.AddDate(0, 0, 1)) {
			totals[at.Format(time.DateOnly)] += consumed
		}
	}
	for day := start; !day.After(today); day = day.AddDate(0, 0, 1) {
		text := day.Format(time.DateOnly)
		result.Days = append(result.Days, UsageDay{Date: text, Consumed: totals[text]})
	}
	return result, nil
}
