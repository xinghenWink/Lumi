-- name: LockCreditUser :one
SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL FOR SHARE;

-- name: LockCreditAccount :one
SELECT * FROM credit_accounts WHERE user_id = $1 FOR UPDATE;

-- name: ReadCurrentCreditAccount :one
-- Current-day balance views use a committed snapshot without taking financial write locks.
SELECT a.* FROM credit_accounts a JOIN users u ON u.id=a.user_id
WHERE a.user_id=sqlc.arg(user_id) AND u.deleted_at IS NULL
  AND a.daily_reset_on>=sqlc.arg(today)::date;

-- name: ReadCreditAccount :one
-- Keep lazy reset and both immutable ledger entries in one atomic statement.
-- Lock the owner before the account, matching every other financial mutation.
WITH owner AS MATERIALIZED (
    SELECT u.id FROM users u WHERE u.id=sqlc.arg(user_id) AND u.deleted_at IS NULL FOR SHARE OF u
), locked AS MATERIALIZED (
    SELECT a.* FROM credit_accounts a JOIN owner o ON o.id=a.user_id FOR UPDATE OF a
), changed AS (
    UPDATE credit_accounts a SET daily_balance=sqlc.arg(grant_amount)::bigint,
        daily_reset_on=sqlc.arg(today)::date,
        version=a.version+1+(CASE WHEN l.daily_balance>0 THEN 1 ELSE 0 END)+(CASE WHEN sqlc.arg(grant_amount)::bigint>0 THEN 1 ELSE 0 END)
    FROM locked l WHERE a.user_id=l.user_id AND (l.daily_reset_on IS NULL OR l.daily_reset_on<sqlc.arg(today)::date)
    RETURNING a.*
), expired AS (
    INSERT INTO credit_ledger(id,user_id,type,bucket,delta,bucket_balance_after,total_after,idempotency_key)
    SELECT sqlc.arg(expire_id)::uuid,l.user_id,'daily_expire','daily',-l.daily_balance,0,l.permanent_balance,
        'daily:'||l.user_id::text||':'||to_char(c.daily_reset_on,'YYYY-MM-DD')||':expire'
    FROM changed c JOIN locked l ON l.user_id=c.user_id WHERE l.daily_balance>0
    RETURNING id
), granted AS (
    INSERT INTO credit_ledger(id,user_id,type,bucket,delta,bucket_balance_after,total_after,idempotency_key)
    SELECT sqlc.arg(grant_id)::uuid,c.user_id,'daily_grant','daily',c.daily_balance,c.daily_balance,c.permanent_balance+c.daily_balance,
        'daily:'||c.user_id::text||':'||to_char(c.daily_reset_on,'YYYY-MM-DD')||':grant'
    FROM changed c WHERE c.daily_balance>0
    RETURNING id
)
SELECT l.user_id,l.permanent_balance,
    (CASE WHEN c.user_id IS NULL THEN l.daily_balance ELSE c.daily_balance END)::bigint AS daily_balance,
    coalesce(c.daily_reset_on,l.daily_reset_on)::date AS daily_reset_on,
    coalesce(c.version,l.version)::bigint AS version
FROM locked l LEFT JOIN changed c ON c.user_id=l.user_id;

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
