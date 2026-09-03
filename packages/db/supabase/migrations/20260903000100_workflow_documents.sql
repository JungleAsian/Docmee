-- Workflow document V2 keeps executable definition and visual layout separate.
-- `nodes` and `edges` remain as a compatibility projection until all clients
-- read `document`; the runner continues to execute immutable revisions.
ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS document JSONB;

COMMENT ON COLUMN workflows.document IS
  'Workflow document v2: definition (execution only) plus presentation (layout only).';
