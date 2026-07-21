-- CRE-530: the report period is a durable delivery boundary.  A queue retry,
-- a second worker replica, or the repeated local hour at DST fall-back must not
-- create or send the same clinic/period/recipient report twice.
ALTER TABLE generated_reports
  ADD COLUMN IF NOT EXISTS schedule_key TEXT;

ALTER TABLE generated_reports
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (delivery_status IN ('pending', 'sending', 'failed', 'sent'));

CREATE UNIQUE INDEX IF NOT EXISTS generated_reports_schedule_key_unique
  ON generated_reports(schedule_key)
  WHERE schedule_key IS NOT NULL;
