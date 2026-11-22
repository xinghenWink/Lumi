-- +goose Up
ALTER TABLE image_tasks ADD COLUMN complexity text NOT NULL DEFAULT ''
    CHECK (complexity IN ('', 'low', 'medium', 'high'));
