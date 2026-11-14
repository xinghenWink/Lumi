-- +goose Up
CREATE TABLE canvas_text_runs (
    id uuid PRIMARY KEY,
    canvas_id uuid NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    model_id uuid NOT NULL,
    prompt text NOT NULL,
    reference_file_ids uuid[] NOT NULL,
    reasoning text NOT NULL CHECK (reasoning IN ('', 'low', 'medium', 'high')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (canvas_id, idempotency_key)
);

CREATE TABLE canvas_text_items (
    run_id uuid NOT NULL REFERENCES canvas_text_runs(id) ON DELETE CASCADE,
    position integer NOT NULL CHECK (position BETWEEN 0 AND 2),
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
    content text NOT NULL DEFAULT '',
    error_code text NOT NULL DEFAULT '',
    lease_until timestamptz,
    PRIMARY KEY (run_id, position)
);

CREATE INDEX canvas_text_queue_idx ON canvas_text_items (run_id, position) WHERE status = 'queued';
CREATE INDEX canvas_text_lease_idx ON canvas_text_items (lease_until) WHERE status = 'running';
