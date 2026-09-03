-- Explicit workflow lifecycle plus collaboration/versioning metadata.
ALTER TABLE workflows DROP CONSTRAINT IF EXISTS workflows_status_check;
UPDATE workflows SET status = 'published' WHERE status = 'active';
ALTER TABLE workflows
  ADD CONSTRAINT workflows_status_check
  CHECK (status IN ('draft', 'validated', 'ready', 'published', 'superseded', 'archived'));

ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS revision_number INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS document_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS lifecycle_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE workflow_revisions
  ADD COLUMN IF NOT EXISTS revision_number INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('published', 'superseded')),
  ADD COLUMN IF NOT EXISTS author_id UUID REFERENCES clinic_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reason TEXT;

-- Existing revision rows predate revision_number and therefore all receive the
-- column default. Reconstruct a stable sequence before enforcing uniqueness.
WITH ordered_revisions AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY workflow_id
      ORDER BY created_at ASC, id ASC
    ) AS sequence_number
  FROM workflow_revisions
)
UPDATE workflow_revisions revision
SET revision_number = ordered_revisions.sequence_number
FROM ordered_revisions
WHERE revision.id = ordered_revisions.id;

-- The revision currently pinned by the workflow is the published one; earlier
-- historical snapshots remain available but are explicitly superseded.
UPDATE workflow_revisions revision
SET status = CASE
  WHEN revision.id = workflow.active_revision_id THEN 'published'
  ELSE 'superseded'
END
FROM workflows workflow
WHERE revision.workflow_id = workflow.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_revisions_sequence
  ON workflow_revisions (workflow_id, revision_number);

-- Keep the denormalized workflow pointer aligned with its active revision.
UPDATE workflows workflow
SET revision_number = revision.revision_number
FROM workflow_revisions revision
WHERE revision.id = workflow.active_revision_id;

CREATE INDEX IF NOT EXISTS idx_workflows_published_trigger
  ON workflows (clinic_id, status) WHERE status = 'published';
