package credits

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

type VideoRate struct {
	Resolution string `json:"resolution"`
	Duration   int    `json:"duration_seconds,omitempty"`
	HasVideo   bool   `json:"has_video_reference"`
	Credits    int64  `json:"credits"`
}

type VideoPricing struct {
	ModelID uuid.UUID   `json:"model_id"`
	Mode    string      `json:"mode"`
	Rates   []VideoRate `json:"rates"`
	Version int64       `json:"version"`
}

type VideoPool struct {
	Pool    string `json:"pool"`
	Version int64  `json:"version"`
}

type VideoQuote struct {
	Pool           string `json:"pool"`
	Mode           string `json:"mode"`
	UnitPrice      int64  `json:"unit_price"`
	TotalCost      int64  `json:"total_cost"`
	Count          int    `json:"count"`
	PricingVersion int64  `json:"pricing_version"`
	PoolVersion    int64  `json:"pool_version"`
}

func (s *Service) VideoPool(ctx context.Context) (VideoPool, error) {
	row, err := s.queries.GetVideoCreditSettings(ctx)
	if err != nil {
		return VideoPool{}, fmt.Errorf("read video credit pool: %w", err)
	}
	return VideoPool{Pool: row.Pool, Version: row.Version}, nil
}

func (s *Service) SaveVideoPool(ctx context.Context, actor user.Actor, input VideoPool) (VideoPool, error) {
	if input.Pool != "video" && input.Pool != "permanent" {
		return VideoPool{}, problem.Invalid()
	}
	var view VideoPool
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		if err := q.LockCreditConfiguration(ctx); err != nil {
			return fmt.Errorf("lock video credit settings: %w", err)
		}
		row, err := q.SaveVideoCreditSettings(ctx, query.SaveVideoCreditSettingsParams{Pool: input.Pool, Version: input.Version})
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.New("CONFIGURATION_CONFLICT", 409)
		}
		if err != nil {
			return fmt.Errorf("save video credit pool: %w", err)
		}
		view = VideoPool{Pool: row.Pool, Version: row.Version}
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "credits.video_pool", TargetType: "settings", After: view, IP: actor.IP})
	})
	return view, err
}

func pricingView(row query.VideoPricing) (VideoPricing, error) {
	view := VideoPricing{ModelID: row.ModelID, Mode: row.Mode, Version: row.Version}
	if err := json.Unmarshal(row.Rates, &view.Rates); err != nil {
		return view, fmt.Errorf("decode video pricing: %w", err)
	}
	return view, nil
}

func (s *Service) VideoPricing(ctx context.Context, id uuid.UUID) (VideoPricing, error) {
	return ReadVideoPricing(ctx, s.queries, id)
}

func ReadVideoPricing(ctx context.Context, q *query.Queries, id uuid.UUID) (VideoPricing, error) {
	row, err := q.GetVideoPricing(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return VideoPricing{ModelID: id, Mode: "second", Rates: []VideoRate{}}, nil
	}
	if err != nil {
		return VideoPricing{}, fmt.Errorf("read video pricing: %w", err)
	}
	return pricingView(row)
}

func (s *Service) SaveVideoPricing(ctx context.Context, actor user.Actor, input VideoPricing) (VideoPricing, error) {
	if input.ModelID == uuid.Nil || (input.Mode != "second" && input.Mode != "clip") || len(input.Rates) > 360 {
		return VideoPricing{}, problem.Invalid()
	}
	if input.Rates == nil {
		input.Rates = []VideoRate{}
	}
	seen := make(map[struct {
		Resolution string
		Duration   int
		HasVideo   bool
	}]bool)
	for _, rate := range input.Rates {
		key := struct {
			Resolution string
			Duration   int
			HasVideo   bool
		}{rate.Resolution, rate.Duration, rate.HasVideo}
		if seen[key] || !slices.Contains([]string{"480p", "720p", "768p", "1080p", "2k", "4k"}, rate.Resolution) ||
			rate.Credits < 0 || rate.Credits > 1_000_000_000 ||
			(input.Mode == "second" && rate.Duration != 0) || (input.Mode == "clip" && (rate.Duration < 1 || rate.Duration > 30)) {
			return VideoPricing{}, problem.Invalid()
		}
		seen[key] = true
	}
	rates, err := json.Marshal(input.Rates)
	if err != nil {
		return VideoPricing{}, fmt.Errorf("encode video pricing: %w", err)
	}
	var view VideoPricing
	err = db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		if err := q.LockModelConfiguration(ctx); err != nil {
			return fmt.Errorf("lock video model pricing: %w", err)
		}
		if err := q.LockCreditConfiguration(ctx); err != nil {
			return fmt.Errorf("lock video pricing: %w", err)
		}
		model, err := q.GetPlatformModel(ctx, input.ModelID)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && model.Type != "video") {
			return problem.New("MODEL_NOT_FOUND", 404)
		}
		if err != nil {
			return fmt.Errorf("read video model for pricing: %w", err)
		}
		row, err := q.SaveVideoPricing(ctx, query.SaveVideoPricingParams{ModelID: input.ModelID, Mode: input.Mode, Rates: rates, ExpectedVersion: input.Version})
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.New("CONFIGURATION_CONFLICT", 409)
		}
		if err != nil {
			return fmt.Errorf("save video pricing: %w", err)
		}
		view, err = pricingView(row)
		if err != nil {
			return err
		}
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "credits.video_pricing", TargetType: "model", TargetID: &input.ModelID, After: view, IP: actor.IP})
	})
	return view, err
}

func (p VideoPricing) UnitPrice(resolution string, duration int, hasVideo bool) (int64, bool) {
	for _, rate := range p.Rates {
		if rate.Resolution == resolution && rate.HasVideo == hasVideo && (p.Mode == "second" || rate.Duration == duration) {
			price := rate.Credits
			if p.Mode == "second" {
				price *= int64(duration)
			}
			return price, true
		}
	}
	return 0, false
}

func QuoteVideo(ctx context.Context, q *query.Queries, model uuid.UUID, resolution string, duration, count int, hasVideo bool) (VideoQuote, error) {
	pricing, err := ReadVideoPricing(ctx, q, model)
	if err != nil {
		return VideoQuote{}, err
	}
	unit, ok := pricing.UnitPrice(resolution, duration, hasVideo)
	if !ok {
		return VideoQuote{}, problem.New("VIDEO_PRICE_UNAVAILABLE", 409)
	}
	cfg, err := q.GetVideoCreditSettings(ctx)
	if err != nil {
		return VideoQuote{}, fmt.Errorf("read charged video pool: %w", err)
	}
	return VideoQuote{Pool: cfg.Pool, Mode: pricing.Mode, UnitPrice: unit, TotalCost: unit * int64(count), Count: count, PricingVersion: pricing.Version, PoolVersion: cfg.Version}, nil
}

func (s *Service) ApplyVideoTx(ctx context.Context, q *query.Queries, owner, task uuid.UUID, pool string, delta int64, key string) error {
	if pool != "video" && pool != "permanent" {
		return problem.Invalid()
	}
	if _, err := q.LockCreditOwnerForSettlement(ctx, owner); err != nil {
		return fmt.Errorf("lock video credit owner: %w", err)
	}
	record, err := q.LockCreditAccount(ctx, owner)
	if err != nil {
		return fmt.Errorf("lock video balance: %w", err)
	}
	kind := "video_charge"
	if delta > 0 {
		kind = "video_refund"
	}
	return change(ctx, q, &record, kind, pool, delta, key, "video_task", &task, nil, "")
}
