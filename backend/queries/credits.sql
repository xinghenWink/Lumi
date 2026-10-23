-- name: LockCreditUser :one
SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL FOR SHARE;

-- name: LockCreditAccount :one
SELECT * FROM credit_accounts WHERE user_id = $1 FOR UPDATE;

-- name: LockCreditOwnerForSettlement :one
SELECT * FROM users WHERE id=$1 FOR SHARE;

-- name: SaveCreditAccount :exec
UPDATE credit_accounts SET permanent_balance=$2, daily_balance=$3, daily_reset_on=$4, version=version+1 WHERE user_id=$1;

-- name: AppendCreditLedger :exec
INSERT INTO credit_ledger (id,user_id,type,bucket,delta,bucket_balance_after,total_after,ref_type,ref_id,idempotency_key,operator_id,note)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12);

-- name: LockCreditOperation :exec
SELECT pg_advisory_xact_lock(hashtextextended($1::text, 6218401003));

-- name: GetCreditOperation :one
SELECT * FROM credit_operations WHERE user_id=$1 AND key=$2;

-- name: CreateCreditOperation :exec
INSERT INTO credit_operations (id,user_id,key,kind,request_hash,response) VALUES ($1,$2,$3,$4,$5,$6);

-- name: GetCreditConfiguration :one
SELECT value FROM settings WHERE key='credits';

-- name: LockCreditConfiguration :exec
SELECT pg_advisory_xact_lock(6218401004);

-- name: ReadCreditConfigurationLock :exec
SELECT pg_advisory_xact_lock_shared(6218401004);

-- name: ListPricingRules :many
SELECT * FROM pricing_rules ORDER BY model_id NULLS FIRST, operation, quality;

-- name: GetEffectivePricing :one
SELECT * FROM pricing_rules WHERE (model_id=$1 OR model_id IS NULL) AND operation=$2 AND quality=$3
ORDER BY model_id NULLS LAST LIMIT 1;

-- name: ClearPricingRules :exec
DELETE FROM pricing_rules;

-- name: CreatePricingRule :exec
INSERT INTO pricing_rules (id,model_id,operation,quality,credits_per_image,enabled) VALUES ($1,$2,$3,$4,$5,$6);

-- name: ListCreditLedger :many
SELECT * FROM credit_ledger
WHERE (sqlc.narg(user_filter)::uuid IS NULL OR user_id=sqlc.narg(user_filter))
AND (sqlc.arg(type_filter)::text='' OR type=sqlc.arg(type_filter))
AND (sqlc.narg(created_from)::timestamptz IS NULL OR created_at>=sqlc.narg(created_from))
AND (sqlc.narg(created_until)::timestamptz IS NULL OR created_at<sqlc.narg(created_until))
AND (sqlc.narg(cursor_time)::timestamptz IS NULL OR (created_at,id)<(sqlc.narg(cursor_time),sqlc.arg(cursor_id)::uuid))
ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(page_limit);

-- name: CreateCreditCharge :exec
INSERT INTO credit_charges (id,user_id,reference_id,model_id,operation,quality,size,image_count,unit_price,total_cost,daily_charged,permanent_charged,daily_reset_on)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13);

-- name: LockCreditCharge :one
SELECT * FROM credit_charges WHERE id=$1 AND user_id=$2 FOR UPDATE;

-- name: SettleCreditCharge :exec
UPDATE credit_charges SET failed_images=$2, settled=true WHERE id=$1;

-- name: ListCreditUsage :many
SELECT * FROM credit_charges WHERE user_id=$1 AND created_at>=$2 ORDER BY created_at;
