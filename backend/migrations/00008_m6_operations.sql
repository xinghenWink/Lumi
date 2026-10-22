-- +goose Up
CREATE TABLE password_resets (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_version bigint NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_expiry_idx ON password_resets(expires_at);

CREATE TABLE user_preferences (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
    instructions text NOT NULL DEFAULT '' CHECK (char_length(instructions) <= 4000),
    image_quality text NOT NULL DEFAULT 'medium' CHECK (image_quality IN ('low','medium','high')),
    image_ratio text NOT NULL DEFAULT '1:1',
    image_count integer NOT NULL DEFAULT 1 CHECK (image_count BETWEEN 1 AND 4)
);
ALTER TABLE users ADD COLUMN purge_after timestamptz;
CREATE INDEX users_purge_after_idx ON users(purge_after) WHERE deleted_at IS NOT NULL;

CREATE TABLE announcements (
    id uuid PRIMARY KEY,
    content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 10000),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz,
    enabled boolean NOT NULL DEFAULT false,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX announcements_created_idx ON announcements(created_at DESC,id DESC);

ALTER TABLE upstreams ADD COLUMN consecutive_failures integer NOT NULL DEFAULT 0;
ALTER TABLE upstreams ADD COLUMN open_until timestamptz;
ALTER TABLE upstreams ADD COLUMN last_error text NOT NULL DEFAULT '';
ALTER TABLE upstreams ADD COLUMN probe_until timestamptz;
CREATE TABLE job_runs (
    name text PRIMARY KEY,
    completed_at timestamptz NOT NULL DEFAULT now(),
    affected bigint NOT NULL DEFAULT 0
);
INSERT INTO settings(key,value) VALUES ('operations',
'{"maintenance":false,"turnstile_enabled":false,"turnstile_site_key":"","turnstile_hostname":"","turnstile_secret_encrypted":"","register_per_ip_day":5,"circuit_failures":5,"circuit_seconds":60,"sensitive_words":[]}');
CREATE INDEX messages_content_search_idx ON messages USING gin(to_tsvector('simple', content));
ALTER TABLE messages ADD COLUMN reference_file_ids uuid[] NOT NULL DEFAULT '{}';
