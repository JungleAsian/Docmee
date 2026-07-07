-- P18 (Gap #37): Review-request tracking.
--
-- The review-request worker fires 48h after a completed appointment and records a
-- follow_ups row so we never double-send and can measure click-through. A row is
-- created per (appointment, type); `review_clicked_at` is stamped when the patient
-- opens the tracked review link.

CREATE TABLE IF NOT EXISTS follow_ups (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id        UUID        NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id    UUID        REFERENCES appointments(id) ON DELETE SET NULL,
  type              TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'pending',
  review_sent_at    TIMESTAMPTZ,
  review_clicked_at TIMESTAMPTZ,
  metadata          JSONB       NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT follow_ups_status_check CHECK (status IN ('pending', 'sent', 'clicked', 'skipped'))
);

-- One follow-up of a given type per appointment (idempotent scheduling).
CREATE UNIQUE INDEX IF NOT EXISTS idx_follow_ups_appt_type
  ON follow_ups(appointment_id, type)
  WHERE appointment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_follow_ups_clinic ON follow_ups(clinic_id);
SELECT add_updated_at_trigger('follow_ups');

ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS follow_ups_isolation ON follow_ups;
CREATE POLICY follow_ups_isolation ON follow_ups FOR ALL USING (clinic_id = app_clinic_id());
