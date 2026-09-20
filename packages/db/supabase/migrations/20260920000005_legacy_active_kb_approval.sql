-- Before governed approval timestamps existed, an active document was the
-- staff publication signal. Preserve that historic decision explicitly so the
-- freshness migration can rebuild it from authoritative document content.
-- This deliberately does not approve drafts, candidates, or any new content.
UPDATE knowledge_documents
SET approved_at = updated_at,
    indexing_status = 'pending',
    indexing_error = NULL,
    metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{approvalProvenance}',
      COALESCE(
        metadata -> 'approvalProvenance',
        '"legacy_active_before_governed_upgrade"'::jsonb
      ),
      true
    )
WHERE status = 'active'
  AND approved_at IS NULL;

-- Fresh chunks must still be created by the authoritative reindex path; this
-- migration never relabels or reactivates legacy chunk text.
