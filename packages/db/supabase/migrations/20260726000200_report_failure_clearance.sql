ALTER TABLE generated_reports
  ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_generated_reports_visible
  ON generated_reports(clinic_id, created_at DESC)
  WHERE cleared_at IS NULL;
