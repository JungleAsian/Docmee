-- Server-backed per-user interface preferences for InboxOS and Studio.
-- Preferences are cosmetic/navigation-layout hints only; authorization still
-- comes from roles and permissions at the API/router boundary.
ALTER TABLE clinic_users
  ADD COLUMN IF NOT EXISTS ui_preferences JSONB NOT NULL DEFAULT '{}'::jsonb;
