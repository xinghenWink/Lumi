package main

import (
	"context"
	"log/slog"
	"time"
)

type callPurger interface {
	PurgeCalls(context.Context) (int64, error)
}

// Row-level SKIP LOCKED permits independent instances to clean disjoint batches.
func startCallMaintenance(ctx context.Context, calls callPurger, logger *slog.Logger) func() {
	worker, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			cleanup, stop := context.WithTimeout(worker, 30*time.Second)
			for {
				count, err := calls.PurgeCalls(cleanup)
				if err != nil {
					if worker.Err() == nil {
						logger.ErrorContext(worker, "upstream call retention cleanup failed")
					}
					break
				}
				if count < 1000 {
					break
				}
			}
			stop()
			select {
			case <-worker.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	return func() { cancel(); <-done }
}
