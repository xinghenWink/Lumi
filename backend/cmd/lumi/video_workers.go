package main

import (
	"context"
	"github.com/xinghenWink/Lumi/backend/internal/videos"
)

func startVideoWorkers(ctx context.Context, service *videos.Service) func() {
	work, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() { defer close(done); service.Run(work) }()
	return func() { cancel(); <-done }
}
