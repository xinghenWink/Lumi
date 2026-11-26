package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xinghenWink/Lumi/backend/internal/deployment"
	"github.com/xinghenWink/Lumi/backend/internal/http/account"
	platformredis "github.com/xinghenWink/Lumi/backend/internal/platform/redis"
)

type deploymentGate struct{ open atomic.Bool }

func (g *deploymentGate) wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if g.open.Load() || r.Method == http.MethodGet && (r.URL.Path == "/readyz" || r.URL.Path == "/healthz" || r.URL.Path == "/api/version") {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Retry-After", "2")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		http.Error(w, `{"code":"MAINTENANCE"}`, http.StatusServiceUnavailable)
	})
}

func awaitDeployment(ctx context.Context, store *deployment.Store) error {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		probe, cancel := context.WithTimeout(ctx, 2*time.Second)
		blocked, err := store.TrafficBlocked(probe)
		cancel()
		if err == nil && !blocked {
			return nil
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("wait for deployment completion: %w", ctx.Err())
		case <-ticker.C:
		}
	}
}

func runApplicationWorkers(ctx context.Context, accounts *account.Services, database *pgxpool.Pool, cache *platformredis.Client, logger *slog.Logger) {
	defer startImageWorkers(ctx, accounts.Images)()
	if accounts.Videos != nil {
		defer startVideoWorkers(ctx, accounts.Videos)()
	}
	textDone := make(chan struct{})
	go func() { defer close(textDone); accounts.Canvas.WorkText(ctx, accounts.Chat, logger) }()
	defer func() { <-textDone }()
	defer accounts.Chat.EnableResume(ctx, cache)()
	defer startOperationJobs(ctx, database, cache, logger)()
	defer startUserMaintenance(ctx, accounts.Users, logger)()
	defer startCallMaintenance(ctx, accounts.Catalog, logger)()
	defer startChatMaintenance(ctx, accounts.Chat, logger)()
	<-ctx.Done()
}
