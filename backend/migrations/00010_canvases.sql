-- +goose Up
-- Each canvas owns one hidden conversation of type canvas so its image tasks reuse
-- the existing billing, queue and streaming pipeline without appearing in image history.
ALTER TABLE conversations
    DROP CONSTRAINT conversations_type_check,
    ADD CONSTRAINT conversations_type_check CHECK (type IN ('chat','image','canvas'));
CREATE TABLE canvases (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id uuid NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
    title text NOT NULL DEFAULT '' CHECK (length(title) <= 100),
    document jsonb NOT NULL CHECK (jsonb_typeof(document)='object' AND octet_length(document::text) <= 1048576),
    node_count integer NOT NULL DEFAULT 0 CHECK (node_count BETWEEN 0 AND 500),
    cover_file_id uuid,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);
CREATE INDEX canvases_owner_idx ON canvases(user_id,updated_at DESC,id DESC) WHERE deleted_at IS NULL;
-- Files placed on a canvas are kept out of upload expiry while the canvas exists.
CREATE TABLE canvas_files (
    canvas_id uuid NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
    file_id uuid NOT NULL,
    PRIMARY KEY (canvas_id,file_id)
);
CREATE INDEX canvas_files_file_idx ON canvas_files(file_id);
