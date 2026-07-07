-- P16 (Gap #29): WhatsApp message templates — the clinic-scoped catalog of Meta
-- templates (appointment_confirmation, appointment_reminder, human_handoff_notification).
-- Actual submission to Meta is manual; these rows only track approval status so the
-- panel can show what has been submitted / approved / rejected.

CREATE TABLE IF NOT EXISTS message_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'appointment_confirmation',
  language   TEXT NOT NULL DEFAULT 'es',
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT message_templates_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT message_templates_clinic_name_unique UNIQUE (clinic_id, name)
);

CREATE INDEX IF NOT EXISTS idx_message_templates_clinic
  ON message_templates(clinic_id, created_at DESC);
