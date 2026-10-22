-- name: LockChatUser :exec
SELECT pg_advisory_xact_lock(hashtextextended(sqlc.arg(user_id)::text,7244));

-- name: GetChatSettings :one
SELECT * FROM chat_settings WHERE singleton;

-- name: SaveChatSettings :one
UPDATE chat_settings SET per_minute=$1,per_day=$2,context_messages=$3,context_tokens=$4,system_prompt=$5,title_model_id=$6,version=version+1 WHERE singleton AND version=$7 RETURNING *;

-- name: CreateConversation :exec
INSERT INTO conversations (id,user_id,model_id) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING;

-- name: GetConversation :one
SELECT * FROM conversations WHERE id=$1 AND user_id=$2 AND type='chat' AND deleted_at IS NULL;

-- name: LockConversation :one
SELECT * FROM conversations WHERE id=$1 AND user_id=$2 AND type='chat' AND deleted_at IS NULL FOR UPDATE;

-- name: ListConversations :many
SELECT * FROM conversations WHERE user_id=sqlc.arg(user_id) AND type='chat' AND deleted_at IS NULL
AND (sqlc.arg(search)::text='' OR title ILIKE '%'||sqlc.arg(search)::text||'%')
AND (sqlc.narg(cursor_time)::timestamptz IS NULL OR (pinned,last_message_at,id) < (sqlc.narg(cursor_pinned)::boolean,sqlc.narg(cursor_time)::timestamptz,sqlc.narg(cursor_id)::uuid))
ORDER BY pinned DESC,last_message_at DESC,id DESC LIMIT sqlc.arg(page_limit);

-- name: UpdateConversation :one
UPDATE conversations SET title=$3,pinned=$4,title_auto=false,version=version+1 WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL AND type='chat' AND version=$5 RETURNING *;

-- name: DeleteChatConversations :many
UPDATE conversations SET deleted_at=now(),cancel_requested=true,version=version+1 WHERE user_id=sqlc.arg(user_id) AND type='chat' AND deleted_at IS NULL AND (sqlc.arg(clear_all)::boolean OR id=ANY(sqlc.arg(ids)::uuid[])) RETURNING id;

-- name: ListChatMessages :many
SELECT * FROM messages WHERE conversation_id=$1 AND deleted_at IS NULL
AND (sqlc.narg(cursor_time)::timestamptz IS NULL OR (created_at,id) < (sqlc.narg(cursor_time)::timestamptz,sqlc.narg(cursor_id)::uuid))
ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(page_limit);

-- name: ChatMessageByRequest :one
SELECT * FROM messages WHERE conversation_id=$1 AND request_id=$2 AND role='assistant';

-- name: InsertChatMessage :one
INSERT INTO messages (id,conversation_id,request_id,role,content,status,model_id,request_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *;

-- name: ReplaceLastChatTurn :exec
UPDATE messages SET deleted_at=now() WHERE conversation_id=$1 AND deleted_at IS NULL AND (id=$2 OR (role='assistant' AND created_at>=$3));

-- name: StartChatRun :one
UPDATE conversations SET active_run_id=$3,lease_until=now()+interval '45 seconds',cancel_requested=false,model_id=$4,last_message_at=now(),version=version+1 WHERE id=$1 AND user_id=$2 AND active_run_id IS NULL AND deleted_at IS NULL RETURNING *;

-- name: CheckpointChatMessage :execrows
UPDATE messages SET content=$2,status=$3,upstream_id=$4,meta=$5 WHERE id=$1 AND status='streaming';

-- name: HeartbeatChatRun :one
UPDATE conversations SET lease_until=now()+interval '45 seconds' WHERE id=$1 AND active_run_id=$2 RETURNING cancel_requested,deleted_at;

-- name: FinishChatRun :exec
UPDATE conversations SET active_run_id=NULL,lease_until=NULL,cancel_requested=false WHERE id=$1 AND active_run_id=$2;

-- name: CancelChatRun :exec
UPDATE conversations SET cancel_requested=true WHERE id=$1 AND user_id=$2 AND type='chat' AND deleted_at IS NULL AND active_run_id IS NOT NULL;

-- name: AutoTitleConversation :one
UPDATE conversations SET title=$2,title_auto=false,version=version+1 WHERE id=$1 AND title_auto AND deleted_at IS NULL RETURNING *;

-- name: UseChatDailyQuota :one
INSERT INTO chat_daily_usage (user_id,day,count) VALUES ($1,(now() AT TIME ZONE 'UTC')::date,1)
ON CONFLICT (user_id,day) DO UPDATE SET count=chat_daily_usage.count+1
WHERE sqlc.arg(daily_limit)::integer=0 OR chat_daily_usage.count<sqlc.arg(daily_limit)::integer RETURNING count;

-- name: ChatRouteTargets :many
SELECT r.id AS route_id,r.upstream_model_name,u.* FROM model_routes r JOIN upstreams u ON r.upstream_id=u.id JOIN models m ON m.id=r.model_id
WHERE m.id=$1 AND m.type='chat' AND m.enabled AND r.enabled AND u.enabled AND u.api_key_enc<>''
ORDER BY r.priority,u.priority,r.id LIMIT 20;

-- name: RecoverChatRuns :execrows
WITH expired AS (
    SELECT id,active_run_id FROM conversations WHERE active_run_id IS NOT NULL AND lease_until<now() ORDER BY lease_until LIMIT 100 FOR UPDATE SKIP LOCKED
), stopped AS (
    UPDATE messages SET status='interrupted',meta=meta||'{"error_code":"CHAT_INTERRUPTED"}'::jsonb FROM expired WHERE messages.id=expired.active_run_id AND messages.status='streaming'
)
UPDATE conversations SET active_run_id=NULL,lease_until=NULL,cancel_requested=false FROM expired WHERE conversations.id=expired.id;

-- name: PruneChatDailyUsage :exec
DELETE FROM chat_daily_usage WHERE day<(now() AT TIME ZONE 'UTC')::date-35;
