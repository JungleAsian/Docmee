-- CRE-527: retain an actionable, redacted outcome for a failed scheduled email.
-- The worker writes a fixed category only; raw provider responses and credentials
-- are intentionally never stored in this column.
ALTER TABLE generated_reports
  ADD COLUMN IF NOT EXISTS delivery_diagnostic TEXT;
