-- Rev 2: Approval node. A follow-up automation can require secretary sign-off
-- before it sends. Extend the status check to allow:
--   pending_approval — drafted by the worker, awaiting a secretary's decision
--   rejected         — a secretary declined the drafted follow-up (never sent)
ALTER TABLE follow_ups DROP CONSTRAINT IF EXISTS follow_ups_status_check;
ALTER TABLE follow_ups ADD CONSTRAINT follow_ups_status_check
  CHECK (status IN ('pending', 'sent', 'clicked', 'skipped', 'pending_approval', 'rejected'));
