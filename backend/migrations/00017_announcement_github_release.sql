-- +goose Up
ALTER TABLE announcements ADD COLUMN github_release_tag text
    CHECK (github_release_tag ~ '^v(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$');
