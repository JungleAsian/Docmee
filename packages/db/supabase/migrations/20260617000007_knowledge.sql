-- P02: Knowledge base and IA configuration

CREATE TABLE IF NOT EXISTS ia_profiles (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  system_prompt TEXT        NOT NULL DEFAULT '',
  model         TEXT        NOT NULL DEFAULT 'claude-sonnet-4-6',
  temperature   DECIMAL(3, 2) NOT NULL DEFAULT 0.70,
  max_tokens    INTEGER     NOT NULL DEFAULT 1024,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  settings      JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ia_profiles_temp_check   CHECK (temperature BETWEEN 0 AND 1),
  CONSTRAINT ia_profiles_tokens_check CHECK (max_tokens BETWEEN 1 AND 8192)
);

CREATE INDEX IF NOT EXISTS idx_ia_profiles_clinic ON ia_profiles(clinic_id);
SELECT add_updated_at_trigger('ia_profiles');

-- Add FK from conversations to ia_profiles now that ia_profiles exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_ia_profile_id_fkey'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_ia_profile_id_fkey
      FOREIGN KEY (ia_profile_id) REFERENCES ia_profiles(id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS ia_rules (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ia_profile_id UUID        NOT NULL REFERENCES ia_profiles(id) ON DELETE CASCADE,
  clinic_id     UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  rule_type     TEXT        NOT NULL,
  condition     JSONB       NOT NULL DEFAULT '{}',
  action        JSONB       NOT NULL DEFAULT '{}',
  priority      INTEGER     NOT NULL DEFAULT 0,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ia_rules_type_check CHECK (rule_type IN (
    'escalation', 'topic_block', 'greeting', 'fallback', 'hours', 'keyword'
  ))
);

CREATE INDEX IF NOT EXISTS idx_ia_rules_profile ON ia_rules(ia_profile_id);
CREATE INDEX IF NOT EXISTS idx_ia_rules_clinic  ON ia_rules(clinic_id);
SELECT add_updated_at_trigger('ia_rules');

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  title         TEXT        NOT NULL,
  content       TEXT        NOT NULL,
  document_type TEXT        NOT NULL DEFAULT 'faq',
  status        TEXT        NOT NULL DEFAULT 'active',
  metadata      JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT knowledge_docs_type_check   CHECK (document_type IN ('faq', 'policy', 'service_info', 'custom')),
  CONSTRAINT knowledge_docs_status_check CHECK (status        IN ('active', 'draft', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_knowledge_docs_clinic ON knowledge_documents(clinic_id);
SELECT add_updated_at_trigger('knowledge_documents');

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  UUID        NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  clinic_id    UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  content      TEXT        NOT NULL,
  chunk_index  INTEGER     NOT NULL,
  -- embedding  vector(1536), -- uncomment after: CREATE EXTENSION vector;
  metadata     JSONB       NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_document ON knowledge_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_clinic   ON knowledge_chunks(clinic_id);

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  ia_profile_id    UUID        REFERENCES ia_profiles(id) ON DELETE SET NULL,
  conversation_id  UUID        REFERENCES conversations(id) ON DELETE SET NULL,
  model            TEXT        NOT NULL,
  prompt_tokens    INTEGER     NOT NULL DEFAULT 0,
  completion_tokens INTEGER    NOT NULL DEFAULT 0,
  total_tokens     INTEGER     NOT NULL DEFAULT 0,
  cost_usd         DECIMAL(10, 6),
  metadata         JSONB       NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_clinic         ON ai_usage_events(clinic_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created_at     ON ai_usage_events(created_at DESC);
