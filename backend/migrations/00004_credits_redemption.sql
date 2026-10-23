-- +goose Up
CREATE TABLE credit_accounts (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    permanent_balance bigint NOT NULL DEFAULT 0 CHECK (permanent_balance BETWEEN 0 AND 1000000000000),
    daily_balance bigint NOT NULL DEFAULT 0 CHECK (daily_balance BETWEEN 0 AND 1000000000000),
    daily_reset_on date,
    version bigint NOT NULL DEFAULT 0 CHECK (version >= 0)
);
INSERT INTO credit_accounts (user_id) SELECT id FROM users;

-- Keep account creation atomic even for bootstrap and maintenance callers.
-- +goose StatementBegin
CREATE FUNCTION lumi.initialize_credit_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO credit_accounts (user_id) VALUES (NEW.id);
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER initialize_credit_account AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION lumi.initialize_credit_account();

-- Financial history keeps opaque IDs after account erasure, without profile copies.
CREATE TABLE credit_ledger (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    type text NOT NULL CHECK (type IN ('signup_bonus','daily_grant','daily_expire','redeem','admin_adjust','image_charge','image_refund')),
    bucket text NOT NULL CHECK (bucket IN ('daily','permanent')),
    delta bigint NOT NULL CHECK (delta BETWEEN -1000000000000 AND 1000000000000 AND delta <> 0),
    bucket_balance_after bigint NOT NULL CHECK (bucket_balance_after BETWEEN 0 AND 1000000000000),
    total_after bigint NOT NULL CHECK (total_after BETWEEN 0 AND 2000000000000),
    ref_type text NOT NULL DEFAULT '',
    ref_id uuid,
    idempotency_key text NOT NULL UNIQUE,
    operator_id uuid,
    note text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_ledger_user_idx ON credit_ledger (user_id, created_at DESC, id DESC);
CREATE INDEX credit_ledger_created_idx ON credit_ledger (created_at DESC, id DESC);
CREATE TRIGGER credit_ledger_immutable BEFORE UPDATE OR DELETE ON credit_ledger
FOR EACH ROW EXECUTE FUNCTION lumi.protect_audit_history();

CREATE TABLE credit_operations (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    key text NOT NULL,
    kind text NOT NULL,
    request_hash text NOT NULL,
    response jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, key)
);
CREATE TRIGGER credit_operations_immutable BEFORE UPDATE OR DELETE ON credit_operations
FOR EACH ROW EXECUTE FUNCTION lumi.protect_audit_history();

CREATE TABLE credit_charges (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    reference_id uuid NOT NULL,
    model_id uuid,
    operation text NOT NULL CHECK (operation IN ('generate','edit')),
    quality text NOT NULL CHECK (quality IN ('low','medium','high')),
    size text NOT NULL,
    image_count bigint NOT NULL CHECK (image_count BETWEEN 1 AND 10),
    unit_price bigint NOT NULL CHECK (unit_price BETWEEN 0 AND 1000000000000),
    total_cost bigint NOT NULL CHECK (total_cost BETWEEN 0 AND 1000000000000),
    daily_charged bigint NOT NULL CHECK (daily_charged >= 0),
    permanent_charged bigint NOT NULL CHECK (permanent_charged >= 0),
    daily_reset_on date NOT NULL,
    failed_images bigint NOT NULL DEFAULT 0 CHECK (failed_images >= 0 AND failed_images <= image_count),
    settled boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (total_cost = unit_price * image_count),
    CHECK (total_cost = daily_charged + permanent_charged),
    UNIQUE (user_id, reference_id)
);
CREATE INDEX credit_charges_user_idx ON credit_charges (user_id, created_at DESC);

CREATE TABLE pricing_rules (
    id uuid PRIMARY KEY,
    model_id uuid,
    operation text NOT NULL CHECK (operation IN ('generate','edit')),
    quality text NOT NULL CHECK (quality IN ('low','medium','high')),
    credits_per_image bigint NOT NULL CHECK (credits_per_image BETWEEN 0 AND 1000000000),
    enabled boolean NOT NULL DEFAULT true,
    UNIQUE NULLS NOT DISTINCT (model_id, operation, quality)
);
INSERT INTO pricing_rules (id, operation, quality, credits_per_image) VALUES
('00000000-0000-4000-8000-000000000001','generate','low',5),
('00000000-0000-4000-8000-000000000002','generate','medium',7),
('00000000-0000-4000-8000-000000000003','generate','high',10),
('00000000-0000-4000-8000-000000000004','edit','low',5),
('00000000-0000-4000-8000-000000000005','edit','medium',7),
('00000000-0000-4000-8000-000000000006','edit','high',10);
INSERT INTO settings (key,value) VALUES ('credits',
'{"signup_bonus_credits":10,"daily_free_credits":5,"credits_timezone":"Asia/Shanghai","edit_multiplier":"1.00","size_multipliers":{"1024x1024":"1.00","1536x1024":"1.00","1024x1536":"1.00"}}');

CREATE TABLE redeem_batches (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    note text NOT NULL DEFAULT '',
    prefix text NOT NULL DEFAULT '',
    quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
    credits bigint NOT NULL CHECK (credits BETWEEN 1 AND 1000000000),
    max_uses integer NOT NULL CHECK (max_uses BETWEEN 1 AND 1000000),
    expires_at timestamptz,
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE redeem_codes (
    id uuid PRIMARY KEY,
    batch_id uuid NOT NULL REFERENCES redeem_batches(id),
    code_hash text NOT NULL UNIQUE,
    code_encrypted text NOT NULL,
    tail text NOT NULL,
    credits bigint NOT NULL CHECK (credits BETWEEN 1 AND 1000000000),
    max_uses integer NOT NULL CHECK (max_uses BETWEEN 1 AND 1000000),
    used_count integer NOT NULL DEFAULT 0 CHECK (used_count BETWEEN 0 AND max_uses),
    enabled boolean NOT NULL DEFAULT true,
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX redeem_codes_batch_idx ON redeem_codes (batch_id, created_at DESC, id DESC);
CREATE INDEX redeem_codes_created_idx ON redeem_codes (created_at DESC, id DESC);
CREATE TABLE redeem_records (
    id uuid PRIMARY KEY,
    code_id uuid NOT NULL REFERENCES redeem_codes(id),
    user_id uuid NOT NULL,
    code_tail text NOT NULL,
    credits bigint NOT NULL CHECK (credits > 0),
    ip inet NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (code_id, user_id)
);
CREATE INDEX redeem_records_user_idx ON redeem_records (user_id, created_at DESC, id DESC);
CREATE INDEX redeem_records_created_idx ON redeem_records (created_at DESC, id DESC);
CREATE TRIGGER redeem_records_immutable BEFORE UPDATE OR DELETE ON redeem_records
FOR EACH ROW EXECUTE FUNCTION lumi.protect_audit_history();
