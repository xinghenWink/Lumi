-- +goose Up
-- Keep bounded retention batches efficient without indexing active accounts.
CREATE INDEX users_deleted_retention_idx ON users (deleted_at, id)
WHERE deleted_at IS NOT NULL;
