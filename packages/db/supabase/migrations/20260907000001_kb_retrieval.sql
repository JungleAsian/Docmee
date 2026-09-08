-- Persistent, tenant-scoped KB retrieval infrastructure.
-- Embeddings are standardized to 1536 dimensions (the local and OpenAI
-- defaults), while the JSONB copy remains for backwards compatibility.
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE knowledge_documents
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS embedding_model TEXT,
  ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
  ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS knowledge_chunks_search_vector_idx
  ON knowledge_chunks USING gin (search_vector);
CREATE INDEX IF NOT EXISTS knowledge_documents_retrieval_idx
  ON knowledge_documents (clinic_id, status, version DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_retrieval_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  conversation_id UUID,
  query TEXT NOT NULL,
  language TEXT,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  selected_chunks JSONB NOT NULL DEFAULT '[]'::jsonb,
  answer TEXT,
  handoff_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS knowledge_retrieval_events_clinic_created_idx
  ON knowledge_retrieval_events (clinic_id, created_at DESC);

