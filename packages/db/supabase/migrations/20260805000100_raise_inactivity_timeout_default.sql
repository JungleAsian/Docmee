-- Raise the inactivity-timeout default from 1 minute to 30 minutes.
-- The original 1-minute default kicked builders out of the workflow canvas
-- mid-edit (canvas interactions produce no API calls, and a minute of
-- reading/thinking looks like idleness), risking unsaved work.
-- Existing rows still on the old implicit default of 1 are lifted to 30;
-- admins can still deliberately set any value 1-480 via the Users page.
ALTER TABLE clinic_users
  ALTER COLUMN inactivity_timeout_minutes SET DEFAULT 30;

UPDATE clinic_users
  SET inactivity_timeout_minutes = 30
  WHERE inactivity_timeout_minutes = 1;
