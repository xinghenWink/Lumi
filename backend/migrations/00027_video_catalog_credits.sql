-- +goose Up
ALTER TABLE models DROP CONSTRAINT models_type_check;
ALTER TABLE models ADD CONSTRAINT models_type_check CHECK (type IN ('chat','image','video'));
ALTER TABLE model_routes ADD COLUMN video_protocol text NOT NULL DEFAULT '',
    ADD COLUMN video_profile text NOT NULL DEFAULT '',
    ADD COLUMN video_capabilities jsonb NOT NULL DEFAULT 'null' CHECK (jsonb_typeof(video_capabilities) IN ('null','object'));
ALTER TABLE model_routes DROP CONSTRAINT model_routes_model_id_upstream_id_upstream_model_name_key;
ALTER TABLE model_routes ADD UNIQUE (model_id,upstream_id,upstream_model_name,video_protocol,video_profile);
ALTER TABLE credit_accounts ADD COLUMN video_balance bigint NOT NULL DEFAULT 0 CHECK (video_balance BETWEEN 0 AND 1000000000000);
ALTER TABLE credit_ledger DROP CONSTRAINT credit_ledger_type_check, DROP CONSTRAINT credit_ledger_bucket_check;
ALTER TABLE credit_ledger ADD CHECK (type IN ('signup_bonus','daily_grant','daily_expire','redeem','admin_adjust','image_charge','image_refund','referral_inviter_bonus','referral_invitee_bonus','video_charge','video_refund')),
    ADD CHECK (bucket IN ('daily','permanent','video'));
ALTER TABLE redeem_batches ADD COLUMN credit_bucket text NOT NULL DEFAULT 'permanent' CHECK (credit_bucket IN ('permanent','video'));
ALTER TABLE redeem_codes ADD COLUMN credit_bucket text NOT NULL DEFAULT 'permanent' CHECK (credit_bucket IN ('permanent','video'));
ALTER TABLE redeem_records ADD COLUMN credit_bucket text NOT NULL DEFAULT 'permanent' CHECK (credit_bucket IN ('permanent','video'));
CREATE TABLE video_credit_settings (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    pool text NOT NULL DEFAULT 'video' CHECK (pool IN ('video','permanent')),
    version bigint NOT NULL DEFAULT 0
);
INSERT INTO video_credit_settings DEFAULT VALUES;
CREATE TABLE video_pricing (
    model_id uuid PRIMARY KEY REFERENCES models(id) ON DELETE CASCADE,
    mode text NOT NULL CHECK (mode IN ('second','clip')),
    rates jsonb NOT NULL CHECK (jsonb_typeof(rates)='array'),
    version bigint NOT NULL DEFAULT 1
);
