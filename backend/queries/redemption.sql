-- name: CreateRedeemBatch :one
INSERT INTO redeem_batches (id,name,note,prefix,quantity,credits,max_uses,expires_at,created_by)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *;

-- name: ListRedeemBatches :many
SELECT * FROM redeem_batches
WHERE (sqlc.narg(cursor_time)::timestamptz IS NULL OR (created_at,id)<(sqlc.narg(cursor_time),sqlc.arg(cursor_id)::uuid))
ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(page_limit);

-- name: CreateRedeemCode :exec
INSERT INTO redeem_codes (id,batch_id,code_hash,code_encrypted,tail,credits,max_uses,expires_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8);

-- name: LockRedeemCodeByHash :one
SELECT * FROM redeem_codes WHERE code_hash=$1 FOR UPDATE;

-- name: LockRedeemCode :one
SELECT * FROM redeem_codes WHERE id=$1 FOR UPDATE;

-- name: IncrementRedeemUses :exec
UPDATE redeem_codes SET used_count=used_count+1 WHERE id=$1 AND used_count<max_uses;

-- name: SetRedeemCodeEnabled :exec
UPDATE redeem_codes SET enabled=$2 WHERE id=$1;

-- name: DeleteUnusedRedeemCode :exec
DELETE FROM redeem_codes WHERE id=$1 AND used_count=0;

-- name: HasRedeemedCode :one
SELECT EXISTS(SELECT 1 FROM redeem_records WHERE code_id=$1 AND user_id=$2);

-- name: CreateRedeemRecord :one
INSERT INTO redeem_records (id,code_id,user_id,code_tail,credits,ip) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *;

-- name: ListRedeemCodes :many
SELECT * FROM redeem_codes
WHERE (sqlc.narg(batch_filter)::uuid IS NULL OR batch_id=sqlc.narg(batch_filter))
AND (sqlc.arg(search_hash)::text='' OR code_hash=sqlc.arg(search_hash))
AND (sqlc.arg(status_filter)::text='' OR
  CASE WHEN NOT enabled THEN 'disabled' WHEN expires_at<=sqlc.arg(at_time)::timestamptz THEN 'expired'
       WHEN used_count>=max_uses THEN 'used' ELSE 'unused' END=sqlc.arg(status_filter))
AND (sqlc.narg(cursor_time)::timestamptz IS NULL OR (created_at,id)<(sqlc.narg(cursor_time),sqlc.arg(cursor_id)::uuid))
ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(page_limit);

-- name: ListRedeemRecords :many
SELECT * FROM redeem_records
WHERE (sqlc.narg(user_filter)::uuid IS NULL OR user_id=sqlc.narg(user_filter))
AND (sqlc.narg(code_filter)::uuid IS NULL OR code_id=sqlc.narg(code_filter))
AND (sqlc.narg(cursor_time)::timestamptz IS NULL OR (created_at,id)<(sqlc.narg(cursor_time),sqlc.arg(cursor_id)::uuid))
ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(page_limit);
