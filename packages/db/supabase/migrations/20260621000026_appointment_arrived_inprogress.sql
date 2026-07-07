-- Screen 2 (AI booking & calendar) — extend the appointment lifecycle with the two
-- in-clinic states the operational calendar needs: 'arrived' (the patient has shown
-- up) and 'in_progress' (the visit is underway), sitting between 'confirmed' and
-- 'completed'. Both the status column and the appointment_events audit log gain them.

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('pending', 'confirmed', 'arrived', 'in_progress', 'cancelled', 'completed', 'no_show'));

ALTER TABLE appointment_events DROP CONSTRAINT IF EXISTS appt_events_type_check;
ALTER TABLE appointment_events ADD CONSTRAINT appt_events_type_check
  CHECK (event_type IN (
    'created', 'confirmed', 'arrived', 'in_progress', 'cancelled',
    'rescheduled', 'completed', 'no_show', 'reminder_sent'
  ));
