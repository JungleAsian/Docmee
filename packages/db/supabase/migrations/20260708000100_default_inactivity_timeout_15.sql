-- Set the default automatic logout timer to 15 minutes.
ALTER TABLE clinic_users
  ALTER COLUMN inactivity_timeout_minutes SET DEFAULT 15;

-- Preserve clearly customized values, but move old system defaults forward.
UPDATE clinic_users
SET inactivity_timeout_minutes = 15
WHERE inactivity_timeout_minutes IN (1, 5);
