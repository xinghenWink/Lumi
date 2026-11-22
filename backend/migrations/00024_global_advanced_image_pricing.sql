-- +goose Up
ALTER TABLE pricing_rules DROP CONSTRAINT pricing_rules_quality_check,
    ADD CONSTRAINT pricing_rules_quality_check CHECK (quality IN ('low', 'medium', 'high', 'xhigh', 'max'));

INSERT INTO pricing_rules (id, operation, quality, credits_per_image, enabled)
SELECT gen_random_uuid(), base.operation, tier.quality, base.credits_per_image, true
FROM pricing_rules AS base
CROSS JOIN (VALUES ('xhigh'), ('max')) AS tier(quality)
WHERE base.model_id IS NULL AND base.quality = 'high'
ON CONFLICT (model_id, operation, quality) DO NOTHING;
