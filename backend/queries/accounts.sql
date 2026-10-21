-- name: CreateUser :one
INSERT INTO users (id, email, password_hash, nickname, role, status, terms_accepted_at)
VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;

-- name: GetUser :one
SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL;

-- name: GetUserForUpdate :one
SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL;

-- name: GetAuthenticatedUser :one
SELECT u.* FROM users u WHERE u.id = $1 AND u.token_version = $2 AND u.status = 'active'
AND u.deleted_at IS NULL AND EXISTS (SELECT 1 FROM user_sessions s WHERE s.user_id = u.id
AND s.family_id = $3 AND s.revoked_at IS NULL AND s.expires_at > now());

-- name: LockRegistration :exec
SELECT pg_advisory_xact_lock(hashtextextended($1::text, 6218401002));

-- name: UpdateLogin :exec
UPDATE users SET last_login_at = now(), last_login_ip = $2, updated_at = now() WHERE id = $1;

-- name: UpdateUser :one
UPDATE users SET email = $2, nickname = $3, role = $4, status = $5,
password_hash = $6, token_version = $7, locale = $8, timezone = $9, updated_at = now()
WHERE id = $1 AND deleted_at IS NULL RETURNING *;

-- name: SoftDeleteUser :exec
UPDATE users SET deleted_at = now(), updated_at = now(), token_version = token_version + 1
WHERE id = $1 AND deleted_at IS NULL;

-- name: CountActiveAdmins :one
SELECT count(*) FROM users WHERE role = 'admin' AND status = 'active' AND deleted_at IS NULL;

-- name: CountAllAdmins :one
SELECT count(*) FROM users WHERE role = 'admin';

-- name: LockAdminChanges :exec
SELECT pg_advisory_xact_lock(6218401001);

-- name: ListUsers :many
SELECT * FROM users
WHERE deleted_at IS NULL
  AND (sqlc.arg(search)::text = '' OR email::text ILIKE '%' || sqlc.arg(search) || '%'
       OR nickname ILIKE '%' || sqlc.arg(search) || '%' OR id::text = sqlc.arg(search))
  AND (sqlc.arg(role_filter)::text = '' OR role = sqlc.arg(role_filter))
  AND (sqlc.arg(status_filter)::text = '' OR status = sqlc.arg(status_filter))
  AND (sqlc.narg(created_from)::timestamptz IS NULL OR created_at >= sqlc.narg(created_from))
  AND (sqlc.narg(created_until)::timestamptz IS NULL OR created_at < sqlc.narg(created_until))
  AND (sqlc.narg(cursor_time)::timestamptz IS NULL OR
    (CASE WHEN sqlc.arg(sort_by)::text = 'last_login_at' THEN coalesce(last_login_at, '1970-01-01'::timestamptz) ELSE created_at END, id)
    < (sqlc.narg(cursor_time)::timestamptz, sqlc.arg(cursor_id)::uuid))
ORDER BY CASE WHEN sqlc.arg(sort_by)::text = 'last_login_at' THEN coalesce(last_login_at, '1970-01-01'::timestamptz) ELSE created_at END DESC, id DESC
LIMIT sqlc.arg(page_limit);

-- name: CreateSession :one
INSERT INTO user_sessions (id, user_id, family_id, token_hash, device, ip, user_agent, expires_at, rotated_from)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *;

-- name: GetSessionByHash :one
SELECT * FROM user_sessions WHERE token_hash = $1;

-- name: GetSessionByHashForUpdate :one
SELECT * FROM user_sessions WHERE token_hash = $1 FOR UPDATE;

-- name: HasActiveFamily :one
SELECT EXISTS(SELECT 1 FROM user_sessions WHERE family_id = $1 AND user_id = $2
AND revoked_at IS NULL AND expires_at > now());

-- name: RevokeSession :exec
UPDATE user_sessions SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1;

-- name: RevokeFamily :exec
UPDATE user_sessions SET revoked_at = coalesce(revoked_at, now()) WHERE family_id = $1;

-- name: RevokeUserSessions :exec
UPDATE user_sessions SET revoked_at = coalesce(revoked_at, now()) WHERE user_id = $1;

-- name: ListUserSessions :many
SELECT id, device, ip, user_agent, created_at, expires_at, revoked_at
FROM user_sessions WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 20;

-- name: InvalidateVerificationCodes :exec
UPDATE verification_codes SET used_at = now() WHERE target = $1 AND purpose = 'register' AND used_at IS NULL;

-- name: CreateVerificationCode :exec
INSERT INTO verification_codes (id, target, purpose, code_hash, expires_at)
VALUES ($1, $2, 'register', $3, $4);

-- name: GetVerificationForUpdate :one
SELECT * FROM verification_codes WHERE target = $1 AND purpose = 'register'
AND used_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

-- name: FailVerification :exec
UPDATE verification_codes SET attempts = least(attempts + 1, 5) WHERE id = $1;

-- name: ConsumeVerification :exec
UPDATE verification_codes SET used_at = now() WHERE id = $1;
