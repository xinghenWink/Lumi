//go:build integration

package integration_test

import (
	"context"
	"errors"
	"net/http"
	"os"
	"reflect"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/xinghenWink/Lumi/backend/internal/credits"
	"github.com/xinghenWink/Lumi/backend/internal/images"
	"github.com/xinghenWink/Lumi/backend/internal/user"
	"github.com/xinghenWink/Lumi/backend/migrations"
)

func TestImagePresetsUpgrade(t *testing.T) {
	legacyUserID := uuid.New()
	legacyChargeID := uuid.New()
	f := accountFixtureWithMigrations(t, func(ctx context.Context, pool *pgxpool.Pool) (result error) {
		conn := stdlib.OpenDB(*pool.Config().ConnConfig)
		defer func() { result = errors.Join(result, conn.Close()) }()
		p, err := goose.NewProvider(goose.DialectPostgres, conn, os.DirFS("../../../migrations"),
			goose.WithTableName("public.goose_db_version"), goose.WithDisableGlobalRegistry(true))
		if err != nil {
			return err
		}
		if _, err := p.UpTo(ctx, 12); err != nil {
			return err
		}
		_, err = pool.Exec(ctx, `UPDATE image_settings SET sizes='["1024x1024","1440x1080"]', ratio_sizes='{"4:3":"1440x1080"}'`)
		if err != nil {
			return err
		}
		if _, err := p.UpTo(ctx, 18); err != nil {
			return err
		}
		if _, err := pool.Exec(ctx, `INSERT INTO users(id,email,password_hash,nickname) VALUES($1,'legacy@lumi.test','unused','Legacy')`, legacyUserID); err != nil {
			return err
		}
		if _, err := pool.Exec(ctx, `INSERT INTO user_preferences(user_id) VALUES($1)`, legacyUserID); err != nil {
			return err
		}
		if _, err := p.UpTo(ctx, 19); err != nil {
			return err
		}
		if _, err := pool.Exec(ctx, `UPDATE settings SET value = '{"size_multipliers":{"1024x1024":"1.25","1536x1024":"2.00","2048x2048":"3.00","auto":"4.00"},"signup_bonus_credits":31,"daily_free_credits":14,"credits_timezone":"Asia/Shanghai","edit_multiplier":"1.125"}' WHERE key = 'credits'`); err != nil {
			return err
		}
		if _, err := pool.Exec(ctx, "UPDATE pricing_rules SET credits_per_image = 19 WHERE operation = 'edit' AND quality = 'low'"); err != nil {
			return err
		}
		if _, err := pool.Exec(ctx, `INSERT INTO credit_charges
(id,user_id,reference_id,operation,quality,size,image_count,unit_price,total_cost,daily_charged,permanent_charged,daily_reset_on)
VALUES ($1,$2,$3,'edit','low','1536x1024',2,43,86,0,86,current_date)`, legacyChargeID, legacyUserID, uuid.New()); err != nil {
			return err
		}
		return migrations.Up(ctx, pool)
	})
	client := f.client(t)
	token := f.login(t, client, f.adminEmail, f.adminPassword).AccessToken
	pricingPath := "/api/v1/admin/pricing"
	pricing := decodeReply[credits.Pricing](t, f.call(t, client, http.MethodGet, pricingPath, token, nil))
	expected := credits.Configuration{
		SizeMultipliers:             map[string]string{"1k": "1.00", "2k": "1.00", "4k": "1.00"},
		SignupBonusCredits:          31,
		ReferralInviterBonusCredits: new(int64),
		ReferralInviteeBonusCredits: new(int64),
		DailyFreeCredits:            14,
		CreditsTimezone:             "Asia/Shanghai",
		EditMultiplier:              "1.125",
	}
	if !reflect.DeepEqual(pricing.Configuration, expected) {
		t.Fatalf("migration changed unexpected pricing settings: %+v", pricing.Configuration)
	}
	for _, rule := range pricing.Rules {
		if rule.Operation == "edit" && rule.Quality == "low" && rule.CreditsPerImage != 19 {
			t.Fatalf("migration changed the price rule: %+v", rule)
		}
	}
	var unitPrice, totalCost int64
	if err := f.pool.QueryRow(f.ctx, "SELECT unit_price, total_cost FROM credit_charges WHERE id=$1", legacyChargeID).Scan(&unitPrice, &totalCost); err != nil || unitPrice != 43 || totalCost != 86 {
		t.Fatalf("migration changed historical pricing: unit=%d total=%d error=%v", unitPrice, totalCost, err)
	}
	for _, invalid := range []map[string]string{
		{"1k": "1", "2k": "1"}, {"1k": "1", "2k": "1", "1024x1024": "1"}, {"1k": "1", "2k": "1", "4k": "100.0001"},
	} {
		pricing.Configuration.SizeMultipliers = invalid
		expectStatus(t, f.call(t, client, http.MethodPut, pricingPath, token, pricing), http.StatusBadRequest)
	}
	legacyPreferences, err := f.services.Users.Preferences(f.ctx, legacyUserID)
	if err != nil || legacyPreferences.ImageRatio != "1:1" {
		t.Fatalf("upgrade changed the saved ratio: %+v, %v", legacyPreferences, err)
	}
	preferencesPath := "/api/v1/me/preferences"
	preferences := decodeReply[user.Preferences](t, f.call(t, client, http.MethodGet, preferencesPath, token, nil))
	if preferences.ImageRatio != "auto" {
		t.Fatalf("unexpected API default: %+v", preferences)
	}
	var storedDefault string
	err = f.pool.QueryRow(f.ctx, `INSERT INTO user_preferences(user_id) SELECT id FROM users WHERE email=$1 RETURNING image_ratio`, f.adminEmail).Scan(&storedDefault)
	if err != nil || storedDefault != "auto" {
		t.Fatalf("unexpected database default: %q, %v", storedDefault, err)
	}
	preferences.Theme = "dark"
	savedPreferences := decodeReply[user.Preferences](t, f.call(t, client, http.MethodPut, preferencesPath, token, preferences))
	if savedPreferences != preferences {
		t.Fatalf("auto preference did not round trip: %+v", savedPreferences)
	}
	path := "/api/v1/admin/image-settings"
	settings := decodeReply[images.Configuration](t, f.call(t, client, http.MethodGet, path, token, nil))
	if len(settings.ResolutionPresets) != 21 || len(settings.DisabledRatios) != 0 || len(settings.DisabledResolutions) != 0 {
		t.Fatalf("unexpected preset catalog or defaults: %+v", settings)
	}
	if !reflect.DeepEqual(settings.Sizes, []string{"1024x1024", "1440x1080"}) || settings.RatioSizes["4:3"] != "1440x1080" {
		t.Fatalf("migration changed custom sizes: %+v", settings)
	}
	settings.DisabledRatios, settings.DisabledResolutions = []string{"auto", "9:16"}, []string{"4k"}
	saved := decodeReply[images.Configuration](t, f.call(t, client, http.MethodPut, path, token, settings))
	if !reflect.DeepEqual(saved.DisabledRatios, settings.DisabledRatios) || !reflect.DeepEqual(saved.DisabledResolutions, settings.DisabledResolutions) {
		t.Fatal("the switch values were not persisted")
	}
	expectStatus(t, f.call(t, client, http.MethodPut, path, token, settings), 409)
	saved.DisabledRatios, saved.DisabledResolutions = nil, nil
	legacy := decodeReply[images.Configuration](t, f.call(t, client, http.MethodPut, path, token, saved))
	if !reflect.DeepEqual(legacy.DisabledRatios, settings.DisabledRatios) || !reflect.DeepEqual(legacy.DisabledResolutions, settings.DisabledResolutions) {
		t.Fatal("a legacy update cleared the switch values")
	}
	legacy.DisabledRatios, legacy.DisabledResolutions = []string{}, []string{}
	cleared := decodeReply[images.Configuration](t, f.call(t, client, http.MethodPut, path, token, legacy))
	if len(cleared.DisabledRatios) != 0 || len(cleared.DisabledResolutions) != 0 {
		t.Fatal("the switches could not be re-enabled")
	}
}
