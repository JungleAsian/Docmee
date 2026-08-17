-- Appointment-level Google Calendar sync state. The `appointments` row is
-- always the source of truth and is always written regardless of Calendar
-- state; these columns let a background sweep find and retry rows whose
-- Google Calendar event still needs to be created/updated/deleted, instead of
-- treating a successful Calendar call as a precondition for saving a booking.
-- DEFAULT FALSE (not TRUE) so existing historical rows aren't retroactively
-- flagged for a backfill sync sweep — application code sets it explicitly on
-- new writes going forward.
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS calendar_sync_pending  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS calendar_sync_error    TEXT,
  ADD COLUMN IF NOT EXISTS calendar_sync_attempts SMALLINT NOT NULL DEFAULT 0;

-- Retry sweep candidate query: bounded to rows actually pending, oldest first.
CREATE INDEX IF NOT EXISTS idx_appointments_calendar_sync_pending
  ON appointments (updated_at)
  WHERE calendar_sync_pending = TRUE;
