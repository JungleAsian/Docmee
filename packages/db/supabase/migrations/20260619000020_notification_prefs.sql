-- Req 24 (Notifications): per-user notification preferences.
--
-- A clinic user can mute the EMAIL channel for non-urgent alerts (master switch
-- + a list of muted alert types). The in-panel bell feed always records every
-- alert regardless of these prefs — prefs only gate the extra email — and urgent
-- (p1) alerts (emergency, human-handoff, bot-failed, upset, escalation) can never
-- be muted, so a safety alert always reaches the secretary's inbox.
--
-- Shape (defaults applied in code when keys are absent):
--   { "emailEnabled": boolean, "mutedTypes": string[] }
ALTER TABLE clinic_users
  ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;
