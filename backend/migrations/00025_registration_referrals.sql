-- +goose Up
CREATE TABLE referral_codes (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    code text NOT NULL UNIQUE CHECK (code ~ '^[A-F0-9]{16}$')
);

-- Keep financial attribution after account purges, using only opaque identifiers.
CREATE TABLE registration_referrals (
    id uuid PRIMARY KEY,
    invitee_id uuid NOT NULL UNIQUE,
    inviter_id uuid NOT NULL,
    inviter_credits bigint NOT NULL CHECK (inviter_credits BETWEEN 0 AND 1000000000),
    invitee_credits bigint NOT NULL CHECK (invitee_credits BETWEEN 0 AND 1000000000),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (inviter_id <> invitee_id)
);

ALTER TABLE credit_ledger DROP CONSTRAINT credit_ledger_type_check,
    ADD CONSTRAINT credit_ledger_type_check CHECK (type IN (
        'signup_bonus', 'daily_grant', 'daily_expire', 'redeem', 'admin_adjust',
        'image_charge', 'image_refund', 'referral_inviter_bonus', 'referral_invitee_bonus'
    ));
