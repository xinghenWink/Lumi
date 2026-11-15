package deployment

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

const (
	ReasonUnsupported  = "DEPLOYMENT_UNSUPPORTED"
	ReasonChanged      = "DEPLOYMENT_CHANGED"
	ReasonUnverified   = "DEPLOYMENT_UNVERIFIED"
	ReasonPullFailed   = "DEPLOYMENT_PULL_FAILED"
	ReasonBackupFailed = "DEPLOYMENT_BACKUP_FAILED"
	ReasonStopFailed   = "DEPLOYMENT_STOP_FAILED"
	ReasonSwitchFailed = "DEPLOYMENT_SWITCH_FAILED"
	ReasonStartFailed  = "DEPLOYMENT_START_FAILED"
	ReasonRecovery     = "DEPLOYMENT_MANUAL_RECOVERY"
)

type Runtime interface {
	Identity(context.Context) (Identity, error)
	Prepare(context.Context, ExecutionPlan) error
	SavePlan(uuid.UUID, ExecutionPlan) error
	LoadPlan(uuid.UUID) (ExecutionPlan, error)
	Stop(context.Context, ExecutionPlan) error
	Backup(context.Context, uuid.UUID, ExecutionPlan) error
	Pin(context.Context, Manifest, Manifest) error
	Start(context.Context, Manifest, Manifest, string) error
}

type executorStore interface {
	PublishStatus(context.Context, ExecutorStatus) error
	Active(context.Context) (*Job, error)
	Schema(context.Context) (int64, error)
	advance(context.Context, *Job, Stage, string) error
}

type Executor struct {
	store   executorStore
	runtime Runtime
	resolve func(context.Context, Action, Identity, string, string) (ExecutionPlan, error)
}

func NewExecutor(store *Store, runtime Runtime) *Executor {
	return &Executor{store: store, runtime: runtime, resolve: NewReleases().resolve}
}

func (e *Executor) status(ctx context.Context) (ExecutorStatus, error) {
	identity, identityErr := e.runtime.Identity(ctx)
	schema, err := e.store.Schema(ctx)
	if err != nil {
		return ExecutorStatus{}, err
	}
	identity.Schema = schema
	status := ExecutorStatus{Identity: identity}
	if identityErr != nil || !Stable(identity.Version) || !ValidDigest(identity.Digest) {
		status.Reason = ReasonUnsupported
	}
	return status, nil
}

func (e *Executor) Step(ctx context.Context) error {
	job, err := e.store.Active(ctx)
	if err != nil {
		return err
	}
	if job == nil || job.Stage == RecoveryRequired {
		status, err := e.status(ctx)
		if err != nil {
			return err
		}
		return e.store.PublishStatus(ctx, status)
	}
	switch job.Stage {
	case Queued:
		return e.store.advance(ctx, job, Preflight, "")
	case Preflight:
		return e.prepare(ctx, job)
	default:
		return e.execute(ctx, job)
	}
}

func (e *Executor) prepare(ctx context.Context, job *Job) error {
	status, err := e.status(ctx)
	if err != nil {
		return err
	}
	if status.Reason != "" || status.Version != job.SourceVersion || status.Digest != job.SourceDigest {
		return e.store.advance(ctx, job, Failed, ReasonChanged)
	}
	plan, err := e.resolve(ctx, job.Action, status.Identity, job.TargetVersion, job.TargetDigest)
	if ctx.Err() != nil {
		return fmt.Errorf("resolve deployment: %w", ctx.Err())
	}
	if err != nil {
		return e.store.advance(ctx, job, Failed, ReasonUnverified)
	}
	if err := e.runtime.Prepare(ctx, plan); err != nil {
		return e.store.advance(ctx, job, Failed, ReasonPullFailed)
	}
	if err := e.runtime.SavePlan(job.ID, plan); err != nil {
		return fmt.Errorf("persist verified deployment plan: %w", err)
	}
	return e.store.advance(ctx, job, Stopping, "")
}

func (e *Executor) execute(ctx context.Context, job *Job) error {
	plan, err := e.runtime.LoadPlan(job.ID)
	if err != nil || !plan.matches(job) {
		return e.store.advance(ctx, job, RecoveryRequired, ReasonRecovery)
	}
	switch job.Stage {
	case Stopping:
		return e.next(ctx, job, Backup, ReasonStopFailed, e.runtime.Stop(ctx, plan))
	case Backup:
		return e.next(ctx, job, Switching, ReasonBackupFailed, e.runtime.Backup(ctx, job.ID, plan))
	case Switching:
		return e.next(ctx, job, Verifying, ReasonSwitchFailed, e.runtime.Pin(ctx, plan.Source, plan.Target))
	case Verifying:
		err := e.runtime.Start(ctx, plan.Source, plan.Target, plan.Platform)
		if err != nil {
			return e.next(ctx, job, Succeeded, ReasonStartFailed, err)
		}
		schema, err := e.store.Schema(ctx)
		if err != nil {
			// Verify again once the database is reachable. The candidate still holds traffic.
			return err
		}
		if schema != max(plan.InitialSchema, plan.Target.Schema) {
			return e.store.advance(ctx, job, Reverting, ReasonStartFailed)
		}
		return e.store.advance(ctx, job, Succeeded, "")
	case Reverting:
		return e.revert(ctx, job, plan)
	default:
		return fmt.Errorf("unexpected deployment job stage")
	}
}

func (p ExecutionPlan) matches(job *Job) bool {
	return p.Source.Validate(job.SourceVersion) == nil && p.Target.Validate(job.TargetVersion) == nil &&
		p.Source.Digest == job.SourceDigest && p.Target.Digest == job.TargetDigest &&
		allowed(job.Action, p.Source, p.Target, p.InitialSchema, p.Platform)
}

func (e *Executor) next(ctx context.Context, job *Job, next Stage, reason string, operationErr error) error {
	if ctx.Err() != nil {
		return fmt.Errorf("interrupt deployment stage: %w", ctx.Err())
	}
	if operationErr != nil {
		return e.store.advance(ctx, job, Reverting, reason)
	}
	return e.store.advance(ctx, job, next, "")
}

func reverse(action Action) Action {
	if action == Update {
		return Rollback
	}
	return Update
}

func (e *Executor) revert(ctx context.Context, job *Job, plan ExecutionPlan) error {
	// The container must stay stopped while the applied schema is assessed.
	if err := e.runtime.Stop(ctx, plan); err != nil {
		return e.requireRecovery(ctx, job)
	}
	schema, err := e.store.Schema(ctx)
	if err != nil {
		return err
	}
	beforeStart := job.Reason != ReasonStartFailed
	if (!beforeStart || schema != plan.InitialSchema) &&
		!allowed(reverse(job.Action), plan.Target, plan.Source, schema, plan.Platform) {
		return e.requireRecovery(ctx, job)
	}
	if err := e.runtime.Pin(ctx, plan.Target, plan.Source); err != nil {
		return e.requireRecovery(ctx, job)
	}
	if err := e.runtime.Start(ctx, plan.Target, plan.Source, plan.Platform); err != nil {
		return e.requireRecovery(ctx, job)
	}
	final := RolledBack
	if beforeStart {
		final = Failed
	}
	return e.store.advance(ctx, job, final, job.Reason)
}

func (e *Executor) requireRecovery(ctx context.Context, job *Job) error {
	if ctx.Err() != nil {
		return fmt.Errorf("interrupt recovery: %w", ctx.Err())
	}
	return e.store.advance(ctx, job, RecoveryRequired, ReasonRecovery)
}

// Resolve releases the lock after an operator has made a verified image healthy.
func (e *Executor) Resolve(ctx context.Context) error {
	job, err := e.store.Active(ctx)
	if err != nil {
		return err
	}
	if job == nil || job.Stage != RecoveryRequired {
		return fmt.Errorf("no deployment requires recovery")
	}
	plan, err := e.runtime.LoadPlan(job.ID)
	if err != nil || !plan.matches(job) {
		return fmt.Errorf("verified recovery journal is missing")
	}
	status, err := e.status(ctx)
	if err != nil {
		return err
	}
	if status.Reason != "" {
		return fmt.Errorf("the managed application is not healthy")
	}
	switch {
	case sameRelease(plan.Target, status.Identity) && status.Schema == max(plan.InitialSchema, plan.Target.Schema):
		return e.store.advance(ctx, job, Succeeded, "")
	case sameRelease(plan.Source, status.Identity) &&
		(status.Schema == plan.InitialSchema || allowed(reverse(job.Action), plan.Target, plan.Source, status.Schema, plan.Platform)):
		return e.store.advance(ctx, job, RolledBack, job.Reason)
	default:
		return fmt.Errorf("the current image and schema could not be verified")
	}
}
