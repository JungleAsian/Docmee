-- Durable execution states. A waiting/retrying run owns a persisted cursor, not
-- a worker thread. This migration is additive and preserves legacy trace data.
ALTER TABLE workflow_runs
  DROP CONSTRAINT IF EXISTS workflow_runs_status_check;

UPDATE workflow_runs SET status = 'waiting' WHERE status = 'paused';

ALTER TABLE workflow_runs
  ADD COLUMN IF NOT EXISTS current_node_id TEXT,
  ADD COLUMN IF NOT EXISTS resume_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resume_reason TEXT,
  ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_code TEXT,
  ADD COLUMN IF NOT EXISTS state_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE workflow_runs
  ADD CONSTRAINT workflow_runs_status_check CHECK (
    status IN ('running', 'waiting', 'retry_scheduled', 'cancelled', 'compensating', 'completed', 'failed')
  );

CREATE INDEX IF NOT EXISTS workflow_runs_resume_idx
  ON workflow_runs (status, resume_at)
  WHERE status IN ('waiting', 'retry_scheduled');
