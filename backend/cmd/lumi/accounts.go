package main

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/auth"
	"github.com/xinghenWink/Lumi/backend/internal/catalog"
	"github.com/xinghenWink/Lumi/backend/internal/chat"
	"github.com/xinghenWink/Lumi/backend/internal/config"
	"github.com/xinghenWink/Lumi/backend/internal/credits"
	"github.com/xinghenWink/Lumi/backend/internal/http/account"
	"github.com/xinghenWink/Lumi/backend/internal/platform/mailer"
	"github.com/xinghenWink/Lumi/backend/internal/platform/password"
	platformredis "github.com/xinghenWink/Lumi/backend/internal/platform/redis"
	"github.com/xinghenWink/Lumi/backend/internal/platform/secrets"
	"github.com/xinghenWink/Lumi/backend/internal/settings"
	"github.com/xinghenWink/Lumi/backend/internal/upstream"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

func configureAccounts(ctx context.Context, cfg config.Config, pool *pgxpool.Pool, cache *platformredis.Client, logger *slog.Logger) (*account.Services, error) {
	if pool == nil || cache == nil {
		return nil, nil
	}
	if err := cfg.ValidateAccounts(); err != nil {
		return nil, fmt.Errorf("validate account configuration: %w", err)
	}
	passwords, err := password.New(ctx)
	if err != nil {
		return nil, err
	}
	tokens, err := auth.NewTokens([]byte(cfg.JWTSecret))
	if err != nil {
		return nil, err
	}
	vault, err := secrets.New(cfg.EncryptionKey)
	if err != nil {
		return nil, err
	}
	configuration := settings.New(pool, vault, cfg.Environment, cfg.SettingsOverrides)
	if _, err := configuration.Read(ctx); err != nil {
		return nil, fmt.Errorf("load initial account settings: %w", err)
	}
	billing := credits.New(pool, vault, cache, nil)
	users := user.New(pool, passwords, billing)
	if err := users.Bootstrap(ctx, cfg.AdminEmail, cfg.AdminPassword, cfg.Environment == "production"); err != nil {
		return nil, fmt.Errorf("bootstrap administrator: %w", err)
	}
	sender := mailer.New(configuration, cfg.Environment, logger)
	models := catalog.New(pool, vault, upstream.NetworkPolicy{AllowPrivate: cfg.UpstreamAllowPrivate}, logger)
	return &account.Services{Auth: auth.New(pool, passwords, tokens, configuration, cache, sender, billing), Users: users, Settings: configuration, Audit: audit.New(pool), Gate: cache, Credits: billing, Catalog: models, Chat: chat.New(pool, models, cache)}, nil
}
