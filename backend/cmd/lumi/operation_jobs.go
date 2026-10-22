package main

import (
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xinghenWink/Lumi/backend/internal/jobs"
	platformredis "github.com/xinghenWink/Lumi/backend/internal/platform/redis"
	"log/slog"
)

func startOperationJobs(ctx context.Context, pool *pgxpool.Pool, cache *platformredis.Client, logger *slog.Logger) func() {
	work, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() { defer close(done); jobs.New(pool, cache, logger).Run(work) }()
	return func() { cancel(); <-done }
}
