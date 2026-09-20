-- Rejections remain auditable while their candidate is retained, without making
-- temporary patient evidence durable after the candidate's retention period.
ALTER TABLE knowledge_learning_history ADD COLUMN rejection_reason text;
ALTER TABLE knowledge_learning_history ADD COLUMN rejection_detail text;
ALTER TABLE knowledge_learning_history ADD CONSTRAINT knowledge_learning_history_rejection_reason
  CHECK (rejection_reason IS NULL OR rejection_reason IN ('unsupported', 'outdated', 'unsafe', 'duplicate', 'not_clinic_policy', 'other'));
ALTER TABLE knowledge_learning_history ADD CONSTRAINT knowledge_learning_history_rejection_detail
  CHECK (rejection_reason <> 'other' OR NULLIF(btrim(COALESCE(rejection_detail, '')), '') IS NOT NULL);
