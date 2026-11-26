-- +goose Up
ALTER TABLE upstreams ADD COLUMN display_name text NOT NULL DEFAULT ''
    CHECK (length(display_name) <= 80);
