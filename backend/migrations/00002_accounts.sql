-- +goose Up
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
    id uuid PRIMARY KEY,
    email citext NOT NULL,
    password_hash text NOT NULL,
    nickname text NOT NULL CHECK (char_length(nickname) BETWEEN 1 AND 30),
    avatar_file_id uuid,
    role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    token_version bigint NOT NULL DEFAULT 0 CHECK (token_version >= 0),
    locale text NOT NULL DEFAULT 'zh-CN',
    timezone text NOT NULL DEFAULT 'Asia/Shanghai',
    last_login_at timestamptz,
    last_login_ip inet,
    terms_accepted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);
CREATE UNIQUE INDEX users_email_active_key ON users (email) WHERE deleted_at IS NULL;
CREATE INDEX users_created_idx ON users (created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX users_last_login_idx ON users ((coalesce(last_login_at, '1970-01-01'::timestamptz)) DESC, id DESC) WHERE deleted_at IS NULL;

CREATE TABLE user_sessions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family_id uuid NOT NULL,
    token_hash text NOT NULL UNIQUE,
    device text NOT NULL,
    ip inet NOT NULL,
    user_agent text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    rotated_from uuid REFERENCES user_sessions(id)
);
CREATE INDEX sessions_user_idx ON user_sessions (user_id, revoked_at);
CREATE INDEX sessions_family_idx ON user_sessions (family_id, revoked_at);

CREATE TABLE verification_codes (
    id uuid PRIMARY KEY,
    target citext NOT NULL,
    purpose text NOT NULL CHECK (purpose = 'register'),
    code_hash bytea NOT NULL,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at timestamptz
);
CREATE INDEX verification_target_idx ON verification_codes (target, purpose, created_at DESC);

CREATE TABLE settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_by uuid,
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO settings (key, value) VALUES
('site', '{"name":"Lumi","description":"对话与生图","footer":"给灵感一点空间。","contact":"","terms_url":"/terms","privacy_url":"/privacy"}'),
('registration', '{"enabled":true,"email_verification_enabled":true,"domain_allowlist":[],"domain_blocklist":[],"login_failure_limit":5,"login_lock_minutes":15,"login_per_minute":20,"register_per_minute":10,"code_per_minute":3}'),
('mail', '{"host":"","port":587,"username":"","from":"","encryption":"starttls"}');

-- Audit actor IDs intentionally have no FK: later user cleanup must not rewrite history.
CREATE TABLE audit_logs (
    id uuid PRIMARY KEY,
    actor_id uuid,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id uuid,
    "before" jsonb,
    "after" jsonb,
    ip inet NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_created_idx ON audit_logs (created_at DESC, id DESC);
CREATE INDEX audit_actor_idx ON audit_logs (actor_id, created_at DESC);
CREATE INDEX audit_target_idx ON audit_logs (target_type, target_id, created_at DESC);

-- +goose StatementBegin
CREATE FUNCTION lumi.protect_audit_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit history is append-only';
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER audit_history_immutable BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION lumi.protect_audit_history();
