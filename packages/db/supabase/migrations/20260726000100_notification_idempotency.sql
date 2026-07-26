ALTER TABLE notification_events
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_events_idempotency
  ON notification_events(clinic_id, idempotency_key)
  WHERE clinic_id IS NOT NULL AND idempotency_key IS NOT NULL;
