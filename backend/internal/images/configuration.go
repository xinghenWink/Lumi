package images

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

func configView(row query.ImageSetting) (Configuration, error) {
	result := Configuration{MaxN: row.MaxN, MaxReferences: row.MaxReferences, MaxUploadBytes: row.MaxUploadBytes, PerUserConcurrency: row.PerUserConcurrency, GlobalConcurrency: row.GlobalConcurrency, TimeoutSeconds: row.TimeoutSeconds, QueueTimeoutSeconds: row.QueueTimeoutSeconds, SplitRequests: row.SplitRequests, RetentionDays: row.RetentionDays, AdminCanViewContent: row.AdminCanViewContent, Version: row.Version}
	if err := json.Unmarshal(row.Sizes, &result.Sizes); err != nil {
		return result, fmt.Errorf("decode image sizes: %w", err)
	}
	if err := json.Unmarshal(row.RatioSizes, &result.RatioSizes); err != nil {
		return result, fmt.Errorf("decode image ratios: %w", err)
	}
	return result, nil
}
func (s *Service) Configuration(ctx context.Context) (Configuration, error) {
	row, err := s.q.GetImageSettings(ctx)
	if err != nil {
		return Configuration{}, fmt.Errorf("read image settings: %w", err)
	}
	return configView(row)
}
func validSize(size string) bool {
	if size == "auto" {
		return true
	}
	parts := strings.Split(size, "x")
	if len(parts) != 2 {
		return false
	}
	for _, part := range parts {
		n, err := strconv.Atoi(part)
		if err != nil || n < 64 || n > 8192 || strconv.Itoa(n) != part {
			return false
		}
	}
	return true
}
func validateConfiguration(c Configuration) error {
	if c.MaxN < 1 || c.MaxN > 4 || c.MaxReferences < 0 || c.MaxReferences > 4 || c.MaxUploadBytes < 1024 || c.MaxUploadBytes > 10<<20 || c.PerUserConcurrency < 1 || c.PerUserConcurrency > 20 || c.GlobalConcurrency < 1 || c.GlobalConcurrency > 20 || c.TimeoutSeconds < 5 || c.TimeoutSeconds > 600 || c.QueueTimeoutSeconds < 60 || c.QueueTimeoutSeconds > 86400 || c.RetentionDays < 0 || c.RetentionDays > 3650 || len(c.Sizes) < 1 || len(c.Sizes) > 20 || len(c.RatioSizes) > 7 || c.RatioSizes == nil {
		return problem.Invalid()
	}
	seen := map[string]bool{}
	for _, size := range c.Sizes {
		if !validSize(size) || seen[size] {
			return problem.Invalid()
		}
		seen[size] = true
	}
	for ratio, size := range c.RatioSizes {
		if !slices.Contains([]string{"1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"}, ratio) || size == "auto" || !seen[size] {
			return problem.Invalid()
		}
	}
	return nil
}
func (s *Service) SaveConfiguration(ctx context.Context, actor user.Actor, input Configuration) (Configuration, error) {
	if err := validateConfiguration(input); err != nil {
		return Configuration{}, err
	}
	sizes, err := json.Marshal(input.Sizes)
	if err != nil {
		return Configuration{}, fmt.Errorf("encode image sizes: %w", err)
	}
	ratios, err := json.Marshal(input.RatioSizes)
	if err != nil {
		return Configuration{}, fmt.Errorf("encode image ratios: %w", err)
	}
	var result Configuration
	err = db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		old, err := q.GetImageSettings(ctx)
		if err != nil {
			return fmt.Errorf("read changed image settings: %w", err)
		}
		row, err := q.SaveImageSettings(ctx, query.SaveImageSettingsParams{MaxN: input.MaxN, MaxReferences: input.MaxReferences, MaxUploadBytes: input.MaxUploadBytes, Sizes: sizes, RatioSizes: ratios, PerUserConcurrency: input.PerUserConcurrency, GlobalConcurrency: input.GlobalConcurrency, TimeoutSeconds: input.TimeoutSeconds, QueueTimeoutSeconds: input.QueueTimeoutSeconds, SplitRequests: input.SplitRequests, RetentionDays: input.RetentionDays, AdminCanViewContent: input.AdminCanViewContent, Version: input.Version})
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.New("CONFIGURATION_CONFLICT", 409)
		}
		if err != nil {
			return fmt.Errorf("save image settings: %w", err)
		}
		result, err = configView(row)
		if err != nil {
			return err
		}
		before, err := configView(old)
		if err != nil {
			return err
		}
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "settings.update", TargetType: "image", Before: before, After: result, IP: actor.IP})
	})
	return result, err
}
