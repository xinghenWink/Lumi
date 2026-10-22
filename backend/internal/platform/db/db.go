package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
)

func Open(ctx context.Context, connectionURL string) (*pgxpool.Pool, error) {
	return open(ctx, connectionURL, nil)
}

// OpenPrepared is called only after migrations, so descriptions use the final schema.
func OpenPrepared(ctx context.Context, connectionURL string) (*pgxpool.Pool, error) {
	return open(ctx, connectionURL, query.PrepareLatencyQueries)
}

func open(ctx context.Context, connectionURL string, prepare func(context.Context, *pgx.Conn) error) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(connectionURL)
	if err != nil {
		// pgx parse errors can contain the original URL; do not expose them.
		return nil, fmt.Errorf("invalid PostgreSQL connection configuration")
	}
	cfg.MaxConns = 16
	cfg.MinConns = 16
	cfg.MaxConnLifetime = 30 * time.Minute
	cfg.MaxConnLifetimeJitter = 5 * time.Minute
	cfg.ConnConfig.ConnectTimeout = 5 * time.Second
	cfg.AfterConnect = prepare
	// Keep business queries in the same schema even when POSTGRES_USER changes.
	cfg.ConnConfig.RuntimeParams["search_path"] = "lumi,public"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create PostgreSQL pool: %w", err)
	}
	// Prepare authenticated connections before admitting a concurrent request burst.
	connections := make([]*pgxpool.Conn, 0, cfg.MinConns)
	for range cfg.MinConns {
		connection, err := pool.Acquire(ctx)
		if err != nil {
			for _, acquired := range connections {
				acquired.Release()
			}
			pool.Close()
			return nil, fmt.Errorf("prepare PostgreSQL pool: %w", err)
		}
		connections = append(connections, connection)
	}
	for _, connection := range connections {
		connection.Release()
	}
	return pool, nil
}
