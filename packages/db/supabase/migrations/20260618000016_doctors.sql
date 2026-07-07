-- P18 (Gap #32): Multi-doctor support.
--
-- A clinic can register several doctors, each with their OWN Google Calendar
-- (encrypted OAuth tokens on the row) and weekly availability. The booking flow
-- lists the clinic's doctors, asks the patient which one they want, checks that
-- doctor's specific calendar, and books under it.
--
-- This sits alongside the legacy `providers` table: appointments can reference
-- either a doctor (new) or a provider (legacy), so existing data keeps working.

CREATE TABLE IF NOT EXISTS doctors (
  id                                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id                               UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name                                    TEXT        NOT NULL,
  specialty                               TEXT,
  google_calendar_id                      TEXT,
  google_calendar_access_token_encrypted  TEXT,
  google_calendar_refresh_token_encrypted TEXT,
  available_days                          JSONB       NOT NULL DEFAULT '{}',
  is_active                               BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at                              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doctors_clinic ON doctors(clinic_id);
SELECT add_updated_at_trigger('doctors');

ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS doctors_isolation ON doctors;
CREATE POLICY doctors_isolation ON doctors FOR ALL USING (clinic_id = app_clinic_id());

-- Appointments may now be booked under a doctor. provider_id becomes optional so a
-- booking can reference a doctor instead; a CHECK keeps at least one of the two set.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS doctor_id UUID REFERENCES doctors(id) ON DELETE SET NULL;
ALTER TABLE appointments ALTER COLUMN provider_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appointments_resource_check'
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_resource_check
      CHECK (provider_id IS NOT NULL OR doctor_id IS NOT NULL);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_appointments_doctor ON appointments(doctor_id);
