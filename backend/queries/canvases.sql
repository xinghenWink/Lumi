-- name: CreateCanvasConversation :exec
INSERT INTO conversations(id,user_id,type,title_auto) VALUES($1,$2,'canvas',false);
-- name: CreateCanvas :one
INSERT INTO canvases(id,user_id,conversation_id,title,document) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING *;
-- name: GetCanvas :one
SELECT * FROM canvases WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL;
-- name: LockCanvas :one
SELECT * FROM canvases WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR UPDATE;
-- name: CountCanvases :one
SELECT count(*) FROM canvases WHERE user_id=$1 AND deleted_at IS NULL;
-- name: ListCanvases :many
SELECT id,title,node_count,cover_file_id,version,created_at,updated_at FROM canvases
WHERE user_id=$1 AND deleted_at IS NULL AND title ILIKE sqlc.arg(search)::text ESCAPE '\'
AND (sqlc.narg(before_time)::timestamptz IS NULL OR (updated_at,id)<(sqlc.narg(before_time)::timestamptz,sqlc.narg(before_id)::uuid))
ORDER BY updated_at DESC,id DESC LIMIT sqlc.arg(page_limit);
-- name: SaveCanvas :one
UPDATE canvases SET title=$3,document=$4,node_count=$5,cover_file_id=$6,version=version+1,updated_at=now()
WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING *;
-- name: RemoveCanvas :one
UPDATE canvases SET deleted_at=now(),version=version+1 WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING conversation_id;
-- name: RemoveCanvasConversation :exec
UPDATE conversations SET deleted_at=now(),version=version+1 WHERE id=$1 AND user_id=$2 AND type='canvas' AND deleted_at IS NULL;
-- name: RequestCanvasTaskCancellation :exec
UPDATE image_tasks SET cancel_requested=true,version=version+1,updated_at=now()
WHERE conversation_id=$1 AND user_id=$2 AND status IN ('queued','running') AND NOT cancel_requested;
-- name: DeleteStaleCanvasFiles :exec
DELETE FROM canvas_files WHERE canvas_id=$1 AND NOT (file_id=ANY(sqlc.arg(file_ids)::uuid[]));
-- name: InsertCanvasFiles :exec
INSERT INTO canvas_files(canvas_id,file_id) SELECT $1,unnest(sqlc.arg(file_ids)::uuid[]) ON CONFLICT DO NOTHING;
-- name: CanvasOwnedFileIDs :many
-- Deleted files stay referenceable so removing a gallery image never blocks saving a canvas.
SELECT id FROM files WHERE id=ANY(sqlc.arg(ids)::uuid[]) AND user_id=$1 AND kind IN ('upload','generated');
-- name: CanvasOwnedTaskIDs :many
SELECT id FROM image_tasks WHERE id=ANY(sqlc.arg(ids)::uuid[]) AND user_id=$1 AND conversation_id=$2;
-- name: CanvasVisibleFiles :many
SELECT * FROM files WHERE id=ANY(sqlc.arg(ids)::uuid[]) AND user_id=$1 AND deleted_at IS NULL AND kind IN ('upload','generated');
