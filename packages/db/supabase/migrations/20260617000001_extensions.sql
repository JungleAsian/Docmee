-- P02: Extensions
-- Requires: postgres 14+

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- pgvector: optional — needed for knowledge_chunks embedding column.
-- To enable: docker exec -it <postgres-container> psql -U postgres -c "CREATE EXTENSION vector;"
-- Then uncomment the embedding column in 20260617000007_knowledge.sql.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS "vector";
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector not installed — knowledge_chunks.embedding column will be skipped. See P02 docs.';
END;
$$;

-- Migration tracking table
CREATE TABLE IF NOT EXISTS _migrations (
  id     SERIAL      PRIMARY KEY,
  name   TEXT        UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
