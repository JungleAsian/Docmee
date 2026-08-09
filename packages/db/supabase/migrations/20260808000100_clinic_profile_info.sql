-- Clinic profile info: address/location, contact phone, and clinic type (free
-- text, e.g. "General Practice", "Dental", "Dermatology") — surfaced in Studio
-- General settings and threaded into the bot's system prompt so it can answer
-- patients directly instead of relying on the free-text clinic-rules workaround.
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS address     TEXT,
  ADD COLUMN IF NOT EXISTS phone       TEXT,
  ADD COLUMN IF NOT EXISTS clinic_type TEXT;
