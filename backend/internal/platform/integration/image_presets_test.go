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
	"github.com/xinghenWink/Lumi/backend/internal/images"
	"github.com/xinghenWink/Lumi/backend/internal/user"
	"github.com/xinghenWink/Lumi/backend/migrations"
)

func TestImagePresetsUpgrade(t *testing.T) {
	legacyUserID := uuid.New()
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
		return migrations.Up(ctx, pool)
	})
	client := f.client(t)
	token := f.login(t, client, f.adminEmail, f.adminPassword).AccessToken
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
