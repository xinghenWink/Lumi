-- +goose Up
CREATE TABLE chat_settings (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    per_minute integer NOT NULL DEFAULT 20 CHECK (per_minute BETWEEN 0 AND 1000),
    per_day integer NOT NULL DEFAULT 0 CHECK (per_day BETWEEN 0 AND 100000),
    context_messages integer NOT NULL DEFAULT 20 CHECK (context_messages BETWEEN 1 AND 200),
    context_tokens integer NOT NULL DEFAULT 32768 CHECK (context_tokens BETWEEN 128 AND 1000000),
    system_prompt text NOT NULL DEFAULT '' CHECK (octet_length(system_prompt) <= 32000),
    title_model_id uuid,
    version bigint NOT NULL DEFAULT 1
);
INSERT INTO chat_settings (singleton) VALUES (true);
CREATE TABLE conversations (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type text NOT NULL DEFAULT 'chat' CHECK (type IN ('chat','image')),
    title text NOT NULL DEFAULT '' CHECK (length(title) <= 100),
    model_id uuid,
    pinned boolean NOT NULL DEFAULT false,
    title_auto boolean NOT NULL DEFAULT true,
    last_message_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    active_run_id uuid,
    lease_until timestamptz,
    cancel_requested boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    version bigint NOT NULL DEFAULT 1
);
CREATE INDEX conversations_owner_idx ON conversations (user_id,type,pinned DESC,last_message_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX conversations_lease_idx ON conversations (lease_until) WHERE active_run_id IS NOT NULL;
CREATE TABLE messages (
    id uuid PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    request_id uuid NOT NULL,
    request_hash text NOT NULL DEFAULT '',
    role text NOT NULL CHECK (role IN ('user','assistant')),
    content text NOT NULL DEFAULT '' CHECK (octet_length(content) <= 2097152),
    status text NOT NULL CHECK (status IN ('streaming','completed','interrupted','error')),
    model_id uuid,
    upstream_id uuid,
    meta jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(meta)='object'),
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (conversation_id,request_id,role)
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE TABLE chat_daily_usage (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day date NOT NULL,
    count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
    PRIMARY KEY (user_id,day)
);
