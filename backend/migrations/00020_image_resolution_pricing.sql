-- +goose Up
UPDATE settings
SET value = jsonb_set(value, '{size_multipliers}', '{"1k":"1.00","2k":"1.00","4k":"1.00"}')
WHERE key = 'credits';
