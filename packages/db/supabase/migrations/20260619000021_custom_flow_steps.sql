-- Rev1 #28 (Gap #34): multi-step custom flows.
--
-- The original custom_flows row was a single-turn matcher: trigger keywords →
-- a fixed `messages` list + one terminal `action`. This adds a step graph so a
-- flow can ask a question, branch on the patient's reply, collect answers, and
-- only then book / hand off / end (executed by the flow engine in the worker).
--
-- Backward compatible: existing rows keep an empty `steps` array and continue to
-- run as legacy single-shot flows (the engine wraps `messages`/`action` in one
-- fire-once step). `start_step_id` names the entry node for step-based flows.

ALTER TABLE custom_flows
  ADD COLUMN IF NOT EXISTS steps         JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS start_step_id TEXT;
