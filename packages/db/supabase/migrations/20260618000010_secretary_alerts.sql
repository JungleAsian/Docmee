-- P07: Secretary Alerts
--
-- The P02 schema modelled notification_events as a low-level delivery log
-- (notification_type = channel: email/sms/push/in_app). P07 layers the secretary
-- alert taxonomy on top of the same table rather than introducing a parallel
-- "notifications" table:
--   - alert_type      → one of the 17 P07 NotificationType values (emergency, …)
--   - priority        → p1 | p2 | standard (dispatch ordering)
--   - conversation_id → the conversation that triggered the alert (nullable)
--   - acknowledged_at → set when a secretary acknowledges the alert in the panel
-- and the status CHECK is widened to allow 'acknowledged'.
--
-- clinic_users.last_seen powers the timeout monitor (is a secretary present?).

ALTER TABLE clinic_users
  ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;

ALTER TABLE notification_events
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS alert_type      TEXT,
  ADD COLUMN IF NOT EXISTS priority        TEXT,
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;

ALTER TABLE notification_events DROP CONSTRAINT IF EXISTS notif_status_check;
ALTER TABLE notification_events
  ADD CONSTRAINT notif_status_check
  CHECK (status IN ('pending', 'sent', 'failed', 'skipped', 'acknowledged'));

CREATE INDEX IF NOT EXISTS idx_notif_events_conversation ON notification_events(conversation_id);
CREATE INDEX IF NOT EXISTS idx_notif_events_alert_type   ON notification_events(clinic_id, alert_type, created_at DESC);
