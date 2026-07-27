ALTER TABLE notification_events
  ADD COLUMN IF NOT EXISTS delivery_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_claim_owner TEXT,
  ADD COLUMN IF NOT EXISTS delivery_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE generated_reports
  ADD COLUMN IF NOT EXISTS delivery_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_claim_owner TEXT,
  ADD COLUMN IF NOT EXISTS delivery_attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_notification_events_reclaimable
  ON notification_events(status, delivery_claimed_at)
  WHERE idempotency_key IS NOT NULL AND status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_generated_reports_reclaimable
  ON generated_reports(delivery_status, delivery_claimed_at)
  WHERE delivery_status IN ('pending', 'failed', 'sending');
