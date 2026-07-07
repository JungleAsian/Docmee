-- CRE-64: Categories for canned quick replies used by Admin Studio and the inbox picker.
ALTER TABLE quick_reply_templates
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';

CREATE INDEX IF NOT EXISTS idx_quick_reply_templates_clinic_category
  ON quick_reply_templates(clinic_id, category, created_at DESC);
