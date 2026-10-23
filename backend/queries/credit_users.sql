-- name: ListUsersWithCredits :many
WITH balances AS (
    SELECT c.user_id, (c.permanent_balance +
      CASE WHEN c.daily_reset_on IS NULL OR c.daily_reset_on<sqlc.arg(today)::date
           THEN sqlc.arg(daily_grant)::bigint ELSE c.daily_balance END)::bigint AS credit_total
    FROM credit_accounts c
)
SELECT sqlc.embed(u), b.credit_total FROM users u JOIN balances b ON b.user_id=u.id
WHERE u.deleted_at IS NULL
AND (sqlc.arg(search)::text='' OR u.email::text ILIKE '%'||sqlc.arg(search)||'%'
 OR u.nickname ILIKE '%'||sqlc.arg(search)||'%' OR u.id::text=sqlc.arg(search))
AND (sqlc.arg(role_filter)::text='' OR u.role=sqlc.arg(role_filter))
AND (sqlc.arg(status_filter)::text='' OR u.status=sqlc.arg(status_filter))
AND (sqlc.narg(created_from)::timestamptz IS NULL OR u.created_at>=sqlc.narg(created_from))
AND (sqlc.narg(created_until)::timestamptz IS NULL OR u.created_at<sqlc.narg(created_until))
AND (sqlc.narg(min_balance)::bigint IS NULL OR b.credit_total>=sqlc.narg(min_balance))
AND (sqlc.narg(max_balance)::bigint IS NULL OR b.credit_total<=sqlc.narg(max_balance))
AND ((sqlc.arg(sort_by)::text='balance' AND
  (sqlc.narg(cursor_number)::bigint IS NULL OR (b.credit_total,u.id)<(sqlc.narg(cursor_number),sqlc.arg(cursor_id)::uuid)))
 OR (sqlc.arg(sort_by)::text<>'balance' AND
  (sqlc.narg(cursor_time)::timestamptz IS NULL OR
   (CASE WHEN sqlc.arg(sort_by)::text='last_login_at' THEN coalesce(u.last_login_at,'1970-01-01'::timestamptz) ELSE u.created_at END,u.id)
     <(sqlc.narg(cursor_time)::timestamptz,sqlc.arg(cursor_id)::uuid))))
ORDER BY CASE WHEN sqlc.arg(sort_by)::text='balance' THEN b.credit_total END DESC,
  CASE WHEN sqlc.arg(sort_by)::text='last_login_at' THEN coalesce(u.last_login_at,'1970-01-01'::timestamptz)
       WHEN sqlc.arg(sort_by)::text='created_at' THEN u.created_at END DESC,u.id DESC
LIMIT sqlc.arg(page_limit);
