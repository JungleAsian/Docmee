-- Governed KB freshness: versioned chunks, visible indexing state, effective
-- windows, and a cheap clinic-scoped revision for cache invalidation.
ALTER TABLE knowledge_documents
  ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS effective_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS indexing_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS indexing_error TEXT;

DO $$ BEGIN
  ALTER TABLE knowledge_documents ADD CONSTRAINT knowledge_documents_indexing_status_check
    CHECK (indexing_status IN ('pending', 'ready', 'failed', 'withdrawn'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS document_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Pre-migration chunks have no trustworthy version provenance. A document may
-- already be on v2 while its stored chunks still contain v1 text, so never
-- relabel those chunks as current evidence. An authoritative write/reindex from
-- knowledge_documents.content must create fresh, versioned chunks.
UPDATE knowledge_chunks
SET is_active = false;

CREATE INDEX IF NOT EXISTS knowledge_chunks_current_retrieval_idx
  ON knowledge_chunks (clinic_id, document_id, document_version, is_active);

CREATE TABLE IF NOT EXISTS knowledge_retrieval_revisions (
  clinic_id UUID PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Preserve existing approval state, but do not manufacture approval for legacy
-- active rows. With all legacy chunks withdrawn, active documents remain pending
-- until an authoritative write creates current chunks.
UPDATE knowledge_documents
SET indexing_status = CASE
      WHEN EXISTS (
        SELECT 1 FROM knowledge_chunks c
        WHERE c.document_id = knowledge_documents.id
          AND c.clinic_id = knowledge_documents.clinic_id
          AND c.document_version = knowledge_documents.version
          AND c.is_active = true
      ) AND NOT EXISTS (
        SELECT 1 FROM knowledge_chunks c
        WHERE c.document_id = knowledge_documents.id
          AND c.clinic_id = knowledge_documents.clinic_id
          AND c.document_version = knowledge_documents.version
          AND c.is_active = true
          AND c.embedding IS NULL
          AND NOT COALESCE((c.metadata -> 'embedding') ? 'v', false)
      ) THEN 'ready'
      ELSE 'pending'
    END
WHERE status = 'active';

INSERT INTO knowledge_retrieval_revisions (clinic_id, revision)
SELECT id, 1 FROM clinics
ON CONFLICT (clinic_id) DO NOTHING;
