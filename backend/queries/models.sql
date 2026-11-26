-- name: ListAdminModels :many
SELECT * FROM models
WHERE (sqlc.arg(search)::text = '' OR display_name ILIKE '%' || sqlc.arg(search)::text || '%' OR id::text=sqlc.arg(search)::text)
AND (sqlc.arg(kind_filter)::text = '' OR type=sqlc.arg(kind_filter))
AND (sqlc.arg(state_filter)::text = '' OR enabled=(sqlc.arg(state_filter)::text='enabled'))
AND (sqlc.narg(upstream_filter)::uuid IS NULL OR EXISTS (
    SELECT 1 FROM model_routes r WHERE r.model_id=models.id AND r.upstream_id=sqlc.narg(upstream_filter)::uuid
))
AND (sqlc.narg(cursor_time)::timestamptz IS NULL OR (created_at,id) < (sqlc.narg(cursor_time)::timestamptz,sqlc.narg(cursor_id)::uuid))
ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(page_limit);

-- name: ListPublicModels :many
SELECT sqlc.embed(m), preferred.display_name AS channel_display_name FROM models m
JOIN LATERAL (
    SELECT u.display_name FROM model_routes r JOIN upstreams u ON u.id=r.upstream_id
    WHERE r.model_id=m.id AND r.enabled AND u.enabled AND u.api_key_enc<>''
    ORDER BY r.priority,u.priority,u.id,r.id LIMIT 1
) preferred ON true
WHERE m.type=sqlc.arg(model_type)::text AND m.enabled
AND (sqlc.narg(model_id)::uuid IS NULL OR m.id=sqlc.narg(model_id)::uuid)
AND (m.type<>'chat' OR m.capabilities @> '{"stream":true}'::jsonb)
ORDER BY m.sort_order,m.id LIMIT 1000;

-- name: GetPlatformModel :one
SELECT * FROM models WHERE id=$1;

-- name: LockPlatformModel :one
SELECT * FROM models WHERE id=$1 FOR UPDATE;

-- name: ClearDefaultModel :exec
UPDATE models SET is_default=false,version=version+1,updated_at=now() WHERE type=$1 AND is_default AND id<>$2;

-- name: GetDefaultPlatformModel :one
SELECT * FROM models WHERE type=$1 AND is_default;

-- name: CreatePlatformModel :one
INSERT INTO models (id,display_name,type,description,icon,sort_order,enabled,is_default,capabilities)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *;

-- name: UpdatePlatformModel :one
UPDATE models SET display_name=$2,type=$3,description=$4,icon=$5,sort_order=$6,enabled=$7,is_default=$8,capabilities=$9,version=version+1,updated_at=now()
WHERE id=$1 RETURNING *;

-- name: DeletePlatformModels :exec
DELETE FROM models WHERE id=ANY(sqlc.arg(model_ids)::uuid[]);

-- name: DeleteModelsPricing :exec
DELETE FROM pricing_rules WHERE model_id=ANY(sqlc.arg(model_ids)::uuid[]);

-- name: ListChannelModelMembership :many
SELECT DISTINCT r.model_id, EXISTS (
    SELECT 1 FROM model_routes other WHERE other.model_id=r.model_id AND other.upstream_id<>r.upstream_id
) AS shared
FROM model_routes r WHERE r.upstream_id=$1 ORDER BY r.model_id;

-- name: SetPlatformModelsEnabled :many
UPDATE models SET enabled=sqlc.arg(enabled)::boolean, is_default=is_default AND sqlc.arg(enabled)::boolean,
    version=version+1, updated_at=now()
WHERE id=ANY(sqlc.arg(model_ids)::uuid[]) AND enabled<>sqlc.arg(enabled)::boolean
RETURNING id;

-- name: SetChannelModelRoutesEnabled :many
WITH changed AS (
    UPDATE model_routes SET enabled=sqlc.arg(enabled)::boolean
    WHERE upstream_id=sqlc.arg(upstream_id) AND model_id=ANY(sqlc.arg(model_ids)::uuid[])
    AND enabled<>sqlc.arg(enabled)::boolean RETURNING model_id
)
SELECT DISTINCT model_id FROM changed ORDER BY model_id;

-- name: DeleteChannelModelRoutes :exec
DELETE FROM model_routes WHERE upstream_id=sqlc.arg(upstream_id) AND model_id=ANY(sqlc.arg(model_ids)::uuid[]);

-- name: BumpPlatformModelVersions :exec
UPDATE models SET version=version+1, updated_at=now() WHERE id=ANY(sqlc.arg(model_ids)::uuid[]);

-- name: ListModelRoutes :many
SELECT r.*,u.name AS upstream_name,u.enabled AS upstream_enabled FROM model_routes r
JOIN upstreams u ON u.id=r.upstream_id WHERE r.model_id=$1 ORDER BY r.priority,r.id;

-- name: ClearModelRoutes :exec
DELETE FROM model_routes WHERE model_id=$1;

-- name: CreateModelRoute :exec
INSERT INTO model_routes (id,model_id,upstream_id,upstream_model_name,priority,weight,enabled,video_protocol,video_profile,video_capabilities)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);

-- name: FindImportedModel :one
SELECT m.* FROM model_routes r JOIN models m ON m.id=r.model_id
WHERE r.upstream_id=$1 AND r.upstream_model_name=$2 ORDER BY m.created_at,m.id LIMIT 1;
