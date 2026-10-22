package main

import (
	"context"
	"log/slog"
	"time"
)

type accountPurger interface {
	PurgeDeleted(context.Context, int32) (int, error)
}

// startUserMaintenance owns its worker lifetime so the database stays open until
// cancellation has finished rolling back any in-flight retention transaction.
func startUserMaintenance(ctx context.Context, users accountPurger, logger *slog.Logger) func() {
	worker, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			cleanup, stop := context.WithTimeout(worker, 30*time.Second)
			total := 0
			for {
				count, err := users.PurgeDeleted(cleanup, 100)
				if err != nil {
					if worker.Err() == nil {
						logger.ErrorContext(worker, "account retention cleanup failed")
					}
					break
				}
				total += count
				if count < 100 {
					break
				}
			}
			stop()
			if total > 0 {
				logger.InfoContext(worker, "expired accounts purged", "count", total)
			}
			select {
			case <-worker.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	return func() { cancel(); <-done }
}
