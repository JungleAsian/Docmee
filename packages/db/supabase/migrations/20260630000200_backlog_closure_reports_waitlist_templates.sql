ALTER TABLE generated_reports
  DROP CONSTRAINT IF EXISTS generated_reports_type_check;

ALTER TABLE generated_reports
  ADD CONSTRAINT generated_reports_type_check CHECK (type IN ('daily', 'weekly', 'monthly'));

ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS meta_template_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_status TEXT,
  ADD COLUMN IF NOT EXISTS meta_last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS meta_last_error TEXT;

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  doctor_id UUID REFERENCES doctors(id) ON DELETE SET NULL,
  service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  desired_from TIMESTAMPTZ,
  desired_to TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT waitlist_entries_status_check CHECK (status IN ('active', 'notified', 'booked', 'expired', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_waitlist_entries_clinic_status
  ON waitlist_entries(clinic_id, status, created_at DESC);

ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS waitlist_entries_isolation ON waitlist_entries;
CREATE POLICY waitlist_entries_isolation ON waitlist_entries FOR ALL USING (clinic_id = app_clinic_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON waitlist_entries TO authenticated;
  END IF;
END $$;
