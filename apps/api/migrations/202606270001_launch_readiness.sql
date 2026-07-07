CREATE TABLE IF NOT EXISTS clinic_launch_readiness (
  clinic_id uuid PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
  waivers jsonb NOT NULL DEFAULT '{}'::jsonb,
  whatsapp_tests jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clinic_launch_readiness_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  actor_id text,
  actor_email text,
  action text NOT NULL,
  field text NOT NULL,
  before_value jsonb,
  after_value jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clinic_launch_readiness_events_clinic_created_idx
  ON clinic_launch_readiness_events (clinic_id, created_at DESC);
