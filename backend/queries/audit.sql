-- name: AppendAudit :exec
INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, "before", "after", ip)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8);

-- name: ListAuditLogs :many
SELECT * FROM audit_logs
WHERE (sqlc.narg(actor_filter)::uuid IS NULL OR actor_id = sqlc.narg(actor_filter))
AND (sqlc.arg(action_filter)::text = '' OR action = sqlc.arg(action_filter))
AND (sqlc.arg(target_type_filter)::text = '' OR target_type = sqlc.arg(target_type_filter))
AND (sqlc.narg(target_id_filter)::uuid IS NULL OR target_id = sqlc.narg(target_id_filter))
AND (sqlc.narg(created_from)::timestamptz IS NULL OR created_at >= sqlc.narg(created_from))
AND (sqlc.narg(created_until)::timestamptz IS NULL OR created_at < sqlc.narg(created_until))
AND (sqlc.narg(cursor_time)::timestamptz IS NULL OR (created_at, id) < (sqlc.narg(cursor_time)::timestamptz, sqlc.arg(cursor_id)::uuid))
ORDER BY created_at DESC, id DESC LIMIT sqlc.arg(page_limit);
