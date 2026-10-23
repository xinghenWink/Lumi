-- name: GetImageSettings :one
SELECT * FROM image_settings WHERE singleton=true;
-- name: ImageRouteTargets :many
SELECT u.*,r.upstream_model_name FROM model_routes r JOIN upstreams u ON u.id=r.upstream_id JOIN models m ON m.id=r.model_id
WHERE m.id=$1 AND m.type='image' AND m.enabled AND r.enabled AND u.enabled AND u.api_key_enc<>''
ORDER BY r.priority,u.priority,r.id LIMIT 1;
-- name: SaveImageSettings :one
UPDATE image_settings SET max_n=$1,max_references=$2,max_upload_bytes=$3,sizes=$4,ratio_sizes=$5,per_user_concurrency=$6,global_concurrency=$7,timeout_seconds=$8,queue_timeout_seconds=$9,split_requests=$10,retention_days=$11,admin_can_view_content=$12,version=version+1 WHERE singleton=true AND version=$13 RETURNING *;
-- name: LockImageScheduler :exec
SELECT pg_advisory_xact_lock(719005);
-- name: InsertImageFile :one
INSERT INTO files(id,user_id,kind,task_id,path,thumbnail_path,mime,size,width,height,thumbnail_width,thumbnail_height,sha256)
VALUES($1,$2,$3,$4,$5,$6,'image/png',$7,$8,$9,$10,$11,$12) RETURNING *;
-- name: GetImageFile :one
SELECT * FROM files WHERE id=$1 AND deleted_at IS NULL;
-- name: GetImageReferenceFiles :many
SELECT * FROM files WHERE id=ANY(sqlc.arg(ids)::uuid[]) AND user_id=$1 AND deleted_at IS NULL AND kind IN ('upload','generated');
-- name: ImageFileInUse :one
SELECT EXISTS(SELECT 1 FROM image_tasks WHERE status IN ('queued','running') AND sqlc.arg(file_id)::uuid=ANY(reference_file_ids));
-- name: ListImageReferenceLibrary :many
SELECT * FROM files WHERE user_id=$1 AND deleted_at IS NULL AND kind IN ('upload','generated')
AND (sqlc.narg(before_time)::timestamptz IS NULL OR (created_at,id)<(sqlc.narg(before_time)::timestamptz,sqlc.narg(before_id)::uuid))
ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(page_limit);
-- name: ImageQueuePositions :many
WITH ranked AS(SELECT id,row_number() OVER(ORDER BY created_at,id)::integer AS position FROM image_tasks WHERE status='queued')
SELECT * FROM ranked WHERE id=ANY(sqlc.arg(ids)::uuid[]);
-- name: DeleteImageFile :execrows
UPDATE files SET deleted_at=coalesce(deleted_at,now()) WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL;
-- name: PendingImageFilesCleanup :many
SELECT * FROM files WHERE deleted_at IS NOT NULL AND purged_at IS NULL ORDER BY deleted_at,id LIMIT 100;
-- name: MarkImageFilePurged :exec
UPDATE files SET purged_at=now() WHERE id=$1 AND deleted_at IS NOT NULL;
-- name: ImageStoragePathExists :one
SELECT EXISTS(SELECT 1 FROM files WHERE path=$1 OR thumbnail_path=$1);
-- name: SetUserAvatar :exec
UPDATE users SET avatar_file_id=$2,updated_at=now() WHERE id=$1 AND deleted_at IS NULL;
-- name: ExpireImageFiles :execrows
UPDATE files f SET deleted_at=now() WHERE f.deleted_at IS NULL
AND (NOT EXISTS(SELECT 1 FROM users u WHERE u.id=f.user_id)
 OR (f.kind='generated' AND sqlc.arg(retention_days)::integer>0 AND f.created_at<now()-make_interval(days=>sqlc.arg(retention_days)::integer))
 OR (f.kind='upload' AND f.created_at<now()-interval '1 day' AND NOT EXISTS(SELECT 1 FROM image_tasks t WHERE f.id=ANY(t.reference_file_ids)))
 OR (f.kind='avatar' AND f.created_at<now()-interval '1 day' AND NOT EXISTS(SELECT 1 FROM users u WHERE u.avatar_file_id=f.id)))
AND NOT EXISTS(SELECT 1 FROM image_tasks t WHERE t.status IN ('queued','running') AND f.id=ANY(t.reference_file_ids));
-- name: RedactPurgedImageOwners :exec
UPDATE image_tasks SET prompt='',reference_file_ids='{}',error_message='' WHERE (prompt<>'' OR cardinality(reference_file_ids)>0) AND NOT EXISTS(SELECT 1 FROM users WHERE users.id=image_tasks.user_id);
-- name: CreateImageConversation :one
INSERT INTO conversations(id,user_id,type,model_id) VALUES($1,$2,'image',$3) ON CONFLICT DO NOTHING RETURNING *;
-- name: GetImageConversation :one
SELECT * FROM conversations WHERE id=$1 AND user_id=$2 AND type='image' AND deleted_at IS NULL;
-- name: LockImageConversation :one
SELECT * FROM conversations WHERE id=$1 AND user_id=$2 AND type='image' AND deleted_at IS NULL FOR UPDATE;
-- name: ListImageConversations :many
SELECT * FROM conversations WHERE user_id=$1 AND type='image' AND deleted_at IS NULL AND title ILIKE sqlc.arg(search)::text ESCAPE '\'
AND (sqlc.narg(before_time)::timestamptz IS NULL OR (pinned,last_message_at,id)<(sqlc.arg(before_pinned)::boolean,sqlc.narg(before_time)::timestamptz,sqlc.narg(before_id)::uuid))
ORDER BY pinned DESC,last_message_at DESC,id DESC LIMIT sqlc.arg(page_limit);
-- name: UpdateImageConversation :one
UPDATE conversations SET title=$3,pinned=$4,title_auto=false,version=version+1 WHERE id=$1 AND user_id=$2 AND type='image' AND deleted_at IS NULL AND version=$5 RETURNING *;
-- name: TouchImageConversation :exec
UPDATE conversations SET last_message_at=now(),model_id=$3,title=CASE WHEN title_auto THEN $4 ELSE title END,title_auto=false,version=version+1 WHERE id=$1 AND user_id=$2 AND type='image';
-- name: RemoveImageConversation :execrows
UPDATE conversations SET deleted_at=now(),version=version+1 WHERE id=$1 AND user_id=$2 AND type='image' AND deleted_at IS NULL;
-- name: ImageTaskByKey :one
SELECT * FROM image_tasks WHERE user_id=$1 AND idempotency_key=$2;
-- name: GetImageTask :one
SELECT * FROM image_tasks WHERE id=$1;
-- name: LockImageTask :one
SELECT * FROM image_tasks WHERE id=$1 FOR UPDATE;
-- name: CreateImageTask :one
INSERT INTO image_tasks(id,user_id,conversation_id,message_id,user_message_id,operation,model_id,model_name,prompt,params,quality,size,ratio,image_count,reference_file_ids,charge_id,unit_price,total_cost,idempotency_key,request_hash,split_requests,timeout_seconds,queue_deadline)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,now()+make_interval(secs=>sqlc.arg(queue_timeout)::integer)) RETURNING *;
-- name: CreateImageTaskItem :exec
INSERT INTO image_task_items(task_id,position) VALUES($1,$2);
-- name: ListImageTaskItems :many
SELECT i.*,f.kind AS file_kind,f.mime AS file_mime,f.size AS file_size,f.width AS file_width,f.height AS file_height,f.thumbnail_width,f.thumbnail_height,f.created_at AS file_created_at,f.deleted_at AS file_deleted_at
FROM image_task_items i LEFT JOIN files f ON f.id=i.file_id WHERE i.task_id=ANY(sqlc.arg(ids)::uuid[]) ORDER BY i.task_id,i.position;
-- name: SaveImageTaskItem :exec
UPDATE image_task_items SET status=$3,file_id=$4,error_code=$5 WHERE task_id=$1 AND position=$2 AND status='pending';
-- name: TouchImageTask :exec
UPDATE image_tasks SET version=version+1,updated_at=now() WHERE id=$1;
-- name: ImageRunningCounts :one
SELECT count(*)::integer AS global_running,count(*) FILTER (WHERE user_id=$1)::integer AS user_running FROM image_tasks WHERE status='running';
-- name: StartImageTask :one
UPDATE image_tasks SET status='running',run_token=$2,lease_until=now()+interval '30 seconds',started_at=now(),updated_at=now(),version=version+1 WHERE id=$1 AND status='queued' AND NOT cancel_requested RETURNING *;
-- name: HeartbeatImageTask :execrows
UPDATE image_tasks SET lease_until=now()+interval '30 seconds' WHERE id=$1 AND run_token=$2 AND status='running' AND NOT cancel_requested;
-- name: CancelImageTask :exec
UPDATE image_tasks SET cancel_requested=true,version=version+1,updated_at=now() WHERE id=$1 AND status IN ('queued','running');
-- name: FinishImageTask :one
UPDATE image_tasks SET status=$2,successful_images=$3,refunded_cost=$4,error_code=$5,error_message=$5,finished_at=now(),lease_until=NULL,run_token=NULL,version=version+1,updated_at=now() WHERE id=$1 AND status IN ('queued','running') RETURNING *;
-- name: FinishImageMessage :exec
UPDATE messages SET status=$2,meta=$3 WHERE id=$1;
-- name: FailPendingImageItems :exec
UPDATE image_task_items SET status='failed',error_code=$2 WHERE task_id=$1 AND status='pending';
-- name: DiscardImageTaskItems :exec
UPDATE image_task_items SET status='failed',file_id=NULL,error_code=$2 WHERE task_id=$1;
-- name: DeleteCanceledImageFiles :exec
UPDATE files SET deleted_at=coalesce(deleted_at,now()) WHERE task_id=$1;
-- name: ImageQueueCandidates :many
SELECT * FROM image_tasks WHERE status='queued' ORDER BY created_at,id LIMIT 500;
-- name: ExpiredImageTasks :many
SELECT t.* FROM image_tasks t LEFT JOIN users u ON u.id=t.user_id LEFT JOIN conversations c ON c.id=t.conversation_id
WHERE t.status IN ('queued','running') AND ((t.status='queued' AND t.queue_deadline<now()) OR (t.status='running' AND t.lease_until<now()) OR u.id IS NULL OR u.status<>'active' OR u.deleted_at IS NOT NULL OR c.deleted_at IS NOT NULL)
ORDER BY t.created_at,t.id LIMIT 100;
-- name: ImageQueuePosition :one
SELECT count(*)::integer FROM image_tasks WHERE status='queued' AND (created_at,id)<=(sqlc.arg(created_at)::timestamptz,sqlc.arg(id)::uuid);
-- name: ListImageTasks :many
SELECT * FROM image_tasks WHERE (sqlc.narg(owner)::uuid IS NULL OR user_id=sqlc.narg(owner)::uuid)
AND (sqlc.narg(conversation)::uuid IS NULL OR conversation_id=sqlc.narg(conversation)::uuid)
AND (sqlc.arg(state)::text='' OR status=sqlc.arg(state)::text)
AND (sqlc.arg(quality)::text='' OR quality=sqlc.arg(quality)::text)
AND (sqlc.narg(from_time)::timestamptz IS NULL OR created_at>=sqlc.narg(from_time)::timestamptz)
AND (sqlc.narg(until_time)::timestamptz IS NULL OR created_at<sqlc.narg(until_time)::timestamptz)
AND (sqlc.narg(before_time)::timestamptz IS NULL OR (created_at,id)<(sqlc.narg(before_time)::timestamptz,sqlc.narg(before_id)::uuid))
ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(page_limit);
-- name: ListImageGallery :many
SELECT f.*,t.prompt,t.params,t.quality,t.size AS requested_size,t.ratio,t.model_id,t.model_name,t.status AS task_status,t.conversation_id,t.unit_price
FROM files f JOIN image_tasks t ON t.id=f.task_id
WHERE f.user_id=$1 AND f.kind='generated' AND f.deleted_at IS NULL
AND (sqlc.arg(quality)::text='' OR t.quality=sqlc.arg(quality)::text)
AND (sqlc.arg(state)::text='' OR t.status=sqlc.arg(state)::text)
AND (sqlc.narg(from_time)::timestamptz IS NULL OR f.created_at>=sqlc.narg(from_time)::timestamptz)
AND (sqlc.narg(until_time)::timestamptz IS NULL OR f.created_at<sqlc.narg(until_time)::timestamptz)
AND (sqlc.narg(before_time)::timestamptz IS NULL OR (f.created_at,f.id)<(sqlc.narg(before_time)::timestamptz,sqlc.narg(before_id)::uuid))
ORDER BY f.created_at DESC,f.id DESC LIMIT sqlc.arg(page_limit);
