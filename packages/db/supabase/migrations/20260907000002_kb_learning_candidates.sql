-- Governed retrieval feedback: candidates never become KB truth without gates.
ALTER TABLE knowledge_retrieval_events
  ADD COLUMN IF NOT EXISTS confidence_score numeric(5,4),
  ADD COLUMN IF NOT EXISTS patient_feedback text CHECK (patient_feedback IN ('accepted','corrected','escalated','unknown')),
  ADD COLUMN IF NOT EXISTS human_edit text,
  ADD COLUMN IF NOT EXISTS human_approved boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS knowledge_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  retrieval_event_id uuid REFERENCES knowledge_retrieval_events(id) ON DELETE SET NULL,
  source_question text NOT NULL,
  candidate_content text NOT NULL,
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','approved','rejected','superseded')),
  confidence_score numeric(5,4) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  grounding_score numeric(5,4) NOT NULL CHECK (grounding_score >= 0 AND grounding_score <= 1),
  medical_safety_ok boolean NOT NULL DEFAULT false,
  prompt_safety_ok boolean NOT NULL DEFAULT false,
  contradiction_free boolean NOT NULL DEFAULT false,
  consistency_count integer NOT NULL DEFAULT 1 CHECK (consistency_count >= 1),
  patient_feedback text NOT NULL DEFAULT 'unknown' CHECK (patient_feedback IN ('accepted','corrected','escalated','unknown')),
  human_edit text,
  approved_by uuid,
  approved_at timestamptz,
  source_document_id uuid,
  source_document_version integer,
  previous_version_id uuid REFERENCES knowledge_candidates(id) ON DELETE SET NULL,
  supporting_chunks jsonb NOT NULL DEFAULT '[]'::jsonb,
  original_source jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_candidates_review_idx ON knowledge_candidates (clinic_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS knowledge_candidates_dedupe_idx ON knowledge_candidates (clinic_id, source_question, candidate_content);
ALTER TABLE knowledge_retrieval_events ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES knowledge_candidates(id) ON DELETE SET NULL;
