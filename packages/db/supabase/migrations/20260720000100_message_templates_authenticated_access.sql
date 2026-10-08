-- CRE-67: message template routes execute inside SET LOCAL ROLE authenticated.
-- The original table migration omitted both RLS and authenticated grants, so
-- production API writes failed before reaching the Meta Graph API.

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS message_templates_isolation ON message_templates;
CREATE POLICY message_templates_isolation ON message_templates
  FOR ALL
  USING (clinic_id = app_clinic_id())
  WITH CHECK (clinic_id = app_clinic_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON message_templates TO authenticated;
  END IF;
END $$;
