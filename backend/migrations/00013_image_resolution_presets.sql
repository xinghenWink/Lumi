-- +goose Up
ALTER TABLE image_settings
    ADD COLUMN disabled_ratios text[] NOT NULL DEFAULT '{}',
    ADD COLUMN disabled_resolutions text[] NOT NULL DEFAULT '{}';
