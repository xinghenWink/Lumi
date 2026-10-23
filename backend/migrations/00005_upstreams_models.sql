-- +goose Up
CREATE TABLE upstreams (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    base_url text NOT NULL,
    api_key_enc text NOT NULL,
    timeout_chat_s integer NOT NULL DEFAULT 120 CHECK (timeout_chat_s BETWEEN 1 AND 600),
    timeout_image_s integer NOT NULL DEFAULT 180 CHECK (timeout_image_s BETWEEN 1 AND 600),
    proxy_url text NOT NULL DEFAULT '',
    enabled boolean NOT NULL DEFAULT true,
    priority integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 10000),
    weight integer NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 10000),
    circuit_state text NOT NULL DEFAULT 'closed' CHECK (circuit_state IN ('closed','open','half_open')),
    edit_format text NOT NULL DEFAULT 'multipart' CHECK (edit_format IN ('multipart','json')),
    note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX upstreams_created_idx ON upstreams (created_at DESC, id DESC);
CREATE UNIQUE INDEX upstreams_name_idx ON upstreams (lower(name));

CREATE TABLE models (
    id uuid PRIMARY KEY,
    display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
    type text NOT NULL CHECK (type IN ('chat','image')),
    description text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
    icon text NOT NULL DEFAULT '' CHECK (length(icon) <= 40),
    sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 10000),
    enabled boolean NOT NULL DEFAULT false,
    is_default boolean NOT NULL DEFAULT false,
    capabilities jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(capabilities) = 'object'),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (NOT is_default OR enabled)
);
CREATE UNIQUE INDEX models_default_idx ON models (type) WHERE is_default AND enabled;
CREATE INDEX models_public_idx ON models (type, sort_order, id) WHERE enabled;
CREATE INDEX models_created_idx ON models (created_at DESC, id DESC);

CREATE TABLE model_routes (
    id uuid PRIMARY KEY,
    model_id uuid NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    upstream_id uuid NOT NULL REFERENCES upstreams(id) ON DELETE CASCADE,
    upstream_model_name text NOT NULL CHECK (length(upstream_model_name) BETWEEN 1 AND 200),
    priority integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 10000),
    weight integer NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 10000),
    enabled boolean NOT NULL DEFAULT true,
    UNIQUE (model_id, upstream_id, upstream_model_name)
);
CREATE INDEX model_routes_priority_idx ON model_routes (model_id, priority, id);
CREATE INDEX model_routes_upstream_idx ON model_routes (upstream_id);

-- Call history retains an opaque channel ID after configuration deletion.
CREATE TABLE upstream_calls (
    id uuid PRIMARY KEY,
    upstream_id uuid NOT NULL,
    model text NOT NULL DEFAULT '',
    kind text NOT NULL,
    latency_ms bigint NOT NULL CHECK (latency_ms >= 0),
    status integer NOT NULL,
    error_summary text NOT NULL DEFAULT '',
    request_id text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX upstream_calls_created_idx ON upstream_calls (created_at);
CREATE INDEX upstream_calls_upstream_idx ON upstream_calls (upstream_id, created_at DESC);
