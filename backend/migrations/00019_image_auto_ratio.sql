-- +goose Up
ALTER TABLE user_preferences ALTER COLUMN image_ratio SET DEFAULT 'auto';
