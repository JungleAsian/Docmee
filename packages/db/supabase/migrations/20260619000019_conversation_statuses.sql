-- Req 11 (Tags & Conversation Statuses): expand the conversation lifecycle from
-- the original 4 statuses to the full 7-state model.
--
--   open      → bot is active and auto-replying (default)
--   pending   → queued, awaiting a human follow-up (e.g. info collected out of hours)
--   assigned  → a specific secretary/doctor owns it
--   handoff   → escalated to a human, awaiting pickup (bot paused)
--   snoozed   → deliberately deferred to follow up later
--   resolved  → closed successfully
--   archived  → filed away / closed as junk (terminal)
--
-- The bot-active rule keys solely on `open` (see packages/agents/handoff.ts
-- isBotPaused: status !== 'open'), so every new status keeps the bot silent —
-- adding them cannot regress the Bot Interruption Rule.
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_status_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_status_check
  CHECK (status IN ('open', 'pending', 'assigned', 'handoff', 'snoozed', 'resolved', 'archived'));
