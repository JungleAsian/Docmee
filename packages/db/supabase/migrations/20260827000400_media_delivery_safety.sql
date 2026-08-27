-- Durable storage lifecycle and idempotent outbound media delivery.

ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS storage_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS storage_failure_code TEXT,
  ADD COLUMN IF NOT EXISTS storage_cleanup_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS storage_cleanup_retry_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE media_assets ADD CONSTRAINT media_assets_storage_status_check
    CHECK (storage_status IN ('uploading','active','delete_pending','delete_failed','deleted'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE message_attachments DROP CONSTRAINT IF EXISTS message_attachments_status_check;
ALTER TABLE message_attachments ADD CONSTRAINT message_attachments_status_check
  CHECK (provider_status IN ('pending','uncertain','accepted','sent','delivered','read','failed'));

CREATE TABLE IF NOT EXISTS outbound_media_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id UUID NOT NULL UNIQUE REFERENCES conversation_messages(id) ON DELETE CASCADE,
  attachment_id UUID NOT NULL UNIQUE REFERENCES message_attachments(id) ON DELETE CASCADE,
  media_asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sending',
  provider_media_id TEXT,
  provider_message_id TEXT,
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT outbound_media_attempts_idempotency_key_check CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  CONSTRAINT outbound_media_attempts_status_check CHECK (status IN ('sending','accepted','uncertain')),
  UNIQUE (clinic_id, conversation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_outbound_media_attempts_reconcile
  ON outbound_media_attempts(clinic_id, status, updated_at)
  WHERE status IN ('sending','uncertain');

ALTER TABLE outbound_media_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outbound_media_attempts_isolation ON outbound_media_attempts;
CREATE POLICY outbound_media_attempts_isolation ON outbound_media_attempts
  FOR ALL USING (clinic_id = app_clinic_id());
SELECT add_updated_at_trigger('outbound_media_attempts');
