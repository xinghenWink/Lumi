package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Open(ctx context.Context, connectionURL string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(connectionURL)
	if err != nil {
		// pgx parse errors can contain the original URL; do not expose them.
		return nil, fmt.Errorf("invalid PostgreSQL connection configuration")
	}
	cfg.MaxConns = 20
	cfg.MinConns = 1
	cfg.MaxConnLifetime = 30 * time.Minute
	cfg.ConnConfig.ConnectTimeout = 5 * time.Second
	// Keep business queries in the same schema even when POSTGRES_USER changes.
	cfg.ConnConfig.RuntimeParams["search_path"] = "lumi,public"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create PostgreSQL pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping PostgreSQL: %w", err)
	}
	return pool, nil
}
