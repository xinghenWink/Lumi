-- +goose Up
ALTER TABLE files DROP CONSTRAINT files_mime_check;
ALTER TABLE files ADD CONSTRAINT files_mime_check
    CHECK (mime = 'image/png' OR (kind = 'generated' AND mime = 'image/gif'));

ALTER TABLE image_tasks ADD COLUMN output_format text NOT NULL DEFAULT ''
    CHECK (output_format IN ('', 'png', 'gif'));
