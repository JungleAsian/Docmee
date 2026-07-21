-- Durable human gates and AI drafts for workflow executions (CRE-525).
CREATE TABLE IF NOT EXISTS workflow_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE, node_id TEXT NOT NULL, run_key TEXT NOT NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL, patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  resume_node_id TEXT, context JSONB NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending', expires_at TIMESTAMPTZ NOT NULL,
  -- Authentication uses externally-issued account UUIDs; there is no local `users`
  -- table. Keep this attribution durable without a stale foreign-key dependency.
  decided_by UUID, decided_at TIMESTAMPTZ, failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workflow_approvals_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'resuming', 'resumed', 'failed', 'cancelled')),
  CONSTRAINT workflow_approvals_run_key_unique UNIQUE (clinic_id, workflow_id, node_id, run_key)
);
CREATE INDEX IF NOT EXISTS idx_workflow_approvals_pending ON workflow_approvals (clinic_id, status, expires_at);
SELECT add_updated_at_trigger('workflow_approvals');
CREATE TABLE IF NOT EXISTS workflow_ai_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE, node_id TEXT NOT NULL, run_key TEXT NOT NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL, patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  prompt TEXT NOT NULL, content TEXT NOT NULL, sources JSONB NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending_review', error_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workflow_ai_drafts_status_check CHECK (status IN ('pending_review', 'accepted', 'rejected', 'failed', 'cancelled')),
  CONSTRAINT workflow_ai_drafts_run_key_unique UNIQUE (clinic_id, workflow_id, node_id, run_key)
);
CREATE INDEX IF NOT EXISTS idx_workflow_ai_drafts_pending ON workflow_ai_drafts (clinic_id, status, created_at DESC);
SELECT add_updated_at_trigger('workflow_ai_drafts');
ALTER TABLE workflow_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_approvals_isolation ON workflow_approvals;
CREATE POLICY workflow_approvals_isolation ON workflow_approvals FOR ALL USING (clinic_id = app_clinic_id());
ALTER TABLE workflow_ai_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_ai_drafts_isolation ON workflow_ai_drafts;
CREATE POLICY workflow_ai_drafts_isolation ON workflow_ai_drafts FOR ALL USING (clinic_id = app_clinic_id());
