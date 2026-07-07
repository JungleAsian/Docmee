-- P15: Instagram Direct channel — per-clinic Instagram Business connection.
-- Instagram DM rides the Messenger Send API (same Page access token, IGSID
-- recipient); config lives on the clinic row (one Instagram account per clinic).
-- Inbound webhooks resolve the owning clinic by instagram_account_id.

ALTER TABLE clinics ADD COLUMN IF NOT EXISTS instagram_account_id TEXT;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS instagram_page_access_token_encrypted TEXT;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS instagram_webhook_verify_token TEXT;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS instagram_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Lookup path for inbound webhook → clinic resolution.
CREATE INDEX IF NOT EXISTS idx_clinics_instagram_account_id
  ON clinics(instagram_account_id)
  WHERE instagram_account_id IS NOT NULL;
