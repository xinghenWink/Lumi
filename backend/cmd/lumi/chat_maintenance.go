package main

import (
	"context"
	"github.com/xinghenWink/Lumi/backend/internal/chat"
	"log/slog"
	"time"
)

func startChatMaintenance(ctx context.Context, service *chat.Service, logger *slog.Logger) func() {
	work, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			attempt, stop := context.WithTimeout(work, 5*time.Second)
			err := service.Recover(attempt)
			stop()
			if err != nil && work.Err() == nil {
				logger.Error("chat recovery failed", "error_type", "maintenance")
			}
			select {
			case <-work.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	return func() { cancel(); <-done }
}
