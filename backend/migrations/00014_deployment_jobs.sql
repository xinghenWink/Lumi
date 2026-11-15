-- +goose Up
CREATE TABLE deployment_executor (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    version text NOT NULL,
    commit_sha text NOT NULL,
    digest text NOT NULL,
    platform text NOT NULL,
    schema_version bigint NOT NULL,
    reason text NOT NULL,
    checked_at timestamptz NOT NULL
);

CREATE TABLE deployment_jobs (
    id uuid PRIMARY KEY,
    actor_id uuid NOT NULL,
    actor_ip inet NOT NULL,
    idempotency_key text NOT NULL,
    action text NOT NULL CHECK (action IN ('update', 'rollback')),
    source_version text NOT NULL,
    source_digest text NOT NULL,
    target_version text NOT NULL,
    target_digest text NOT NULL,
    stage text NOT NULL CHECK (stage IN (
        'queued', 'preflight', 'stopping', 'backup', 'switching', 'verifying',
        'reverting', 'succeeded', 'failed', 'rolled_back', 'recovery_required'
    )),
    reason text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    UNIQUE (actor_id, idempotency_key)
);

CREATE UNIQUE INDEX deployment_jobs_one_operation ON deployment_jobs ((true))
    WHERE finished_at IS NULL OR stage = 'recovery_required';
CREATE INDEX deployment_jobs_recent ON deployment_jobs (created_at DESC, id DESC);
