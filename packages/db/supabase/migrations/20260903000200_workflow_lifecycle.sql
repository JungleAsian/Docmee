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

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_revisions_sequence
  ON workflow_revisions (workflow_id, revision_number);

-- Revisions already pinned by the previous migration become revision 1.
UPDATE workflows
SET revision_number = 1
WHERE active_revision_id IS NOT NULL AND revision_number = 0;

CREATE INDEX IF NOT EXISTS idx_workflows_published_trigger
  ON workflows (clinic_id, status) WHERE status = 'published';
