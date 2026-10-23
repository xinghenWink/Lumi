package jobs

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"net/netip"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
)

type Lease interface {
	AcquireJob(context.Context, string, string) (bool, error)
	ReleaseJob(context.Context, string, string) error
}
type Service struct {
	pool   *pgxpool.Pool
	gate   Lease
	logger *slog.Logger
}

func New(pool *pgxpool.Pool, gate Lease, logger *slog.Logger) *Service {
	return &Service{pool: pool, gate: gate, logger: logger}
}
func (s *Service) Tick(ctx context.Context) error {
	token := rand.Text()
	ok, err := s.gate.AcquireJob(ctx, "maintenance", token)
	if err != nil {
		return err
	}
	if !ok {
		return nil
	}
	defer func() {
		release, stop := context.WithTimeout(context.WithoutCancel(ctx), time.Second)
		defer stop()
		if err := s.gate.ReleaseJob(release, "maintenance", token); err != nil {
			s.logger.Error("release maintenance lease failed")
		}
	}()
	work, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	return db.Transaction(work, s.pool, func(q *query.Queries) error {
		run, err := q.GetJobRun(work, "reconciliation")
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("read reconciliation schedule: %w", err)
		}
		if errors.Is(err, pgx.ErrNoRows) || run.CompletedAt.UTC().Format(time.DateOnly) != time.Now().UTC().Format(time.DateOnly) {
			rows, err := q.CreditDiscrepancies(work)
			if err != nil {
				return fmt.Errorf("reconcile credit accounts: %w", err)
			}
			for _, r := range rows {
				if err := audit.Write(work, q, audit.Entry{Action: "credits.reconciliation_alert", TargetType: "user", TargetID: &r.UserID, After: r, IP: netip.MustParseAddr("127.0.0.1")}); err != nil {
					return err
				}
			}
			if err := q.RecordJobRun(work, query.RecordJobRunParams{Name: "reconciliation", Affected: int64(len(rows))}); err != nil {
				return fmt.Errorf("save reconciliation run: %w", err)
			}
		}
		run, err = q.GetJobRun(work, "auth_cleanup")
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("read cleanup schedule: %w", err)
		}
		if errors.Is(err, pgx.ErrNoRows) || time.Since(run.CompletedAt) >= time.Hour {
			for _, clean := range []func(context.Context) error{q.CleanupAuthArtifacts, q.CleanupVerificationArtifacts, q.CleanupSessions} {
				if err := clean(work); err != nil {
					return fmt.Errorf("clean expired authentication: %w", err)
				}
			}
			rows, err := q.DueSelfDeletedUsers(work)
			if err != nil {
				return fmt.Errorf("list self deleted accounts: %w", err)
			}
			for _, row := range rows {
				if err := q.PurgeSelfDeletedUser(work, row.ID); err != nil {
					return fmt.Errorf("purge self deleted account: %w", err)
				}
				if err := audit.Write(work, q, audit.Entry{Action: "user.purge", TargetType: "user", TargetID: &row.ID, IP: netip.MustParseAddr("127.0.0.1")}); err != nil {
					return err
				}
			}
			if err := q.RecordJobRun(work, query.RecordJobRunParams{Name: "auth_cleanup", Affected: int64(len(rows))}); err != nil {
				return fmt.Errorf("save cleanup run: %w", err)
			}
		}
		return nil
	})
}
func (s *Service) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		if err := s.Tick(ctx); err != nil && ctx.Err() == nil {
			s.logger.ErrorContext(ctx, "scheduled maintenance failed")
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
