-- Req 37 (Gap #37): Automatic reports — panel + email delivery.
--
-- The reports worker fans out hourly and, at each clinic's local 08:00 (daily) and
-- Monday 09:00 (weekly), generates a metrics report for the clinic admin. Until now
-- a report was emailed and then discarded — there was no way to read it in the panel.
-- This table PERSISTS every generated report so the clinic panel can list and open
-- past reports (the "panel" half of "deliver them through panel/email"); the email
-- send is recorded via `emailed` so a delivery failure is visible rather than silent.

CREATE TABLE IF NOT EXISTS generated_reports (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  type            TEXT        NOT NULL,
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  subject         TEXT        NOT NULL,
  html            TEXT        NOT NULL,
  data            JSONB       NOT NULL DEFAULT '{}',
  recipient_email TEXT,
  emailed         BOOLEAN     NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT generated_reports_type_check CHECK (type IN ('daily', 'weekly'))
);

-- The panel lists a clinic's reports newest-first.
CREATE INDEX IF NOT EXISTS idx_generated_reports_clinic_created
  ON generated_reports(clinic_id, created_at DESC);

ALTER TABLE generated_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS generated_reports_isolation ON generated_reports;
CREATE POLICY generated_reports_isolation ON generated_reports FOR ALL USING (clinic_id = app_clinic_id());
