import type { Migration } from "../runner.js";

/**
 * 004 — Human inbox + CRM (Phase 1B). Patient tags + notes, conversation notes,
 * and a minimal notification slice. All clinic-scoped with ENABLE+FORCE RLS.
 */
const sql = /* sql */ `
  ALTER TABLE patients ADD COLUMN tags text[] NOT NULL DEFAULT '{}';

  CREATE TABLE patient_notes (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id     uuid NOT NULL REFERENCES clinics(id),
    patient_id    uuid NOT NULL REFERENCES patients(id),
    author_id     uuid REFERENCES clinic_users(id),
    body          text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE conversation_notes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id       uuid NOT NULL REFERENCES clinics(id),
    conversation_id uuid NOT NULL REFERENCES conversations(id),
    author_id       uuid REFERENCES clinic_users(id),
    body            text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE notifications (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id       uuid NOT NULL REFERENCES clinics(id),
    priority        text NOT NULL CHECK (priority IN ('P1','P2','P3','P4')),
    type            text NOT NULL,
    conversation_id uuid REFERENCES conversations(id),
    patient_id      uuid REFERENCES patients(id),
    body            text,
    read_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
  );

  CREATE INDEX patient_notes_patient ON patient_notes (clinic_id, patient_id, created_at DESC);
  CREATE INDEX notifications_unread ON notifications (clinic_id, read_at, created_at DESC);

  ALTER TABLE patient_notes      ENABLE ROW LEVEL SECURITY;
  ALTER TABLE conversation_notes ENABLE ROW LEVEL SECURITY;
  ALTER TABLE notifications      ENABLE ROW LEVEL SECURITY;
  ALTER TABLE patient_notes      FORCE ROW LEVEL SECURITY;
  ALTER TABLE conversation_notes FORCE ROW LEVEL SECURITY;
  ALTER TABLE notifications      FORCE ROW LEVEL SECURITY;

  CREATE POLICY clinic_scope ON patient_notes
    USING (clinic_id = current_clinic_id()) WITH CHECK (clinic_id = current_clinic_id());
  CREATE POLICY clinic_scope ON conversation_notes
    USING (clinic_id = current_clinic_id()) WITH CHECK (clinic_id = current_clinic_id());
  CREATE POLICY clinic_scope ON notifications
    USING (clinic_id = current_clinic_id()) WITH CHECK (clinic_id = current_clinic_id());

  GRANT SELECT, INSERT, UPDATE ON patient_notes, conversation_notes, notifications
    TO docmee_app;
`;

const migration: Migration = { version: 4, name: "crm", sql };
export default migration;
