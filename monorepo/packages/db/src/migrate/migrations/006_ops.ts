import type { Migration } from "../runner.js";

/**
 * 006 — Multi-user ops / IA Studio / billing (Phase 2A).
 *
 * Control model (architecture §7): a feature is available only if all three gates
 * pass — platform feature flag → plan allows it → clinic toggled on.
 *
 * plans + platform_feature_flags are GLOBAL config (readable by the app role for
 * gating; writes go through the platform/admin path). Everything else is
 * clinic-scoped with ENABLE+FORCE RLS.
 */
const sql = /* sql */ `
  -- ── Global config ───────────────────────────────────────────────────────────
  CREATE TABLE plans (
    key                text PRIMARY KEY,
    name               text NOT NULL,
    price_cents        integer NOT NULL DEFAULT 0,
    conversation_limit integer NOT NULL DEFAULT 0,
    channel_limit      integer NOT NULL DEFAULT 1,
    user_limit         integer NOT NULL DEFAULT 1,
    doctor_limit       integer NOT NULL DEFAULT 1,
    features           jsonb NOT NULL DEFAULT '[]'
  );

  INSERT INTO plans (key, name, price_cents, conversation_limit, channel_limit, user_limit, doctor_limit, features) VALUES
    ('starter',      'Starter',       9900,   500, 1,  2,  1, '["inbox","scheduling"]'),
    ('growth',       'Growth',       19900,  1500, 1,  5,  1, '["inbox","scheduling","automation"]'),
    ('professional', 'Professional', 34900,  3000, 3, 10,  3, '["inbox","scheduling","automation","channels","analytics"]'),
    ('clinic_plus',  'Clinic Plus',  54900,  6000, 3, 20, 10, '["inbox","scheduling","automation","channels","analytics","flows"]');

  CREATE TABLE platform_feature_flags (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key       text NOT NULL,
    scope     text NOT NULL DEFAULT 'all' CHECK (scope IN ('all','plan','clinic')),
    plan_key  text REFERENCES plans(key),
    clinic_id uuid REFERENCES clinics(id),
    enabled   boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX platform_feature_flags_key ON platform_feature_flags (key);

  ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
  ALTER TABLE platform_feature_flags ENABLE ROW LEVEL SECURITY;
  -- Global, non-sensitive config: readable by all; writes via admin (superuser).
  CREATE POLICY read_all ON plans FOR SELECT USING (true);
  CREATE POLICY read_all ON platform_feature_flags FOR SELECT USING (true);
  GRANT SELECT ON plans, platform_feature_flags TO docmee_app;

  -- ── Clinic-scoped ───────────────────────────────────────────────────────────
  CREATE TABLE clinic_subscriptions (
    clinic_id      uuid PRIMARY KEY REFERENCES clinics(id),
    plan_key       text NOT NULL REFERENCES plans(key),
    status         text NOT NULL DEFAULT 'trial'
                     CHECK (status IN ('trial','active','cancelled')),
    trial_ends_at  timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE clinic_feature_toggles (
    clinic_id    uuid NOT NULL REFERENCES clinics(id),
    feature_key  text NOT NULL,
    enabled      boolean NOT NULL DEFAULT true,
    PRIMARY KEY (clinic_id, feature_key)
  );

  CREATE TABLE quick_replies (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id  uuid NOT NULL REFERENCES clinics(id),
    shortcut   text NOT NULL,
    body       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE invoices (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id    uuid NOT NULL REFERENCES clinics(id),
    period_start date NOT NULL,
    period_end   date NOT NULL,
    amount_cents integer NOT NULL DEFAULT 0,
    status       text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','sent','paid','void')),
    created_at   timestamptz NOT NULL DEFAULT now()
  );

  ALTER TABLE clinic_subscriptions   ENABLE ROW LEVEL SECURITY;
  ALTER TABLE clinic_feature_toggles ENABLE ROW LEVEL SECURITY;
  ALTER TABLE quick_replies          ENABLE ROW LEVEL SECURITY;
  ALTER TABLE invoices               ENABLE ROW LEVEL SECURITY;
  ALTER TABLE clinic_subscriptions   FORCE ROW LEVEL SECURITY;
  ALTER TABLE clinic_feature_toggles FORCE ROW LEVEL SECURITY;
  ALTER TABLE quick_replies          FORCE ROW LEVEL SECURITY;
  ALTER TABLE invoices               FORCE ROW LEVEL SECURITY;

  CREATE POLICY clinic_scope ON clinic_subscriptions
    USING (clinic_id = current_clinic_id()) WITH CHECK (clinic_id = current_clinic_id());
  CREATE POLICY clinic_scope ON clinic_feature_toggles
    USING (clinic_id = current_clinic_id()) WITH CHECK (clinic_id = current_clinic_id());
  CREATE POLICY clinic_scope ON quick_replies
    USING (clinic_id = current_clinic_id()) WITH CHECK (clinic_id = current_clinic_id());
  CREATE POLICY clinic_scope ON invoices
    USING (clinic_id = current_clinic_id()) WITH CHECK (clinic_id = current_clinic_id());

  GRANT SELECT, INSERT, UPDATE ON clinic_subscriptions, clinic_feature_toggles,
    quick_replies, invoices TO docmee_app;
`;

const migration: Migration = { version: 6, name: "ops", sql };
export default migration;
