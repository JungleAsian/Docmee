-- Seed reference file (SQL form).
-- The TypeScript seed script (scripts/seed.ts) is the canonical runner.
-- This file exists for Supabase CLI compatibility: supabase db reset reads it automatically.

-- 2 demo clinics
INSERT INTO clinics (name, slug, plan, timezone)
VALUES
  ('Clínica Demo A', 'demo-clinic-a', 'pro',     'America/Guatemala'),
  ('Clínica Demo B', 'demo-clinic-b', 'starter', 'America/Guatemala')
ON CONFLICT (slug) DO NOTHING;

-- Global feature flags
INSERT INTO feature_flags (name, enabled, rollout_percentage)
VALUES
  ('whatsapp_enabled',    TRUE,  100),
  ('messenger_enabled',   FALSE, 0),
  ('instagram_enabled',   FALSE, 0),
  ('ai_enabled',          TRUE,  100),
  ('appointments_enabled',TRUE,  100)
ON CONFLICT (name, clinic_id) DO NOTHING;
