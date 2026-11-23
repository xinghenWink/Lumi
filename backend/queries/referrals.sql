-- name: GetReferralCode :one
SELECT code FROM referral_codes WHERE user_id = $1;

-- name: CreateReferralCode :one
INSERT INTO referral_codes (user_id, code) VALUES ($1, $2)
ON CONFLICT (code) DO NOTHING RETURNING code;

-- name: LockReferralInviter :one
SELECT u.id FROM referral_codes r JOIN users u ON u.id = r.user_id
WHERE r.code = $1 AND u.status = 'active' AND u.deleted_at IS NULL
FOR SHARE OF u;

-- name: CreateRegistrationReferral :exec
INSERT INTO registration_referrals (id, invitee_id, inviter_id, inviter_credits, invitee_credits)
VALUES ($1, $2, $3, $4, $5);
