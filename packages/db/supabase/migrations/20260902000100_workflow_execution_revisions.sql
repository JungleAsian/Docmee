-- Pin each execution to the graph that was active at enqueue time. Editing an
-- active workflow creates a new revision; delayed, conversational, and approval
-- resumes continue to use their original revision.
CREATE TABLE IF NOT EXISTS workflow_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  definition JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_revisions_workflow_created
  ON workflow_revisions (workflow_id, created_at DESC);

ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS active_revision_id UUID REFERENCES workflow_revisions(id) ON DELETE SET NULL;

-- Existing active workflows did not have an immutable definition. Snapshot the
-- graph that is active at migration time so all subsequently enqueued work pins
-- to a revision. Historical in-flight jobs retain their legacy fallback only.
INSERT INTO workflow_revisions (clinic_id, workflow_id, definition)
SELECT w.clinic_id, w.id, jsonb_build_object('nodes', w.nodes, 'edges', w.edges)
FROM workflows w
WHERE w.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM workflow_revisions r WHERE r.workflow_id = w.id
  );

WITH latest_revision AS (
  SELECT DISTINCT ON (workflow_id) workflow_id, id
  FROM workflow_revisions
  ORDER BY workflow_id, created_at DESC, id DESC
)
UPDATE workflows w
SET active_revision_id = r.id
FROM latest_revision r
WHERE w.id = r.workflow_id
  AND w.status = 'active'
  AND w.active_revision_id IS NULL;

ALTER TABLE workflow_runs
  ADD COLUMN IF NOT EXISTS workflow_revision_id UUID REFERENCES workflow_revisions(id) ON DELETE SET NULL;
ALTER TABLE workflow_approvals
  ADD COLUMN IF NOT EXISTS workflow_revision_id UUID REFERENCES workflow_revisions(id) ON DELETE SET NULL;

-- Preserve a best-effort association for historical traces. They cannot become
-- immutable retroactively; only jobs created after this migration are strictly
-- revision-pinned.
UPDATE workflow_runs run
SET workflow_revision_id = w.active_revision_id
FROM workflows w
WHERE run.workflow_id = w.id AND run.workflow_revision_id IS NULL;

UPDATE workflow_approvals approval
SET workflow_revision_id = w.active_revision_id
FROM workflows w
WHERE approval.workflow_id = w.id AND approval.workflow_revision_id IS NULL;

ALTER TABLE workflow_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_revisions_isolation ON workflow_revisions;
CREATE POLICY workflow_revisions_isolation ON workflow_revisions
  FOR ALL USING (clinic_id = app_clinic_id());
