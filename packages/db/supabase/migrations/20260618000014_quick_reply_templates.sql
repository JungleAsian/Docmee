-- P16 (Gap #25): Quick reply templates — canned secretary replies, scoped to a
-- clinic. A secretary opens the picker in the message box and clicks a template to
-- insert its body into the composer; Admin Studio manages the catalog (add/edit/delete).

CREATE TABLE IF NOT EXISTS quick_reply_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quick_reply_templates_clinic
  ON quick_reply_templates(clinic_id, created_at DESC);
