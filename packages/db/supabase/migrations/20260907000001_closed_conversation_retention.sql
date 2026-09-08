-- Closed conversation retention: the worker deletes only terminal rows after
-- the clinic-specific retention window. This partial index keeps that sweep
-- cheap without adding overhead to active conversation lookups.
CREATE INDEX IF NOT EXISTS idx_conversations_closed_retention
  ON conversations (clinic_id, updated_at)
  WHERE status IN ('resolved', 'archived');
