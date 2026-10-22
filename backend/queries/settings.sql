-- name: ListSettings :many
SELECT * FROM settings WHERE key IN ('site', 'registration', 'mail');

-- name: SaveSetting :exec
INSERT INTO settings (key, value, updated_by) VALUES ($1, $2, $3)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now();
