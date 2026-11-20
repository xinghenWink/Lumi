-- +goose Up
ALTER TABLE image_tasks DROP CONSTRAINT image_tasks_quality_check,
    ADD CONSTRAINT image_tasks_quality_check CHECK (quality IN ('low', 'medium', 'high', 'xhigh', 'max'));

ALTER TABLE credit_charges DROP CONSTRAINT credit_charges_quality_check,
    ADD CONSTRAINT credit_charges_quality_check CHECK (quality IN ('low', 'medium', 'high', 'xhigh', 'max'));

ALTER TABLE pricing_rules DROP CONSTRAINT pricing_rules_quality_check,
    ADD CONSTRAINT pricing_rules_quality_check CHECK (
        quality IN ('low', 'medium', 'high') OR (model_id IS NOT NULL AND quality IN ('xhigh', 'max'))
    );
