package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/xinghenWink/Lumi/backend/internal/deployment"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:], logger); err != nil {
		// Never serialize docker output or database connection errors.
		logger.Error("Lumi deployment command failed", "error_type", fmt.Sprintf("%T", err))
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, logger *slog.Logger) (result error) {
	if len(args) == 0 {
		return fmt.Errorf("usage: lumi-updater <serve|status|resolve> [-dir /opt/lumi] [-project lumi]")
	}
	options := flag.NewFlagSet(args[0], flag.ContinueOnError)
	directory := options.String("dir", "/opt/lumi", "absolute path to the root-owned deployment")
	project := options.String("project", "lumi", "Compose project")
	if err := options.Parse(args[1:]); err != nil {
		return fmt.Errorf("parse deployment options: %w", err)
	}
	if options.NArg() != 0 {
		return fmt.Errorf("unexpected deployment options")
	}
	host, err := newCompose(*directory, *project)
	if err != nil {
		return err
	}
	pool, err := host.connect(ctx)
	if err != nil {
		return err
	}
	defer pool.Close()
	store := deployment.NewStore(pool)
	executor := deployment.NewExecutor(store, host)
	switch args[0] {
	case "serve":
		owner, err := host.lock(".deployment-executor.lock")
		if err != nil {
			return err
		}
		defer func() { result = errors.Join(result, owner.Close()) }()
		return serve(ctx, host, store, executor, logger)
	case "status":
		status, err := store.Status(ctx)
		if err != nil {
			return err
		}
		job, err := store.Recent(ctx)
		if err != nil {
			return err
		}
		if err := json.NewEncoder(os.Stdout).Encode(struct {
			Executor deployment.ExecutorStatus `json:"executor"`
			Job      *deployment.Job           `json:"job"`
		}{Executor: status, Job: job}); err != nil {
			return fmt.Errorf("print deployment status: %w", err)
		}
		return nil
	case "resolve":
		lock, err := host.lock(".deployment.lock")
		if err != nil {
			return err
		}
		defer func() { result = errors.Join(result, lock.Close()) }()
		return executor.Resolve(ctx)
	default:
		return fmt.Errorf("unknown deployment command")
	}
}

func serve(ctx context.Context, host *compose, store *deployment.Store, executor *deployment.Executor, logger *slog.Logger) (result error) {
	defer func() { result = errors.Join(result, host.unlockOperation()) }()
	failures := 0
	for {
		err := step(ctx, host, store, executor)
		if err != nil && ctx.Err() == nil && !errors.Is(err, syscall.EWOULDBLOCK) {
			logger.Warn("deployment step will be retried", "error_type", fmt.Sprintf("%T", err))
			failures++
			if failures >= 3 {
				return fmt.Errorf("reconnect the deployment executor: %w", err)
			}
		} else {
			failures = 0
		}
		timer := time.NewTimer(3 * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
	}
}

func step(ctx context.Context, host *compose, store *deployment.Store, executor *deployment.Executor) error {
	probe, cancel := context.WithTimeout(ctx, 5*time.Second)
	job, err := store.Active(probe)
	cancel()
	if err != nil {
		return err
	}
	switch {
	case job == nil || job.Stage == deployment.RecoveryRequired:
		if err := host.unlockOperation(); err != nil {
			return err
		}
	case host.operationLock == nil:
		lock, err := host.lock(".deployment.lock")
		if err != nil {
			return err
		}
		host.operationLock = lock
	}
	work, cancel := context.WithTimeout(ctx, 65*time.Minute)
	defer cancel()
	return executor.Step(work)
}

func (c *compose) unlockOperation() error {
	if c.operationLock == nil {
		return nil
	}
	file := c.operationLock
	c.operationLock = nil
	if err := file.Close(); err != nil {
		return fmt.Errorf("release deployment lock: %w", err)
	}
	return nil
}
