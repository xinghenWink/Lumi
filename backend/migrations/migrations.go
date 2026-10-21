package migrations

import (
	"context"
	"embed"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"
)

// files is read-only; migration state belongs to a per-call Provider.
//
//go:embed *.sql
var files embed.FS

func Up(ctx context.Context, pool *pgxpool.Pool) (resultErr error) {
	// Keep migration sessions outside the application pool. Advisory locks and
	// migration connection state must remain owned by this Provider until close.
	sqlDB := stdlib.OpenDB(*pool.Config().ConnConfig)
	defer func() {
		if err := sqlDB.Close(); err != nil && resultErr == nil {
			resultErr = fmt.Errorf("close migration database: %w", err)
		}
	}()
	locker, err := lock.NewPostgresSessionLocker()
	if err != nil {
		return fmt.Errorf("create migration advisory lock: %w", err)
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, sqlDB, files,
		// M0 creates a schema named after the default role. An unqualified version
		// table can otherwise move from public to lumi during concurrent startup.
		goose.WithTableName("public.goose_db_version"),
		goose.WithSessionLocker(locker), goose.WithDisableGlobalRegistry(true))
	if err != nil {
		return fmt.Errorf("create migration provider: %w", err)
	}
	if _, err := provider.Up(ctx); err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}
	return nil
}
