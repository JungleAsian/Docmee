-- Docmee expansion contracts. Additive and safe to run against existing tenants.

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS automation_mode TEXT NOT NULL DEFAULT 'automated';
DO $$ BEGIN
  ALTER TABLE patients ADD CONSTRAINT patients_automation_mode_check
    CHECK (automation_mode IN ('automated', 'human_only'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE conversation_messages
  ADD COLUMN IF NOT EXISTS classification JSONB;
CREATE INDEX IF NOT EXISTS idx_messages_classification_intent
  ON conversation_messages ((classification->>'intent'))
  WHERE classification IS NOT NULL;

ALTER TABLE conversation_tags
  ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE doctors
  ADD COLUMN IF NOT EXISTS manual_overbooking_capacity SMALLINT NOT NULL DEFAULT 2;
DO $$ BEGIN
  ALTER TABLE doctors ADD CONSTRAINT doctors_overbooking_capacity_check
    CHECK (manual_overbooking_capacity >= 1 AND manual_overbooking_capacity <= 20);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS booking_origin TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS actor_id UUID,
  ADD COLUMN IF NOT EXISTS overbooked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS overbooking_reason TEXT,
  ADD COLUMN IF NOT EXISTS provider_correlation_key TEXT;
DO $$ BEGIN
  ALTER TABLE appointments ADD CONSTRAINT appointments_booking_origin_check
    CHECK (booking_origin IN ('docmee', 'workflow', 'manual', 'system'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_provider_correlation
  ON appointments(provider_correlation_key) WHERE provider_correlation_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  uploaded_by UUID,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  checksum TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT media_assets_type_check CHECK (content_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
  CONSTRAINT media_assets_size_check CHECK (byte_size > 0 AND byte_size <= 104857600)
);
CREATE INDEX IF NOT EXISTS idx_media_assets_clinic_active
  ON media_assets(clinic_id, created_at DESC) WHERE deleted_at IS NULL;
SELECT add_updated_at_trigger('media_assets');

CREATE TABLE IF NOT EXISTS message_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
  media_asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  provider_message_id TEXT,
  provider_status TEXT NOT NULL DEFAULT 'pending',
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, media_asset_id),
  CONSTRAINT message_attachments_status_check CHECK (provider_status IN ('pending','accepted','sent','delivered','read','failed'))
);
CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments(message_id);
SELECT add_updated_at_trigger('message_attachments');

ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS media_assets_isolation ON media_assets;
CREATE POLICY media_assets_isolation ON media_assets FOR ALL USING (clinic_id = app_clinic_id());
ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS message_attachments_isolation ON message_attachments;
CREATE POLICY message_attachments_isolation ON message_attachments FOR ALL USING (clinic_id = app_clinic_id());

-- Staged flags are off by default; rollout is enabled only after slice verification.
INSERT INTO feature_flags (name, enabled, rollout_percentage, description)
VALUES
  ('docmee_inbox_layout_v2', FALSE, 0, 'Docmee inbox layout and visibility controls'),
  ('docmee_human_only_mode', FALSE, 0, 'Patient-level automation suppression'),
  ('docmee_classifications', FALSE, 0, 'Structured message classifications and tabs'),
  ('docmee_calendar_policy_v2', FALSE, 0, 'Unified calendar and controlled overbooking'),
  ('docmee_media_repository', FALSE, 0, 'Clinic-scoped media repository and attachments'),
  ('docmee_notification_chimes', FALSE, 0, 'Configured notification chimes'),
  ('docmee_workflow_edges_v2', FALSE, 0, 'Validated workflow editor connections')
ON CONFLICT (name, clinic_id) DO NOTHING;
