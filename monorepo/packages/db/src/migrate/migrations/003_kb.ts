import type { Migration } from "../runner.js";

/**
 * 003 — Knowledge base (Phase 1A). Unified KB: manual entries, document chunks,
 * and always-injected "rule" entries. Embeddings via pgvector (1536 dims,
 * OpenAI text-embedding-3-small). Retrieval is cosine distance (`<=>`).
 *
 * No ANN index here (kept PGlite-compatible); production adds an HNSW index:
 *   CREATE INDEX ON kb_entries USING hnsw (embedding vector_cosine_ops);
 */
const sql = /* sql */ `
  CREATE EXTENSION IF NOT EXISTS vector;

  CREATE TABLE kb_entries (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id   uuid NOT NULL REFERENCES clinics(id),
    type        text NOT NULL CHECK (type IN ('manual','document_chunk','rule')),
    title       text,
    content     text NOT NULL,
    embedding   vector(1536),
    source      text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
  );

  CREATE INDEX kb_entries_clinic_type ON kb_entries (clinic_id, type);

  ALTER TABLE kb_entries ENABLE ROW LEVEL SECURITY;
  ALTER TABLE kb_entries FORCE ROW LEVEL SECURITY;
  CREATE POLICY clinic_scope ON kb_entries
    USING (clinic_id = current_clinic_id())
    WITH CHECK (clinic_id = current_clinic_id());

  GRANT SELECT, INSERT, UPDATE ON kb_entries TO docmee_app;
`;

const migration: Migration = { version: 3, name: "kb", sql };
export default migration;
