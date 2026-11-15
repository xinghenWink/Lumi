package deployment

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/netip"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

type Action string

const (
	Update   Action = "update"
	Rollback Action = "rollback"
)

type Stage string

const (
	Queued           Stage = "queued"
	Preflight        Stage = "preflight"
	Stopping         Stage = "stopping"
	Backup           Stage = "backup"
	Switching        Stage = "switching"
	Verifying        Stage = "verifying"
	Reverting        Stage = "reverting"
	Succeeded        Stage = "succeeded"
	Failed           Stage = "failed"
	RolledBack       Stage = "rolled_back"
	RecoveryRequired Stage = "recovery_required"
)

func (s Stage) terminal() bool {
	switch s {
	case Succeeded, Failed, RolledBack, RecoveryRequired:
		return true
	default:
		return false
	}
}

type Identity struct {
	Version  string
	Commit   string
	Digest   string
	Platform string
	Schema   int64
}

type ExecutorStatus struct {
	Identity
	Reason string
	Online bool
}

type Request struct {
	Action        Action `json:"action"`
	TargetVersion string `json:"target_version"`
	CurrentDigest string `json:"expected_current_digest"`
}

type Job struct {
	ID            uuid.UUID  `json:"id"`
	Action        Action     `json:"action"`
	SourceVersion string     `json:"source_version"`
	SourceDigest  string     `json:"source_digest"`
	TargetVersion string     `json:"target_version"`
	TargetDigest  string     `json:"target_digest"`
	Stage         Stage      `json:"stage"`
	Reason        string     `json:"reason"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
	FinishedAt    *time.Time `json:"finished_at"`

	actorID uuid.UUID
	actorIP netip.Addr
}

type ExecutionPlan struct {
	Source        Manifest `json:"source"`
	Target        Manifest `json:"target"`
	InitialSchema int64    `json:"initial_schema"`
	Platform      string   `json:"platform"`
}

const jobFields = `id, action, source_version, source_digest, target_version, target_digest,
	stage, reason, created_at, updated_at, finished_at, actor_id, actor_ip`

type Store struct{ pool *pgxpool.Pool }

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

func (s *Store) Status(ctx context.Context) (ExecutorStatus, error) {
	return readStatus(ctx, s.pool)
}

func readStatus(ctx context.Context, db interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}) (ExecutorStatus, error) {
	var status ExecutorStatus
	err := db.QueryRow(ctx, `SELECT version, commit_sha, digest, platform, schema_version, reason,
		checked_at > now() - interval '20 seconds' FROM deployment_executor WHERE singleton`).Scan(
		&status.Version, &status.Commit, &status.Digest, &status.Platform, &status.Schema, &status.Reason, &status.Online)
	if errors.Is(err, pgx.ErrNoRows) {
		return ExecutorStatus{}, nil
	}
	if err != nil {
		return ExecutorStatus{}, fmt.Errorf("read deployment executor status: %w", err)
	}
	return status, nil
}

func (s *Store) PublishStatus(ctx context.Context, status ExecutorStatus) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO deployment_executor
		(singleton, version, commit_sha, digest, platform, schema_version, reason, checked_at)
		VALUES (true, $1, $2, $3, $4, $5, $6, now()) ON CONFLICT (singleton)
		DO UPDATE SET version=excluded.version, commit_sha=excluded.commit_sha, digest=excluded.digest,
		platform=excluded.platform, schema_version=excluded.schema_version, reason=excluded.reason, checked_at=now()`,
		status.Version, status.Commit, status.Digest, status.Platform, status.Schema, status.Reason)
	if err != nil {
		return fmt.Errorf("publish deployment executor status: %w", err)
	}
	return nil
}

func (s *Store) Schema(ctx context.Context) (int64, error) {
	var version int64
	if err := s.pool.QueryRow(ctx, `SELECT version_id FROM public.goose_db_version
		WHERE is_applied ORDER BY id DESC LIMIT 1`).Scan(&version); err != nil {
		return 0, fmt.Errorf("read applied deployment schema: %w", err)
	}
	return version, nil
}

func scanJob(row pgx.Row) (*Job, error) {
	var job Job
	err := row.Scan(&job.ID, &job.Action, &job.SourceVersion, &job.SourceDigest, &job.TargetVersion,
		&job.TargetDigest, &job.Stage, &job.Reason, &job.CreatedAt, &job.UpdatedAt, &job.FinishedAt,
		&job.actorID, &job.actorIP)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read deployment job: %w", err)
	}
	return &job, nil
}

func (s *Store) Get(ctx context.Context, id uuid.UUID) (*Job, error) {
	return scanJob(s.pool.QueryRow(ctx, "SELECT "+jobFields+" FROM deployment_jobs WHERE id=$1", id))
}

func (s *Store) Recent(ctx context.Context) (*Job, error) {
	return scanJob(s.pool.QueryRow(ctx, "SELECT "+jobFields+` FROM deployment_jobs
		ORDER BY (finished_at IS NULL OR stage='recovery_required') DESC, created_at DESC, id DESC LIMIT 1`))
}

func (s *Store) Active(ctx context.Context) (*Job, error) {
	return scanJob(s.pool.QueryRow(ctx, "SELECT "+jobFields+` FROM deployment_jobs
		WHERE finished_at IS NULL OR stage='recovery_required' LIMIT 1`))
}

// TrafficBlocked also holds a candidate's writes while the host is verifying it.
func (s *Store) TrafficBlocked(ctx context.Context) (bool, error) {
	var blocked bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM deployment_jobs
		WHERE stage IN ('stopping','backup','switching','verifying','reverting','recovery_required'))`).Scan(&blocked); err != nil {
		return false, fmt.Errorf("check deployment traffic gate: %w", err)
	}
	return blocked, nil
}

func findReplay(ctx context.Context, db interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, owner uuid.UUID, key uuid.UUID, request Request) (*Job, error) {
	job, err := scanJob(db.QueryRow(ctx, "SELECT "+jobFields+
		" FROM deployment_jobs WHERE actor_id=$1 AND idempotency_key=$2", owner, key.String()))
	if err != nil || job == nil {
		return job, err
	}
	if request.Action != job.Action || request.TargetVersion != job.TargetVersion || request.CurrentDigest != job.SourceDigest {
		return nil, conflict("DEPLOYMENT_CHANGED")
	}
	return job, nil
}

func (s *Store) enqueue(ctx context.Context, actor user.Actor, key uuid.UUID, request Request, source Identity, target Manifest) (*Job, error) {
	var job *Job
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := query.New(tx)
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		var err error
		job, err = findReplay(ctx, tx, actor.ID, key, request)
		if err != nil || job != nil {
			return err
		}
		status, err := readStatus(ctx, tx)
		if err != nil {
			return err
		}
		if !status.Online || status.Reason != "" || status.Identity != source {
			return conflict("DEPLOYMENT_CHANGED")
		}
		id, err := validation.NewID()
		if err != nil {
			return err
		}
		job, err = scanJob(tx.QueryRow(ctx, `INSERT INTO deployment_jobs
			(id, actor_id, actor_ip, idempotency_key, action, source_version, source_digest, target_version, target_digest, stage)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued') RETURNING `+jobFields,
			id, actor.ID, actor.IP, key.String(), request.Action, source.Version, source.Digest, target.Version, target.Digest))
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.ConstraintName == "deployment_jobs_one_operation" {
				return conflict("DEPLOYMENT_BUSY")
			}
			return err
		}
		return writeAudit(ctx, q, job, "deployment.requested")
	})
	if err != nil {
		return nil, fmt.Errorf("enqueue deployment job: %w", err)
	}
	return job, nil
}

func (s *Store) advance(ctx context.Context, job *Job, next Stage, reason string) error {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		nextJob, err := scanJob(tx.QueryRow(ctx, `UPDATE deployment_jobs SET
			stage=$1, reason=$2, updated_at=now(),
			finished_at=CASE WHEN $3 THEN now() ELSE NULL END
			WHERE id=$4 AND stage=$5 RETURNING `+jobFields, next, reason, next.terminal(), job.ID, job.Stage))
		if err != nil {
			return err
		}
		if nextJob == nil {
			return fmt.Errorf("deployment job stage changed")
		}
		if next.terminal() {
			return writeAudit(ctx, query.New(tx), nextJob, "deployment."+string(next))
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("advance deployment job: %w", err)
	}
	return nil
}

func writeAudit(ctx context.Context, q *query.Queries, job *Job, action string) error {
	return audit.Write(ctx, q, audit.Entry{
		ActorID: &job.actorID, IP: job.actorIP, TargetType: "deployment_job", TargetID: &job.ID, Action: action,
		Before: map[string]string{"version": job.SourceVersion, "digest": job.SourceDigest},
		After: map[string]string{"version": job.TargetVersion, "digest": job.TargetDigest,
			"action": string(job.Action), "stage": string(job.Stage), "reason": job.Reason},
	})
}

func conflict(code string) error { return problem.New(code, http.StatusConflict) }
