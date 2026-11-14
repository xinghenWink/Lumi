-- name: CreateCanvasTextRun :exec
INSERT INTO canvas_text_runs(id,canvas_id,user_id,idempotency_key,request_hash,model_id,prompt,reference_file_ids,reasoning)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9);

-- name: CreateCanvasTextItem :exec
INSERT INTO canvas_text_items(run_id,position) VALUES($1,$2);

-- name: CanvasTextRunByKey :one
SELECT * FROM canvas_text_runs WHERE canvas_id=$1 AND user_id=$2 AND idempotency_key=$3;

-- name: GetCanvasTextRun :one
SELECT r.* FROM canvas_text_runs r JOIN canvases c ON c.id=r.canvas_id
WHERE r.canvas_id=$1 AND r.user_id=$2 AND r.id=$3 AND c.deleted_at IS NULL;

-- name: CanvasOwnedTextRuns :many
SELECT id FROM canvas_text_runs WHERE canvas_id=$1 AND user_id=$2 AND id=ANY(sqlc.arg(ids)::uuid[]);

-- name: ListCanvasTextItems :many
SELECT * FROM canvas_text_items WHERE run_id=$1 ORDER BY position;

-- name: ClaimCanvasTextItem :one
WITH candidate AS (
    SELECT i.run_id,i.position FROM canvas_text_items i
    JOIN canvas_text_runs r ON i.run_id=r.id JOIN canvases c ON c.id=r.canvas_id
    WHERE i.status='queued' AND c.deleted_at IS NULL
    ORDER BY r.created_at,i.run_id,i.position FOR UPDATE OF i SKIP LOCKED LIMIT 1
), claimed AS (
    UPDATE canvas_text_items i SET status='running',lease_until=now()+interval '45 seconds'
    FROM candidate p WHERE i.run_id=p.run_id AND i.position=p.position
    RETURNING i.run_id,i.position
)
SELECT r.*, c.position FROM claimed c JOIN canvas_text_runs r ON r.id=c.run_id;

-- name: RenewCanvasTextItem :execrows
UPDATE canvas_text_items SET lease_until=now()+interval '45 seconds' WHERE run_id=$1 AND position=$2 AND status='running';

-- name: SettleCanvasTextItem :exec
UPDATE canvas_text_items SET status=$3,content=$4,error_code=$5,lease_until=NULL
WHERE run_id=$1 AND position=$2 AND status='running';

-- name: RecoverCanvasTextItems :exec
UPDATE canvas_text_items SET status='failed',error_code='CHAT_INTERRUPTED',lease_until=NULL
WHERE status='running' AND lease_until<now();

-- name: CancelCanvasTextRun :exec
UPDATE canvas_text_items SET status='canceled',error_code='CHAT_STOPPED',lease_until=NULL
WHERE run_id=$1 AND status IN ('queued','running');

-- name: CancelCanvasTextRuns :exec
UPDATE canvas_text_items i SET status='canceled',error_code='CHAT_STOPPED',lease_until=NULL
FROM canvas_text_runs r WHERE r.id=i.run_id AND r.canvas_id=$1 AND i.status IN ('queued','running');
