-- Last known result of the clinic setup check (configuration + live workflow
-- problems). The API re-runs the check after every configuration change and
-- compares against this snapshot so each new problem notifies admins once.
CREATE TABLE IF NOT EXISTS clinic_setup_checks (
  clinic_id  UUID        PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
  issue_keys TEXT[]      NOT NULL DEFAULT '{}',
  issues     JSONB       NOT NULL DEFAULT '[]',
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE clinic_setup_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clinic_setup_checks_isolation ON clinic_setup_checks;
CREATE POLICY clinic_setup_checks_isolation ON clinic_setup_checks
  FOR ALL USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());
