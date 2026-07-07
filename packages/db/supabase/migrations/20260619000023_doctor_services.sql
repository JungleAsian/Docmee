-- Req 30 (Multi-doctor): per-doctor service assignment.
--
-- Services are clinic-wide (the `services` table, migration 20260617000006). This
-- junction records WHICH of those services each doctor offers, so the booking flow
-- can ask the patient which service they need and use that service's own
-- duration_minutes as the appointment slot length (instead of the flat 30-min
-- default). An empty assignment for a doctor = no specific service offered, which
-- keeps the existing behaviour (clinic default duration) — back-compat for clinics
-- that never configure services.
--
-- Sits alongside the doctors table (migration 20260618000016). A row is the
-- presence of an assignment; unassigning is a DELETE. UNIQUE(doctor_id, service_id)
-- keeps assignment idempotent.

CREATE TABLE IF NOT EXISTS doctor_services (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID        NOT NULL REFERENCES clinics(id)  ON DELETE CASCADE,
  doctor_id   UUID        NOT NULL REFERENCES doctors(id)  ON DELETE CASCADE,
  service_id  UUID        NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (doctor_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_doctor_services_clinic  ON doctor_services(clinic_id);
CREATE INDEX IF NOT EXISTS idx_doctor_services_doctor  ON doctor_services(doctor_id);
CREATE INDEX IF NOT EXISTS idx_doctor_services_service ON doctor_services(service_id);
SELECT add_updated_at_trigger('doctor_services');

ALTER TABLE doctor_services ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS doctor_services_isolation ON doctor_services;
CREATE POLICY doctor_services_isolation ON doctor_services FOR ALL USING (clinic_id = app_clinic_id());
