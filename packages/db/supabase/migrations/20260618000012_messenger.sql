-- P14: Facebook Messenger channel — per-clinic Page connection.
-- Messenger config lives on the clinic row (one Page per clinic); inbound
-- webhooks resolve the owning clinic by messenger_page_id.

ALTER TABLE clinics ADD COLUMN IF NOT EXISTS messenger_page_id TEXT;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS messenger_page_access_token_encrypted TEXT;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS messenger_webhook_verify_token TEXT;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS messenger_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Lookup path for inbound webhook → clinic resolution.
CREATE INDEX IF NOT EXISTS idx_clinics_messenger_page_id
  ON clinics(messenger_page_id)
  WHERE messenger_page_id IS NOT NULL;
