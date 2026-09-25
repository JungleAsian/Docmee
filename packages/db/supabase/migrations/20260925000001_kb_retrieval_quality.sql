-- Deterministic KB identity plus privacy-safe aggregate retrieval observability.
-- This migration does not activate or approve any knowledge.
ALTER TABLE knowledge_documents
  ADD COLUMN IF NOT EXISTS canonical_fact_key TEXT,
  ADD COLUMN IF NOT EXISTS authority TEXT NOT NULL DEFAULT 'clinic';

ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

UPDATE knowledge_documents
SET canonical_fact_key = COALESCE(
  NULLIF(metadata ->> 'canonicalFactKey', ''),
  lower(regexp_replace(trim(title), '[^[:alnum:]]+', '-', 'g'))
)
WHERE canonical_fact_key IS NULL;

UPDATE knowledge_chunks
SET content_hash = md5(content)
WHERE content_hash IS NULL;

CREATE INDEX IF NOT EXISTS knowledge_documents_canonical_fact_idx
  ON knowledge_documents (clinic_id, canonical_fact_key, version DESC)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS knowledge_chunks_content_hash_idx
  ON knowledge_chunks (clinic_id, content_hash)
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS knowledge_retrieval_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  query_hash TEXT NOT NULL,
  intent TEXT NOT NULL DEFAULT 'general',
  result_count INTEGER NOT NULL DEFAULT 0 CHECK (result_count >= 0),
  latency_ms INTEGER NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  cache_hit BOOLEAN NOT NULL DEFAULT false,
  outcome TEXT NOT NULL CHECK (outcome IN ('answered', 'handoff', 'no_evidence', 'error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_retrieval_metrics_clinic_created_idx
  ON knowledge_retrieval_metrics (clinic_id, created_at DESC);
ALTER TABLE knowledge_retrieval_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY knowledge_retrieval_metrics_isolation ON knowledge_retrieval_metrics
  FOR ALL USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());

COMMENT ON TABLE knowledge_retrieval_metrics IS
  'Aggregate KB retrieval telemetry. Patient questions and generated answers are intentionally not stored.';
