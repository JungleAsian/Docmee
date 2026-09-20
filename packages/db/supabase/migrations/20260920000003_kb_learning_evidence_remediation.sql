-- Patient questions never inherit the durable lifetime of an approved fact.
ALTER TABLE knowledge_candidates ADD COLUMN source_question_expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours');
UPDATE knowledge_candidates SET source_question_expires_at = LEAST(created_at + interval '24 hours', COALESCE(expires_at, now()));
UPDATE knowledge_candidates SET source_question = '' WHERE status IN ('approved', 'superseded') OR source_question_expires_at <= now();
-- Unreviewed drafts can contain identifiers missed by best-effort redaction.
UPDATE knowledge_learning_history h SET content = '' FROM knowledge_candidates c
WHERE h.candidate_id = c.id AND c.status IN ('approved', 'superseded') AND h.action NOT IN ('approve', 'rollback');
CREATE INDEX knowledge_candidates_question_expiry ON knowledge_candidates(source_question_expires_at) WHERE source_question <> '';
