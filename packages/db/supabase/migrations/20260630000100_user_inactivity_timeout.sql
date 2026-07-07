-- Per-user inactivity timeout for automatic panel logout.
ALTER TABLE clinic_users
  ADD COLUMN IF NOT EXISTS inactivity_timeout_minutes INTEGER NOT NULL DEFAULT 1;

ALTER TABLE clinic_users
  DROP CONSTRAINT IF EXISTS clinic_users_inactivity_timeout_minutes_check;

ALTER TABLE clinic_users
  ADD CONSTRAINT clinic_users_inactivity_timeout_minutes_check
  CHECK (inactivity_timeout_minutes BETWEEN 1 AND 480);
