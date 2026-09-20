-- Draft edits must never inherit an approved fact's durable lifetime.
-- Repair the previous edit-in-place lifecycle without deleting approved history
-- or rewriting the currently published document. Run in the migration transaction.
DO $$
DECLARE
  candidate record;
  approved record;
  draft_id uuid;
  draft_started timestamptz;
  retention integer;
BEGIN
  FOR candidate IN
    SELECT c.* FROM knowledge_candidates c
    WHERE c.status IN ('pending_review', 'rejected')
      AND EXISTS (SELECT 1 FROM knowledge_learning_history h
        WHERE h.candidate_id = c.id AND h.clinic_id = c.clinic_id
          AND h.action IN ('approve', 'rollback'))
    FOR UPDATE
  LOOP
    SELECT h.* INTO approved FROM knowledge_learning_history h
    WHERE h.candidate_id = candidate.id AND h.clinic_id = candidate.clinic_id
      AND h.action IN ('approve', 'rollback') ORDER BY h.revision DESC LIMIT 1;
    SELECT COALESCE(min(h.created_at), candidate.updated_at) INTO draft_started
    FROM knowledge_learning_history h WHERE h.candidate_id = candidate.id
      AND h.revision > approved.revision AND h.action NOT IN ('approve', 'rollback');
    SELECT COALESCE((SELECT s.evidence_retention_hours FROM knowledge_learning_settings s
      WHERE s.clinic_id = candidate.clinic_id), 24) INTO retention;
    draft_id := gen_random_uuid();
    INSERT INTO knowledge_candidates
      (id, clinic_id, source_question, candidate_content, status, confidence_score, grounding_score,
       medical_safety_ok, prompt_safety_ok, contradiction_free, human_edit, supporting_chunks,
       original_source, fingerprint, revision, evidence, staff_confirmed, previous_version_id,
       published_document_id, published_document_version, created_at, updated_at,
       expires_at, source_question_expires_at)
    VALUES
      (draft_id, candidate.clinic_id, '', candidate.candidate_content, candidate.status, 0, 0,
       false, false, false, candidate.human_edit, candidate.supporting_chunks,
       jsonb_build_object('source', 'legacy_approved_revision', 'candidateId', candidate.id),
       'legacy-draft:' || draft_id::text, candidate.revision,
       candidate.evidence || '{"grounding":0,"contradiction":"unknown","risks":["staff_correction"]}'::jsonb,
       candidate.staff_confirmed, candidate.id, candidate.published_document_id,
       candidate.published_document_version, draft_started, candidate.updated_at,
       draft_started + retention * interval '1 hour', now());
    -- Move unapproved audit contents into the same expiring cascade as the draft.
    UPDATE knowledge_learning_history SET candidate_id = draft_id
    WHERE candidate_id = candidate.id AND clinic_id = candidate.clinic_id
      AND revision > approved.revision AND action NOT IN ('approve', 'rollback');
    UPDATE knowledge_candidates SET candidate_content = approved.content, status = 'approved',
      human_edit = CASE WHEN COALESCE((approved.evidence ->> 'staffConfirmed')::boolean, false) THEN approved.content ELSE NULL END,
      staff_confirmed = COALESCE((approved.evidence ->> 'staffConfirmed')::boolean, false),
      approved_by = approved.actor_id, approved_at = approved.created_at,
      published_document_id = candidate.published_document_id,
      published_document_version = approved.document_version,
      source_question = '', source_question_expires_at = now(), expires_at = NULL,
      revision = candidate.revision + 1,
      evidence = approved.evidence || jsonb_build_object('retrievalRevision', candidate.evidence -> 'retrievalRevision')
    WHERE id = candidate.id AND clinic_id = candidate.clinic_id;
    UPDATE knowledge_learning_history SET content = ''
    WHERE candidate_id = candidate.id AND clinic_id = candidate.clinic_id
      AND action NOT IN ('approve', 'rollback');
  END LOOP;
END $$;

-- Legacy never-approved drafts also require a finite lifetime. Do not extend an
-- existing deadline, and do not give already-old drafts another 24 hours.
UPDATE knowledge_candidates SET expires_at = created_at + interval '24 hours'
WHERE status IN ('pending_review', 'rejected') AND expires_at IS NULL;
ALTER TABLE knowledge_candidates ADD CONSTRAINT knowledge_candidates_pending_expiry
  CHECK (status NOT IN ('pending_review', 'rejected') OR expires_at IS NOT NULL);
