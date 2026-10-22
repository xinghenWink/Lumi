-- name: CreatePasswordReset :exec
INSERT INTO password_resets(token_hash,user_id,token_version,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes');
-- name: GetPasswordReset :one
SELECT * FROM password_resets WHERE token_hash=$1;
-- name: ConsumePasswordReset :execrows
UPDATE password_resets SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now();
-- name: InvalidatePasswordResets :exec
UPDATE password_resets SET used_at=now() WHERE user_id=$1 AND used_at IS NULL;
-- name: ActiveDevices :many
SELECT DISTINCT ON (family_id) family_id,device,ip,user_agent,created_at,expires_at
FROM user_sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now()
ORDER BY family_id,created_at DESC;
-- name: ActiveDevicePage :many
WITH devices AS (
 SELECT DISTINCT ON (family_id) family_id,device,ip,user_agent,created_at,expires_at
 FROM user_sessions WHERE user_id=sqlc.arg(user_id) AND revoked_at IS NULL AND expires_at>now()
 ORDER BY family_id,created_at DESC
)
SELECT * FROM devices WHERE sqlc.narg(cursor_time)::timestamptz IS NULL OR (created_at,family_id)<(sqlc.narg(cursor_time),sqlc.arg(cursor_id)::uuid)
ORDER BY created_at DESC,family_id DESC LIMIT sqlc.arg(page_limit);
-- name: RevokeOwnedDevice :execrows
UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND family_id=$2 AND revoked_at IS NULL;
-- name: GetPreferences :one
SELECT * FROM user_preferences WHERE user_id=$1;
-- name: SavePreferences :one
INSERT INTO user_preferences(user_id,theme,instructions,image_quality,image_ratio,image_count) VALUES($1,$2,$3,$4,$5,$6)
ON CONFLICT(user_id) DO UPDATE SET theme=excluded.theme,instructions=excluded.instructions,image_quality=excluded.image_quality,image_ratio=excluded.image_ratio,image_count=excluded.image_count RETURNING *;
-- name: DeleteOwnAccount :exec
UPDATE users SET deleted_at=now(),purge_after=now()+interval '7 days',token_version=token_version+1 WHERE id=$1;
-- name: DueSelfDeletedUsers :many
SELECT * FROM users WHERE deleted_at IS NOT NULL AND purge_after<=now()
AND NOT EXISTS(SELECT 1 FROM credit_charges c WHERE c.user_id=users.id AND NOT c.settled)
ORDER BY purge_after,id LIMIT 100 FOR UPDATE SKIP LOCKED;
-- name: PurgeSelfDeletedUser :exec
DELETE FROM users WHERE users.id=$1 AND deleted_at IS NOT NULL AND purge_after<=now()
AND NOT EXISTS(SELECT 1 FROM credit_charges c WHERE c.user_id=users.id AND NOT c.settled);
-- name: CleanupAuthArtifacts :exec
DELETE FROM password_resets WHERE expires_at<now()-interval '1 day';
-- name: CleanupVerificationArtifacts :exec
DELETE FROM verification_codes WHERE expires_at<now()-interval '1 day';
-- name: CleanupSessions :exec
DELETE FROM user_sessions WHERE family_id IN (SELECT family_id FROM user_sessions GROUP BY family_id HAVING max(expires_at)<now()-interval '1 day');
-- name: ListAnnouncements :many
SELECT * FROM announcements WHERE (NOT sqlc.arg(active_only)::boolean OR (enabled AND starts_at<=now() AND (ends_at IS NULL OR ends_at>now())))
AND (sqlc.narg(cursor_time)::timestamptz IS NULL OR (created_at,id)<(sqlc.narg(cursor_time),sqlc.arg(cursor_id)::uuid))
ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(page_limit);
-- name: GetAnnouncement :one
SELECT * FROM announcements WHERE id=$1 FOR UPDATE;
-- name: CreateAnnouncement :one
INSERT INTO announcements(id,content,starts_at,ends_at,enabled) VALUES($1,$2,$3,$4,$5) RETURNING *;
-- name: UpdateAnnouncement :one
UPDATE announcements SET content=$2,starts_at=$3,ends_at=$4,enabled=$5,version=version+1 WHERE id=$1 AND version=$6 RETURNING *;
-- name: DeleteAnnouncement :exec
DELETE FROM announcements WHERE id=$1;
-- name: AcquireCircuitProbe :execrows
UPDATE upstreams SET probe_until=now()+interval '10 minutes' WHERE id=$1 AND open_until<=now() AND (probe_until IS NULL OR probe_until<=now());
-- name: RecordCircuitSuccess :exec
-- Healthy calls must not serialize behind redundant updates of the same channel row.
UPDATE upstreams SET consecutive_failures=0,open_until=NULL,probe_until=NULL,last_error='' WHERE id=$1
AND (consecutive_failures<>0 OR open_until IS NOT NULL OR probe_until IS NOT NULL OR last_error<>'');
-- name: RecordCircuitFailure :exec
UPDATE upstreams SET consecutive_failures=least(consecutive_failures+1,1000000),last_error=$2,
open_until=CASE WHEN consecutive_failures+1>=sqlc.arg(threshold)::integer OR open_until IS NOT NULL THEN now()+make_interval(secs=>sqlc.arg(duration)::integer) ELSE open_until END,probe_until=NULL WHERE id=$1;
-- name: RecordJobRun :exec
INSERT INTO job_runs(name,affected) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET completed_at=now(),affected=excluded.affected;
-- name: GetJobRun :one
SELECT * FROM job_runs WHERE name=$1;
-- name: CreditDiscrepancies :many
SELECT a.user_id,a.permanent_balance,a.daily_balance,coalesce(sum(l.delta) FILTER(WHERE l.bucket='permanent'),0)::bigint AS ledger_permanent,coalesce(sum(l.delta) FILTER(WHERE l.bucket='daily'),0)::bigint AS ledger_daily
FROM credit_accounts a LEFT JOIN credit_ledger l ON l.user_id=a.user_id
GROUP BY a.user_id HAVING a.permanent_balance<>coalesce(sum(l.delta) FILTER(WHERE l.bucket='permanent'),0) OR a.daily_balance<>coalesce(sum(l.delta) FILTER(WHERE l.bucket='daily'),0);
-- name: AdminChatConversations :many
SELECT c.* FROM conversations c WHERE c.type='chat' AND c.deleted_at IS NULL
AND (sqlc.narg(owner)::uuid IS NULL OR c.user_id=sqlc.narg(owner))
AND (sqlc.narg(cursor_time)::timestamptz IS NULL OR (c.last_message_at,c.id)<(sqlc.narg(cursor_time),sqlc.arg(cursor_id)::uuid))
ORDER BY c.last_message_at DESC,c.id DESC LIMIT sqlc.arg(page_limit);
-- name: SearchChatConversations :many
SELECT c.* FROM conversations c WHERE c.user_id=$1 AND c.type='chat' AND c.deleted_at IS NULL
AND (c.title ILIKE '%'||sqlc.arg(search)::text||'%' OR EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.content ILIKE '%'||sqlc.arg(search)||'%'))
AND (sqlc.narg(cursor_time)::timestamptz IS NULL OR (c.last_message_at,c.id)<(sqlc.narg(cursor_time),sqlc.arg(cursor_id)::uuid))
ORDER BY c.last_message_at DESC,c.id DESC LIMIT sqlc.arg(page_limit);
-- name: SetMessageReferences :exec
UPDATE messages SET reference_file_ids=$2 WHERE id=$1;
-- name: AvailableModelRoutes :many
SELECT sqlc.embed(u),r.upstream_model_name,r.priority AS route_priority,r.weight AS route_weight
FROM model_routes r JOIN upstreams u ON u.id=r.upstream_id
WHERE r.model_id=$1 AND r.enabled AND u.enabled AND u.api_key_enc<>'' AND (u.open_until IS NULL OR u.open_until<=now())
ORDER BY r.priority,u.priority,r.id LIMIT 100;
-- name: CountUpstreams :one
SELECT (SELECT count(*) FROM upstreams)+(SELECT count(*) FROM models);
-- name: AddManualRefund :exec
UPDATE image_tasks SET refunded_cost=total_cost,version=version+1 WHERE id=$1;
-- name: OperationsTaskCounts :many
SELECT status,count(*)::bigint AS count FROM image_tasks GROUP BY status;
-- name: OperationsUpstreamStats :many
SELECT upstream_id,count(*)::bigint AS calls,count(*) FILTER(WHERE error_summary='')::bigint AS successes,coalesce(avg(latency_ms),0)::bigint AS latency_ms FROM upstream_calls WHERE created_at>=date_trunc('day',now())-make_interval(days=>sqlc.arg(days)::integer-1) GROUP BY upstream_id;
-- name: DashboardTotals :one
SELECT (SELECT count(*) FROM users WHERE deleted_at IS NULL)::bigint AS users,
(SELECT count(*) FROM conversations WHERE active_run_id IS NOT NULL)::bigint AS active_streams,
(SELECT count(*) FROM credit_ledger)::bigint AS credit_changes;
-- name: DashboardTrend :many
WITH days AS (SELECT generate_series(date_trunc('day',now())-make_interval(days=>sqlc.arg(days)::integer-1),date_trunc('day',now()),interval '1 day') AS day)
SELECT d.day::timestamptz AS day,
(SELECT count(*) FROM users u WHERE u.created_at>=d.day AND u.created_at<d.day+interval '1 day')::bigint AS new_users,
(SELECT count(DISTINCT user_id) FROM (
 SELECT user_id FROM user_sessions s WHERE s.created_at>=d.day AND s.created_at<d.day+interval '1 day'
 UNION SELECT c.user_id FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.role='user' AND m.created_at>=d.day AND m.created_at<d.day+interval '1 day'
 UNION SELECT user_id FROM image_tasks t WHERE t.created_at>=d.day AND t.created_at<d.day+interval '1 day'
) activity)::bigint AS active_users,
(SELECT count(*) FROM messages m WHERE role='user' AND m.created_at>=d.day AND m.created_at<d.day+interval '1 day')::bigint AS chat_messages,
(SELECT coalesce(sum(successful_images),0) FROM image_tasks t WHERE finished_at>=d.day AND finished_at<d.day+interval '1 day')::bigint AS image_success,
(SELECT coalesce(sum(image_count-successful_images),0) FROM image_tasks t WHERE status IN ('succeeded','partial','failed','canceled') AND finished_at>=d.day AND finished_at<d.day+interval '1 day')::bigint AS image_failed,
(SELECT coalesce(sum(delta) FILTER(WHERE delta>0 AND type<>'image_refund'),0) FROM credit_ledger l WHERE created_at>=d.day AND created_at<d.day+interval '1 day')::bigint AS credits_granted,
(SELECT greatest(0,coalesce(-sum(delta) FILTER(WHERE type IN ('image_charge','image_refund')),0)) FROM credit_ledger l WHERE created_at>=d.day AND created_at<d.day+interval '1 day')::bigint AS credits_spent,
(SELECT coalesce(sum(delta),0) FROM credit_ledger l WHERE type='signup_bonus' AND created_at>=d.day AND created_at<d.day+interval '1 day')::bigint AS signup_credits,
(SELECT coalesce(sum(delta),0) FROM credit_ledger l WHERE type='daily_grant' AND created_at>=d.day AND created_at<d.day+interval '1 day')::bigint AS daily_credits,
(SELECT coalesce(sum(delta),0) FROM credit_ledger l WHERE type='redeem' AND created_at>=d.day AND created_at<d.day+interval '1 day')::bigint AS redeem_credits,
(SELECT coalesce(sum(delta) FILTER(WHERE delta>0),0) FROM credit_ledger l WHERE type='admin_adjust' AND created_at>=d.day AND created_at<d.day+interval '1 day')::bigint AS admin_credits
FROM days d ORDER BY d.day;
