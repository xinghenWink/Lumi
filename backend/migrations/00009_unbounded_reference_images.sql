-- +goose Up
-- Administrators choose the reference-image limit; only negative values are invalid.
ALTER TABLE image_settings
    DROP CONSTRAINT image_settings_max_references_check,
    ADD CONSTRAINT image_settings_max_references_check CHECK (max_references >= 0);
