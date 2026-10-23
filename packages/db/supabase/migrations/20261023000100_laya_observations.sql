-- LAYA watch-only observations: what a patient typed, what LAYA would have picked
-- (never applied unless qualified), and what the patient tapped next (the label).
-- Text is redacted before insert (emails, links, phone-like and long numbers) and
-- every row expires after 90 days; the sensitive-data worker deletes expired rows.
-- Capture is opt-in per clinic via the feature flag 'docmee_laya_observations'.
CREATE TABLE IF NOT EXISTS laya_observations (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id            UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  conversation_id      UUID        REFERENCES conversations(id) ON DELETE CASCADE,
  workflow_id          UUID        NOT NULL,
  workflow_revision_id UUID,
  node_id              TEXT        NOT NULL CHECK (char_length(node_id) BETWEEN 1 AND 128),
  task                 TEXT        NOT NULL CHECK (task IN ('workflow_branch', 'administrative_intent')),
  source               TEXT        NOT NULL CHECK (source IN ('menu_trigger', 'menu_unmatched', 'ai_agent')),
  language             TEXT        NOT NULL CHECK (language IN ('en', 'es', 'mixed', 'unknown')),
  redacted_text        TEXT        NOT NULL CHECK (char_length(redacted_text) BETWEEN 1 AND 1600),
  candidate_ids        TEXT[]      NOT NULL DEFAULT '{}',
  laya_mode            TEXT,
  laya_reason          TEXT,
  laya_choice_id       TEXT,
  laya_raw_score       REAL,
  laya_latency_ms      INTEGER,
  label_choice_id      TEXT,
  label_source         TEXT        CHECK (label_source IS NULL OR label_source IN ('next_tap', 'ai_scenario')),
  label_distance       INTEGER,
  labeled_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at           TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '90 days'
);

CREATE INDEX IF NOT EXISTS idx_laya_observations_open
  ON laya_observations (clinic_id, conversation_id, workflow_id, node_id, created_at DESC)
  WHERE label_choice_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_laya_observations_clinic_created
  ON laya_observations (clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_laya_observations_expires
  ON laya_observations (expires_at);

ALTER TABLE laya_observations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS laya_observations_isolation ON laya_observations;
CREATE POLICY laya_observations_isolation ON laya_observations
  FOR ALL USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());

COMMENT ON TABLE laya_observations IS
  'Redacted patient text used to measure LAYA; sensitive, clinic-scoped, purged 90 days after creation.';
