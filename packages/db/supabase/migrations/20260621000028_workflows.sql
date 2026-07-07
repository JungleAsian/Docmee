-- Rev 3: N8N-style automation workflows. A clinic builds a graph of typed nodes
-- (trigger → logic → action) on a visual canvas; the workflow-runner worker walks
-- the graph when the trigger fires. Distinct from custom_flows (scripted dialog).
CREATE TABLE IF NOT EXISTS workflows (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'draft',
  -- The React Flow graph. nodes: { id, kind, type, config, x, y }; edges: { id, source, target, sourceHandle? }.
  nodes       JSONB       NOT NULL DEFAULT '[]',
  edges       JSONB       NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workflows_status_check CHECK (status IN ('draft', 'active'))
);

CREATE INDEX IF NOT EXISTS idx_workflows_clinic ON workflows(clinic_id);
SELECT add_updated_at_trigger('workflows');

ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflows_isolation ON workflows;
CREATE POLICY workflows_isolation ON workflows FOR ALL USING (clinic_id = app_clinic_id());
