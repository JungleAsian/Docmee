-- Req 39 (Mobile / PWA push): per-user Web Push subscriptions.
--
-- When a secretary enables notifications on the installed InboxOS PWA, the browser
-- PushManager hands back an endpoint + the keys (p256dh public key, auth secret)
-- needed to encrypt a push for that device (RFC 8291). We store one row per device
-- so the notification worker can fan a secretary alert out to every device the
-- recipient has enabled — even when the panel is closed.
--
-- Keyed by the push endpoint (unique): a device re-subscribing with the same
-- endpoint refreshes its keys rather than duplicating. Rows are pruned when the
-- push service reports the subscription gone (404/410) or the user disables it.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL,
  user_email  TEXT        NOT NULL,
  endpoint    TEXT        NOT NULL UNIQUE,
  p256dh      TEXT        NOT NULL,
  auth        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The worker looks up a recipient's devices by (clinic, email) on every alert.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_recipient
  ON push_subscriptions(clinic_id, user_email);

SELECT add_updated_at_trigger('push_subscriptions');

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_subscriptions_isolation ON push_subscriptions;
CREATE POLICY push_subscriptions_isolation ON push_subscriptions FOR ALL USING (clinic_id = app_clinic_id());
