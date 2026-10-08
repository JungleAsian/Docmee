-- CRE-52: move governance storage out of request-time DDL and make it a
-- clinic-scoped RLS surface. Existing installations may already have these
-- tables from the former route-level bootstrap, hence the idempotent DDL.

CREATE TABLE IF NOT EXISTS clinic_governance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  area text NOT NULL,
  key text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  owner text,
  review_state text NOT NULL DEFAULT 'needs_review',
  risk_tier text NOT NULL DEFAULT 'medium',
  visibility text NOT NULL DEFAULT 'clinic_staff',
  source text,
  allowed_editor text,
  last_reviewed_at timestamptz,
  last_trained_at timestamptz,
  last_tested_at timestamptz,
  secret_state text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, area, key)
);

CREATE TABLE IF NOT EXISTS clinic_custom_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  source text[] NOT NULL DEFAULT '{}',
  allowed_editor text[] NOT NULL DEFAULT '{}',
  visibility text NOT NULL DEFAULT 'clinic_staff',
  lifecycle text NOT NULL DEFAULT '',
  workflow_use text[] NOT NULL DEFAULT '{}',
  sensitive boolean NOT NULL DEFAULT false,
  ai_collectable boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, key)
);

CREATE TABLE IF NOT EXISTS clinic_api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name text NOT NULL,
  purpose text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  token_hash text NOT NULL,
  token_prefix text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);

CREATE TABLE IF NOT EXISTS clinic_webhook_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  endpoint_url text NOT NULL,
  owner text NOT NULL,
  purpose text NOT NULL,
  events text[] NOT NULL DEFAULT '{}',
  secret_state text NOT NULL DEFAULT 'missing',
  active boolean NOT NULL DEFAULT true,
  last_tested_at timestamptz,
  last_success_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clinic_governance_records_clinic ON clinic_governance_records(clinic_id);
CREATE INDEX IF NOT EXISTS idx_clinic_custom_attributes_clinic ON clinic_custom_attributes(clinic_id);
CREATE INDEX IF NOT EXISTS idx_clinic_api_tokens_clinic ON clinic_api_tokens(clinic_id);
CREATE INDEX IF NOT EXISTS idx_clinic_webhook_registry_clinic ON clinic_webhook_registry(clinic_id);

ALTER TABLE clinic_governance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_custom_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_api_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_webhook_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clinic_governance_records_isolation ON clinic_governance_records;
DROP POLICY IF EXISTS clinic_custom_attributes_isolation ON clinic_custom_attributes;
DROP POLICY IF EXISTS clinic_api_tokens_isolation ON clinic_api_tokens;
DROP POLICY IF EXISTS clinic_webhook_registry_isolation ON clinic_webhook_registry;

CREATE POLICY clinic_governance_records_isolation ON clinic_governance_records FOR ALL USING (clinic_id = app_clinic_id());
CREATE POLICY clinic_custom_attributes_isolation ON clinic_custom_attributes FOR ALL USING (clinic_id = app_clinic_id());
CREATE POLICY clinic_api_tokens_isolation ON clinic_api_tokens FOR ALL USING (clinic_id = app_clinic_id());
CREATE POLICY clinic_webhook_registry_isolation ON clinic_webhook_registry FOR ALL USING (clinic_id = app_clinic_id());
