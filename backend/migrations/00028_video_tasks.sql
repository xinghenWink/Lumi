-- +goose Up
ALTER TABLE files DROP CONSTRAINT files_kind_check, DROP CONSTRAINT files_mime_check,
    DROP CONSTRAINT files_size_check;
ALTER TABLE files ADD COLUMN duration_ms bigint NOT NULL DEFAULT 0 CHECK (duration_ms>=0);
ALTER TABLE files ADD CHECK (kind IN ('upload','generated','thumbnail','avatar','edit_guide','video_upload','video_generated','audio_upload')),
    ADD CHECK (size BETWEEN 1 AND 209715200 AND (kind IN ('video_upload','video_generated','audio_upload') OR size<=20971520)),
    ADD CHECK ((kind IN ('video_upload','video_generated') AND mime IN ('video/mp4','video/quicktime'))
      OR (kind='audio_upload' AND mime IN ('audio/mpeg','audio/wav'))
      OR (kind NOT IN ('video_upload','video_generated','audio_upload') AND (mime='image/png' OR (kind='generated' AND mime='image/gif'))));

CREATE TABLE video_tasks (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    canvas_id uuid,
    model_id uuid NOT NULL,
    model_name text NOT NULL,
    request jsonb NOT NULL,
    references_ids uuid[] NOT NULL DEFAULT '{}',
    routes jsonb NOT NULL,
    quote jsonb NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','partial','failed')),
    refunded bigint NOT NULL DEFAULT 0 CHECK (refunded>=0),
    deadline timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id,idempotency_key)
);
CREATE INDEX video_tasks_owner_idx ON video_tasks(user_id,created_at DESC,id DESC);
CREATE INDEX video_tasks_active_owner_idx ON video_tasks(user_id) WHERE status IN ('queued','running');

CREATE TABLE video_task_items (
    task_id uuid NOT NULL REFERENCES video_tasks(id),
    position integer NOT NULL CHECK (position BETWEEN 0 AND 3),
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','submitting','running','succeeded','failed')),
    route_index integer NOT NULL DEFAULT 0,
    remote_id text NOT NULL DEFAULT '',
    route_id uuid,
    channel_id uuid,
    channel_version bigint,
    protocol text NOT NULL DEFAULT '',
    profile text NOT NULL DEFAULT '',
    error_code text NOT NULL DEFAULT '',
    file_id uuid REFERENCES files(id),
    next_run timestamptz NOT NULL DEFAULT now(),
    lease_until timestamptz,
    lease_token uuid,
    PRIMARY KEY(task_id,position)
);
CREATE INDEX video_task_due_idx ON video_task_items(next_run) WHERE status IN ('queued','submitting','running');
