-- P18 (Gap #34): Custom conversation flows.
--
-- Clinic admins define keyword-triggered scripted flows: when an inbound message
-- matches a trigger keyword, the bot runs the flow's canned message sequence
-- (and optional terminal action) and SKIPS intent classification / the LLM.
-- Managed in Admin Studio.

CREATE TABLE IF NOT EXISTS custom_flows (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,
  trigger_keywords JSONB       NOT NULL DEFAULT '[]',
  messages         JSONB       NOT NULL DEFAULT '[]',
  action           TEXT,
  language         TEXT        NOT NULL DEFAULT 'both',
  enabled          BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT custom_flows_action_check   CHECK (action IS NULL OR action IN ('book', 'handoff', 'end')),
  CONSTRAINT custom_flows_language_check CHECK (language IN ('es', 'en', 'both'))
);

CREATE INDEX IF NOT EXISTS idx_custom_flows_clinic ON custom_flows(clinic_id);
SELECT add_updated_at_trigger('custom_flows');

ALTER TABLE custom_flows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS custom_flows_isolation ON custom_flows;
CREATE POLICY custom_flows_isolation ON custom_flows FOR ALL USING (clinic_id = app_clinic_id());
