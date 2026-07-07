-- CRE-60: snooze-until time + auto-wake. A snoozed conversation carries the time
-- it should resurface; the timeout-monitor worker reopens it once that passes.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS snooze_until timestamptz;
