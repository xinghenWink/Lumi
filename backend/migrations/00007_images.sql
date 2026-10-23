-- +goose Up
CREATE TABLE image_settings (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    max_n integer NOT NULL DEFAULT 4 CHECK (max_n BETWEEN 1 AND 4),
    max_references integer NOT NULL DEFAULT 4 CHECK (max_references BETWEEN 0 AND 4),
    max_upload_bytes bigint NOT NULL DEFAULT 10485760 CHECK (max_upload_bytes BETWEEN 1024 AND 10485760),
    sizes jsonb NOT NULL DEFAULT '["1024x1024","1536x1024","1024x1536","auto"]' CHECK (jsonb_typeof(sizes)='array'),
    ratio_sizes jsonb NOT NULL DEFAULT '{"1:1":"1024x1024","3:2":"1536x1024","2:3":"1024x1536","4:3":"1536x1024","3:4":"1024x1536","16:9":"1536x1024","9:16":"1024x1536"}' CHECK (jsonb_typeof(ratio_sizes)='object'),
    per_user_concurrency integer NOT NULL DEFAULT 2 CHECK (per_user_concurrency BETWEEN 1 AND 20),
    global_concurrency integer NOT NULL DEFAULT 4 CHECK (global_concurrency BETWEEN 1 AND 20),
    timeout_seconds integer NOT NULL DEFAULT 180 CHECK (timeout_seconds BETWEEN 5 AND 600),
    queue_timeout_seconds integer NOT NULL DEFAULT 900 CHECK (queue_timeout_seconds BETWEEN 60 AND 86400),
    split_requests boolean NOT NULL DEFAULT false,
    retention_days integer NOT NULL DEFAULT 0 CHECK (retention_days BETWEEN 0 AND 3650),
    admin_can_view_content boolean NOT NULL DEFAULT false,
    version bigint NOT NULL DEFAULT 1
);
INSERT INTO image_settings(singleton) VALUES(true);
CREATE TABLE files (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('upload','generated','thumbnail','avatar')),
    task_id uuid,
    path text NOT NULL UNIQUE,
    thumbnail_path text NOT NULL UNIQUE,
    mime text NOT NULL CHECK (mime='image/png'),
    size bigint NOT NULL CHECK (size BETWEEN 1 AND 20971520),
    width integer NOT NULL CHECK (width BETWEEN 1 AND 8192),
    height integer NOT NULL CHECK (height BETWEEN 1 AND 8192),
    thumbnail_width integer NOT NULL CHECK (thumbnail_width BETWEEN 1 AND 512),
    thumbnail_height integer NOT NULL CHECK (thumbnail_height BETWEEN 1 AND 512),
    sha256 text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    purged_at timestamptz
);
CREATE INDEX files_owner_idx ON files(user_id,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX files_cleanup_idx ON files(deleted_at) WHERE purged_at IS NULL;
CREATE TABLE image_tasks (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    message_id uuid NOT NULL,
    user_message_id uuid NOT NULL,
    operation text NOT NULL CHECK (operation IN ('generate','edit')),
    model_id uuid NOT NULL,
    model_name text NOT NULL,
    prompt text NOT NULL CHECK (octet_length(prompt)<=64000),
    params jsonb NOT NULL CHECK (jsonb_typeof(params)='object'),
    quality text NOT NULL CHECK (quality IN ('low','medium','high')),
    size text NOT NULL,
    ratio text NOT NULL DEFAULT '',
    image_count integer NOT NULL CHECK (image_count BETWEEN 1 AND 4),
    reference_file_ids uuid[] NOT NULL DEFAULT '{}',
    charge_id uuid NOT NULL REFERENCES credit_charges(id),
    unit_price bigint NOT NULL CHECK (unit_price>=0),
    total_cost bigint NOT NULL CHECK (total_cost>=0),
    refunded_cost bigint NOT NULL DEFAULT 0 CHECK (refunded_cost>=0 AND refunded_cost<=total_cost),
    successful_images integer NOT NULL DEFAULT 0 CHECK (successful_images BETWEEN 0 AND 4),
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','partial','failed','canceled')),
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    error_code text NOT NULL DEFAULT '',
    error_message text NOT NULL DEFAULT '',
    split_requests boolean NOT NULL,
    timeout_seconds integer NOT NULL,
    queue_deadline timestamptz NOT NULL,
    run_token uuid,
    lease_until timestamptz,
    cancel_requested boolean NOT NULL DEFAULT false,
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    version bigint NOT NULL DEFAULT 1,
    UNIQUE(user_id,idempotency_key)
);
CREATE INDEX image_tasks_queue_idx ON image_tasks(created_at,id) WHERE status='queued';
CREATE INDEX image_tasks_running_idx ON image_tasks(user_id,lease_until) WHERE status='running';
CREATE INDEX image_tasks_owner_idx ON image_tasks(user_id,created_at DESC,id DESC);
CREATE INDEX image_tasks_conversation_idx ON image_tasks(conversation_id,created_at DESC,id DESC);
CREATE INDEX image_tasks_admin_idx ON image_tasks(status,created_at DESC,id DESC);
CREATE TABLE image_task_items (
    task_id uuid NOT NULL REFERENCES image_tasks(id),
    position integer NOT NULL CHECK (position BETWEEN 0 AND 3),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed')),
    file_id uuid REFERENCES files(id),
    error_code text NOT NULL DEFAULT '',
    PRIMARY KEY(task_id,position)
);
