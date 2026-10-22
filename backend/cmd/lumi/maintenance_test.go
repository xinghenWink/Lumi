package main

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"
)

type purgeFunc func(context.Context, int32) (int, error)

func (f purgeFunc) PurgeDeleted(ctx context.Context, limit int32) (int, error) {
	return f(ctx, limit)
}

func TestAccountMaintenanceCancelsBeforeDatabaseShutdown(t *testing.T) {
	entered := make(chan struct{})
	finished := make(chan struct{})
	stop := startUserMaintenance(t.Context(), purgeFunc(func(ctx context.Context, _ int32) (int, error) {
		close(entered)
		<-ctx.Done()
		close(finished)
		return 0, ctx.Err()
	}), slog.New(slog.NewJSONHandler(io.Discard, nil)))
	defer stop()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("retention maintenance did not start")
	}
	stop()
	select {
	case <-finished:
	default:
		t.Fatal("maintenance stop returned before the database operation ended")
	}
}
