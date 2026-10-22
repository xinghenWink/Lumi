-- name: LockModelConfiguration :exec
SELECT pg_advisory_xact_lock(724301);

-- name: ListUpstreams :many
SELECT * FROM upstreams
WHERE (sqlc.arg(search)::text = '' OR name ILIKE '%' || sqlc.arg(search)::text || '%' OR id::text = sqlc.arg(search)::text)
AND (sqlc.arg(state_filter)::text = '' OR enabled = (sqlc.arg(state_filter)::text = 'enabled'))
AND (sqlc.narg(cursor_time)::timestamptz IS NULL OR (created_at,id) < (sqlc.narg(cursor_time)::timestamptz,sqlc.narg(cursor_id)::uuid))
ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(page_limit);

-- name: GetUpstream :one
SELECT * FROM upstreams WHERE id=$1;

-- name: LockUpstream :one
SELECT * FROM upstreams WHERE id=$1 FOR UPDATE;

-- name: CreateUpstream :one
INSERT INTO upstreams (id,name,base_url,api_key_enc,timeout_chat_s,timeout_image_s,proxy_url,enabled,priority,weight,edit_format,note)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *;

-- name: UpdateUpstream :one
UPDATE upstreams SET name=$2,base_url=$3,api_key_enc=$4,timeout_chat_s=$5,timeout_image_s=$6,proxy_url=$7,enabled=$8,priority=$9,weight=$10,edit_format=$11,note=$12,version=version+1,updated_at=now()
WHERE id=$1 RETURNING *;

-- name: DeleteUpstream :exec
DELETE FROM upstreams WHERE id=$1;

-- name: AppendUpstreamCall :exec
INSERT INTO upstream_calls (id,upstream_id,model,kind,latency_ms,status,error_summary,request_id)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8);

-- name: PurgeUpstreamCalls :execrows
DELETE FROM upstream_calls WHERE id IN (
    SELECT id FROM upstream_calls WHERE created_at < now() - interval '30 days' ORDER BY created_at LIMIT 1000 FOR UPDATE SKIP LOCKED
);
