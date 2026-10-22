package credits

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

func configuration(ctx context.Context, q *query.Queries) (Configuration, error) {
	data, err := q.GetCreditConfiguration(ctx)
	if err != nil {
		return Configuration{}, fmt.Errorf("read credit configuration: %w", err)
	}
	var value Configuration
	if err := json.Unmarshal(data, &value); err != nil {
		return value, fmt.Errorf("decode credit configuration: %w", err)
	}
	if err := validateConfiguration(value); err != nil {
		return value, err
	}
	return value, nil
}

// Read-only balance traffic shares the bounded settings cache. Financial writes
// still load configuration inside their transaction, and SavePricing invalidates it.
func (s *Service) readConfiguration(ctx context.Context) (Configuration, error) {
	s.configMu.Lock()
	defer s.configMu.Unlock()
	if time.Now().Before(s.readConfigUntil) {
		return s.readConfig, nil
	}
	value, err := configuration(ctx, s.queries)
	if err != nil {
		return Configuration{}, err
	}
	s.readConfig = value
	s.readConfigUntil = time.Now().Add(30 * time.Second)
	return value, nil
}
func validateConfiguration(value Configuration) error {
	if value.SignupBonusCredits < 0 || value.SignupBonusCredits > 1_000_000_000 || value.DailyFreeCredits < 0 || value.DailyFreeCredits > 1_000_000_000 {
		return problem.Invalid()
	}
	if value.CreditsTimezone == "" || value.CreditsTimezone == "Local" || len(value.CreditsTimezone) > 100 {
		return problem.Invalid()
	}
	if _, err := time.LoadLocation(value.CreditsTimezone); err != nil {
		return problem.Invalid()
	}
	if _, err := multiplier(value.EditMultiplier); err != nil {
		return err
	}
	if len(value.SizeMultipliers) > 20 || value.SizeMultipliers == nil {
		return problem.Invalid()
	}
	for size, amount := range value.SizeMultipliers {
		if !validSize(size) {
			return problem.Invalid()
		}
		if _, err := multiplier(amount); err != nil {
			return err
		}
	}
	return nil
}
func multiplier(value string) (*big.Rat, error) {
	matches, err := regexp.MatchString("^[0-9]{1,3}([.][0-9]{1,4})?$", value)
	if err != nil || !matches {
		return nil, problem.Invalid()
	}
	amount, ok := new(big.Rat).SetString(value)
	if !ok || amount.Sign() < 0 || amount.Cmp(big.NewRat(100, 1)) > 0 {
		return nil, problem.Invalid()
	}
	return amount, nil
}
func validSize(value string) bool {
	if value == "auto" {
		return true
	}
	width, height, ok := strings.Cut(value, "x")
	if !ok {
		return false
	}
	x, err := strconv.Atoi(width)
	if err != nil || x < 1 || x > 65536 {
		return false
	}
	y, err := strconv.Atoi(height)
	return err == nil && y > 0 && y <= 65536 && value == fmt.Sprintf("%dx%d", x, y)
}
func validQuality(value string) bool   { return value == "low" || value == "medium" || value == "high" }
func validOperation(value string) bool { return value == "generate" || value == "edit" }

func (s *Service) Pricing(ctx context.Context) (Pricing, error) {
	var result Pricing
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		// Readers share the same configuration lock as writers for a coherent quote.
		if err := q.ReadCreditConfigurationLock(ctx); err != nil {
			return fmt.Errorf("lock pricing configuration: %w", err)
		}
		return readPricing(ctx, q, &result)
	})
	return result, err
}
func readPricing(ctx context.Context, q *query.Queries, result *Pricing) error {
	cfg, err := configuration(ctx, q)
	if err != nil {
		return err
	}
	rules, err := q.ListPricingRules(ctx)
	if err != nil {
		return fmt.Errorf("list pricing rules: %w", err)
	}
	result.Configuration = cfg
	result.Rules = make([]Rule, 0, len(rules))
	for _, r := range rules {
		result.Rules = append(result.Rules, Rule{ModelID: r.ModelID, Operation: r.Operation, Quality: r.Quality, CreditsPerImage: r.CreditsPerImage, Enabled: r.Enabled})
	}
	return nil
}
func (s *Service) SavePricing(ctx context.Context, actor user.Actor, value Pricing) (Pricing, error) {
	if err := validateConfiguration(value.Configuration); err != nil {
		return Pricing{}, err
	}
	if len(value.Rules) < 6 || len(value.Rules) > 500 {
		return Pricing{}, problem.Invalid()
	}
	seen := make(map[string]bool, len(value.Rules))
	for _, rule := range value.Rules {
		if !validQuality(rule.Quality) || !validOperation(rule.Operation) || rule.CreditsPerImage < 0 || rule.CreditsPerImage > 1_000_000_000 || (rule.ModelID != nil && *rule.ModelID == uuid.Nil) {
			return Pricing{}, problem.Invalid()
		}
		model := "global"
		if rule.ModelID != nil {
			model = rule.ModelID.String()
		}
		key := model + ":" + rule.Operation + ":" + rule.Quality
		if seen[key] {
			return Pricing{}, problem.Invalid()
		}
		seen[key] = true
	}
	for _, op := range []string{"generate", "edit"} {
		for _, quality := range []string{"low", "medium", "high"} {
			if !seen["global:"+op+":"+quality] {
				return Pricing{}, problem.Invalid()
			}
		}
	}
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		if err := q.LockCreditConfiguration(ctx); err != nil {
			return fmt.Errorf("lock pricing update: %w", err)
		}
		var before Pricing
		if err := readPricing(ctx, q, &before); err != nil {
			return err
		}
		if err := q.ClearPricingRules(ctx); err != nil {
			return fmt.Errorf("replace pricing rules: %w", err)
		}
		for _, rule := range value.Rules {
			id, err := validation.NewID()
			if err != nil {
				return err
			}
			if err := q.CreatePricingRule(ctx, query.CreatePricingRuleParams{ID: id, ModelID: rule.ModelID, Operation: rule.Operation, Quality: rule.Quality, CreditsPerImage: rule.CreditsPerImage, Enabled: rule.Enabled}); err != nil {
				return fmt.Errorf("save pricing rule: %w", err)
			}
		}
		encoded, err := json.Marshal(value.Configuration)
		if err != nil {
			return fmt.Errorf("encode credit configuration: %w", err)
		}
		if err := q.SaveSetting(ctx, query.SaveSettingParams{Key: "credits", Value: encoded, UpdatedBy: &actor.ID}); err != nil {
			return fmt.Errorf("save credit configuration: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "credits.pricing_update", TargetType: "pricing", Before: before, After: value, IP: actor.IP})
	})
	if err == nil {
		s.configMu.Lock()
		s.readConfigUntil = time.Time{}
		s.configMu.Unlock()
	}
	return value, err
}
func price(ctx context.Context, q *query.Queries, cfg Configuration, input QuoteInput) (Quote, error) {
	if !validQuality(input.Quality) || !validOperation(input.Operation) || !validSize(input.Size) || input.Count < 1 || input.Count > 10 || (input.ModelID != nil && *input.ModelID == uuid.Nil) {
		return Quote{}, problem.Invalid()
	}
	rule, err := q.GetEffectivePricing(ctx, query.GetEffectivePricingParams{ModelID: input.ModelID, Operation: input.Operation, Quality: input.Quality})
	if err == pgx.ErrNoRows {
		return Quote{}, problem.New("PRICE_UNAVAILABLE", http.StatusConflict)
	}
	if err != nil {
		return Quote{}, fmt.Errorf("resolve pricing rule: %w", err)
	}
	if !rule.Enabled {
		return Quote{}, problem.New("PRICE_UNAVAILABLE", http.StatusConflict)
	}
	amount := big.NewRat(rule.CreditsPerImage, 1)
	if input.Operation == "edit" {
		factor, err := multiplier(cfg.EditMultiplier)
		if err != nil {
			return Quote{}, err
		}
		amount.Mul(amount, factor)
	}
	if text, exists := cfg.SizeMultipliers[input.Size]; exists {
		factor, err := multiplier(text)
		if err != nil {
			return Quote{}, err
		}
		amount.Mul(amount, factor)
	}
	rounded, remainder := new(big.Int).QuoRem(amount.Num(), amount.Denom(), new(big.Int))
	if remainder.Sign() != 0 {
		rounded.Add(rounded, big.NewInt(1))
	}
	if !rounded.IsInt64() || rounded.Int64() > MaxBalance/input.Count {
		return Quote{}, problem.Invalid()
	}
	return Quote{UnitPrice: rounded.Int64(), TotalCost: rounded.Int64() * input.Count, Count: input.Count}, nil
}
func (s *Service) Quote(ctx context.Context, input QuoteInput) (Quote, error) {
	var result Quote
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := q.ReadCreditConfigurationLock(ctx); err != nil {
			return fmt.Errorf("lock quote configuration: %w", err)
		}
		cfg, err := configuration(ctx, q)
		if err != nil {
			return err
		}
		result, err = price(ctx, q, cfg, input)
		return err
	})
	return result, err
}
