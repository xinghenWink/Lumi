-- name: CreateVideoTask :one
INSERT INTO video_tasks (id,user_id,canvas_id,model_id,model_name,request,references_ids,routes,quote,idempotency_key,request_hash,deadline)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *;

-- name: VideoTaskByKey :one
SELECT * FROM video_tasks WHERE user_id=$1 AND idempotency_key=$2;

-- name: VideoTaskByID :one
SELECT * FROM video_tasks WHERE id=$1;

-- name: LockVideoTask :one
SELECT * FROM video_tasks WHERE id=$1 FOR UPDATE;

-- name: ListVideoTasks :many
SELECT * FROM video_tasks WHERE user_id=$1
AND (sqlc.narg(canvas_filter)::uuid IS NULL OR canvas_id=sqlc.narg(canvas_filter))
AND (sqlc.narg(before_time)::timestamptz IS NULL OR (created_at,id)<(sqlc.narg(before_time),sqlc.arg(before_id)::uuid))
ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(page_limit);

-- name: CreateVideoTaskItems :exec
INSERT INTO video_task_items (task_id,position) SELECT sqlc.arg(task_id), generate_series(0,sqlc.arg(last_position)::integer);

-- name: GetVideoTaskItems :many
SELECT * FROM video_task_items WHERE task_id=$1 ORDER BY position;

-- name: LockVideoScheduler :exec
SELECT pg_advisory_xact_lock(719009);

-- name: ClaimVideoItem :one
WITH candidate AS (
 SELECT i.task_id,i.position,i.status AS previous_status
 FROM video_task_items i JOIN video_tasks t ON t.id=i.task_id
 WHERE i.status IN ('queued','submitting','running') AND i.next_run<=now() AND (i.lease_until IS NULL OR i.lease_until<=now())
 AND (i.status<>'queued' OR t.deadline<=now() OR (
  (SELECT count(*) FROM video_task_items WHERE status IN ('submitting','running'))<4
  AND (SELECT count(*) FROM video_task_items x JOIN video_tasks p ON p.id=x.task_id
       WHERE x.status IN ('submitting','running') AND p.user_id=t.user_id)<2))
 ORDER BY i.next_run,i.task_id,i.position LIMIT 1 FOR UPDATE OF i SKIP LOCKED
)
UPDATE video_task_items i SET lease_until=now()+interval '8 minutes',lease_token=sqlc.arg(token),
 status=CASE WHEN i.status='queued' THEN 'submitting' ELSE i.status END
FROM candidate c WHERE i.task_id=c.task_id AND i.position=c.position
RETURNING sqlc.embed(i), c.previous_status;

-- name: SetVideoItemRoute :execrows
UPDATE video_task_items SET route_index=$4,route_id=$5,channel_id=$6,channel_version=$7,protocol=$8,profile=$9 WHERE task_id=$1 AND position=$2 AND lease_token=$3;

-- name: ReleaseVideoItem :execrows
UPDATE video_task_items SET status=$4,remote_id=$5,next_run=$6,error_code=$7,file_id=$8,lease_token=NULL,lease_until=NULL
WHERE task_id=$1 AND position=$2 AND lease_token=$3;

-- name: SetVideoTaskRunning :exec
UPDATE video_tasks SET status='running',updated_at=now() WHERE id=$1 AND status='queued';

-- name: FinishVideoTask :exec
UPDATE video_tasks SET status=$2,refunded=$3,routes='[]'::jsonb,updated_at=now() WHERE id=$1;

-- name: ActiveVideoReference :one
SELECT EXISTS(SELECT 1 FROM video_tasks WHERE id=$1 AND sqlc.arg(file_id)::uuid=ANY(references_ids)
AND status IN ('queued','running') AND deadline>now());

-- name: ListVideoAssets :many
SELECT * FROM files WHERE user_id=$1 AND deleted_at IS NULL
AND kind IN ('upload','generated','video_upload','video_generated','audio_upload')
AND (sqlc.narg(before_time)::timestamptz IS NULL OR (created_at,id)<(sqlc.narg(before_time),sqlc.arg(before_id)::uuid))
ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(page_limit);

-- name: SetFileDuration :exec
UPDATE files SET duration_ms=$2 WHERE id=$1;

-- name: RedactPurgedVideoOwners :exec
UPDATE video_tasks SET request='{}'::jsonb,references_ids='{}'
WHERE request<>'{}'::jsonb AND NOT EXISTS (SELECT 1 FROM users WHERE users.id=video_tasks.user_id);
