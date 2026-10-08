-- Enhancement 07-09-2026: use a 15-minute inactivity timeout by default.
ALTER TABLE clinic_users
  ALTER COLUMN inactivity_timeout_minutes SET DEFAULT 15;

-- The previous migration used 1 minute as its default. Move only those
-- untouched default rows to the requested default; customized values remain intact.
UPDATE clinic_users
SET inactivity_timeout_minutes = 15
WHERE inactivity_timeout_minutes = 1;
