-- The expansion migration necessarily defaulted pre-existing appointments to
-- manual. Recover only rows with reliable automation provenance: linked patient
-- conversations (panel bookings never set conversation_id) or known metadata.
UPDATE appointments
SET booking_origin = CASE
  WHEN LOWER(COALESCE(metadata->>'source', '')) = 'workflow'
    OR LOWER(COALESCE(metadata->>'bookingOrigin', '')) = 'workflow'
    OR LOWER(COALESCE(metadata->>'booking_origin', '')) = 'workflow'
  THEN 'workflow'
  ELSE 'docmee'
END
WHERE booking_origin = 'manual'
  AND actor_id IS NULL
  AND (
    conversation_id IS NOT NULL
    OR LOWER(COALESCE(metadata->>'source', '')) IN ('docmee', 'workflow')
    OR LOWER(COALESCE(metadata->>'bookingOrigin', '')) IN ('docmee', 'workflow')
    OR LOWER(COALESCE(metadata->>'booking_origin', '')) IN ('docmee', 'workflow')
  );
