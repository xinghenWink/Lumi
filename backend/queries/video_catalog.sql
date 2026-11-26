-- name: VideoRouteTargets :many
SELECT sqlc.embed(u), sqlc.embed(r) FROM model_routes r
JOIN upstreams u ON u.id=r.upstream_id
JOIN models m ON m.id=r.model_id
WHERE r.model_id=$1 AND m.enabled AND m.type='video' AND r.enabled AND u.enabled
  AND u.api_key_enc<>'' AND r.video_protocol<>''
ORDER BY r.priority,u.priority,u.id,r.id;

-- name: GetVideoCreditSettings :one
SELECT * FROM video_credit_settings WHERE singleton=true;

-- name: SaveVideoCreditSettings :one
UPDATE video_credit_settings SET pool=$1,version=version+1 WHERE singleton=true AND version=$2 RETURNING *;

-- name: GetVideoPricing :one
SELECT * FROM video_pricing WHERE model_id=$1;

-- name: SaveVideoPricing :one
INSERT INTO video_pricing (model_id,mode,rates)
SELECT sqlc.arg(model_id),sqlc.arg(mode),sqlc.arg(rates)
WHERE sqlc.arg(expected_version)::bigint=0 OR EXISTS (SELECT 1 FROM video_pricing pv WHERE pv.model_id=sqlc.arg(model_id))
ON CONFLICT (model_id) DO UPDATE SET mode=EXCLUDED.mode,rates=EXCLUDED.rates,version=video_pricing.version+1
WHERE video_pricing.version=sqlc.arg(expected_version) RETURNING *;
