-- The expansion contracts have completed their staged rollout checks.
-- Enable the global defaults for the Docmee production surface.
UPDATE feature_flags
SET enabled = TRUE,
    rollout_percentage = 100,
    updated_at = NOW()
WHERE clinic_id IS NULL
  AND name IN (
    'docmee_inbox_layout_v2',
    'docmee_human_only_mode',
    'docmee_classifications',
    'docmee_calendar_policy_v2',
    'docmee_media_repository',
    'docmee_notification_chimes',
    'docmee_workflow_edges_v2'
  );
