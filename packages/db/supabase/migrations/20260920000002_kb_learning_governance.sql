-- Governed, clinic-scoped learning. No active knowledge is created by this migration.
CREATE TABLE knowledge_learning_settings (
  clinic_id uuid PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
  auto_approve boolean NOT NULL DEFAULT false,
  grounding_threshold numeric NOT NULL DEFAULT 1 CHECK (grounding_threshold >= .8 AND grounding_threshold <= 1),
  evidence_retention_hours integer NOT NULL DEFAULT 24 CHECK (evidence_retention_hours BETWEEN 1 AND 24),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE knowledge_candidates ADD COLUMN fingerprint text;
ALTER TABLE knowledge_candidates ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE knowledge_candidates ADD COLUMN evidence jsonb NOT NULL DEFAULT '{}';
ALTER TABLE knowledge_candidates ADD COLUMN expires_at timestamptz DEFAULT (now() + interval '24 hours');
ALTER TABLE knowledge_candidates ADD COLUMN published_document_id uuid REFERENCES knowledge_documents(id) ON DELETE SET NULL;
ALTER TABLE knowledge_candidates ADD COLUMN published_document_version integer;
ALTER TABLE knowledge_candidates ADD COLUMN staff_confirmed boolean NOT NULL DEFAULT false;
-- Already-published provenance is durable, unlike temporary patient evidence.
UPDATE knowledge_candidates SET expires_at = NULL WHERE status IN ('approved', 'superseded');
CREATE UNIQUE INDEX knowledge_candidates_clinic_fingerprint ON knowledge_candidates(clinic_id, fingerprint) WHERE fingerprint IS NOT NULL;
CREATE TABLE knowledge_learning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  candidate_id uuid REFERENCES knowledge_candidates(id) ON DELETE SET NULL,
  question text NOT NULL,
  answer text NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]',
  evidence jsonb NOT NULL DEFAULT '{}',
  feedback text NOT NULL DEFAULT 'unknown' CHECK (feedback IN ('unknown','accepted','corrected','escalated')),
  feedback_by uuid,
  feedback_at timestamptz,
  handoff_reason text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, event_key)
);
CREATE TABLE knowledge_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  question text NOT NULL,
  reason text NOT NULL,
  occurrences integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  UNIQUE (clinic_id, fingerprint)
);
CREATE TABLE knowledge_learning_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES knowledge_candidates(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  action text NOT NULL,
  actor_id uuid,
  content text NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]',
  evidence jsonb NOT NULL DEFAULT '{}',
  document_id uuid,
  document_version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, revision)
);
CREATE INDEX knowledge_learning_events_expiry ON knowledge_learning_events(expires_at);
CREATE INDEX knowledge_gaps_expiry ON knowledge_gaps(expires_at);
CREATE INDEX knowledge_candidates_expiry ON knowledge_candidates(expires_at) WHERE status IN ('pending_review','rejected');
ALTER TABLE knowledge_learning_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_learning_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_gaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_learning_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY knowledge_learning_settings_clinic ON knowledge_learning_settings USING (clinic_id = current_setting('app.clinic_id', true)::uuid) WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid);
CREATE POLICY knowledge_learning_events_clinic ON knowledge_learning_events USING (clinic_id = current_setting('app.clinic_id', true)::uuid) WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid);
CREATE POLICY knowledge_gaps_clinic ON knowledge_gaps USING (clinic_id = current_setting('app.clinic_id', true)::uuid) WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid);
CREATE POLICY knowledge_learning_history_clinic ON knowledge_learning_history USING (clinic_id = current_setting('app.clinic_id', true)::uuid) WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid);
