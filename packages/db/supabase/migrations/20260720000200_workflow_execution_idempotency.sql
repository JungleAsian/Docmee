-- QA-10: durable run and action keys for at-least-once workflow queue delivery.
CREATE TABLE IF NOT EXISTS workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL,
  queue_job_id TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'paused', 'completed', 'failed')),
  trace JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, workflow_id, source_event_id)
);

CREATE TABLE IF NOT EXISTS workflow_effects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  execution_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'succeeded', 'failed', 'uncertain')),
  provider_id TEXT,
  webhook_status TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS workflow_runs_trace_source_idx ON workflow_runs (clinic_id, source_event_id);
CREATE INDEX IF NOT EXISTS workflow_effects_run_idx ON workflow_effects (workflow_run_id);
SELECT add_updated_at_trigger('workflow_runs');
SELECT add_updated_at_trigger('workflow_effects');

ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_effects ENABLE ROW LEVEL SECURITY;
