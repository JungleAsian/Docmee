-- Durable patient identity captured by booking and workflow intake.
-- Channel-specific handles remain in patient_contacts; these columns hold the
-- patient's canonical contact details for bookings and calendar summaries.
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS phone_e164 TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT;

CREATE INDEX IF NOT EXISTS idx_patients_clinic_email
  ON patients (clinic_id, lower(email))
  WHERE email IS NOT NULL;
