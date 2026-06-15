import type { Migration } from "../runner.js";

/**
 * 014 — Web Push / notification preferences (Phase 3D). Stores per-user Web Push
 * subscriptions (VAPID) and per-priority channel preferences. Clinic-scoped with
 * ENABLE+FORCE RLS.
 */
const sql = /* sql */ `
  CREATE TABLE push_subscriptions (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id      uuid NOT NULL REFERENCES clinics(id),
    clinic_user_id uuid NOT NULL REFERENCES clinic_users(id),
    endpoint       text NOT NULL UNIQUE,
    p256dh         text NOT NULL,
    auth           text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX push_subscriptions_user ON push_subscriptions (clinic_id, clinic_user_id);

  CREATE TABLE notification_preferences (
    clinic_id      uuid NOT NULL REFERENCES clinics(id),
    clinic_user_id uuid NOT NULL REFERENCES clinic_users(id),
    priority       text NOT NULL CHECK (priority IN ('P1','P2','P3','P4')),
    channels       text[] NOT NULL DEFAULT '{}',
    PRIMARY KEY (clinic_user_id, priority)
  );

  ALTER TABLE push_subscriptions       ENABLE ROW LEVEL SECURITY;
  ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
  ALTER TABLE push_subscriptions       FORCE ROW LEVEL SECURITY;
  ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;

  CREATE POLICY clinic_scope ON push_subscriptions
    USING (clinic_id = current_clinic_id()) WITH CHECK (clinic_id = current_clinic_id());
  CREATE POLICY clinic_scope ON notification_preferences
    USING (clinic_id = current_clinic_id()) WITH CHECK (clinic_id = current_clinic_id());

  GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO docmee_app;
  GRANT SELECT, INSERT, UPDATE ON notification_preferences TO docmee_app;
`;

const migration: Migration = { version: 14, name: "push", sql };
export default migration;
