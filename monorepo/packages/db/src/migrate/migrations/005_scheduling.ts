import type { Migration } from "../runner.js";

/**
 * 005 — Scheduling (Phase 1C). Appointments (Google Calendar event id retained;
 * Calendar is the datetime source of truth), an append-only status log, and the
 * resumable patient_intake state machine. Intake collected data is encrypted at
 * rest (PHI: reason/notes) as a single ciphertext blob.
 */
const sql = /* sql */ `
  CREATE TABLE appointments (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id         uuid NOT NULL REFERENCES clinics(id),
    patient_id        uuid NOT NULL REFERENCES patients(id),
    doctor_id         uuid REFERENCES doctors(id),
    status            text NOT NULL DEFAULT 'booked'
                        CHECK (status IN ('booked','confirmed','completed','cancelled','no_show')),
    start_at          timestamptz NOT NULL,
    end_at            timestamptz NOT NULL,
    calendar_event_id text,
    created_at        timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE appointment_status_log (
    id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    clinic_id            uuid NOT NULL REFERENCES clinics(id),
    appointment_id       uuid NOT NULL REFERENCES appointments(id),
    from_status          text,
    to_status            text NOT NULL,
    actor_clinic_user_id uuid REFERENCES clinic_users(id),
    created_at           timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE patient_intake (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id         uuid NOT NULL REFERENCES clinics(id),
    conversation_id   uuid NOT NULL REFERENCES conversations(id),
    patient_id        uuid NOT NULL REFERENCES patients(id),
    status            text NOT NULL DEFAULT 'in_progress'
                        CHECK (status IN ('in_progress','completed','abandoned')),
    step              integer NOT NULL DEFAULT 0,
    data_ciphertext   text,
    data_key_version  integer,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
  );

  CREATE INDEX appointments_clinic_patient ON appointments (clinic_id, patient_id, start_at DESC);
  CREATE INDEX appointments_clinic_status ON appointments (clinic_id, status, start_at);
  CREATE INDEX intake_conversation ON patient_intake (clinic_id, conversation_id);

  ALTER TABLE appointments           ENABLE ROW LEVEL SECURITY;
  ALTER TABLE appointment_status_log ENABLE ROW LEVEL SECURITY;
  ALTER TABLE patient_intake         ENABLE ROW LEVEL SECURITY;
  ALTER TABLE appointments           FORCE ROW LEVEL SECURITY;
  ALTER TABLE appointment_status_log FORCE ROW LEVEL SECURITY;
  ALTER TABLE patient_intake         FORCE ROW LEVEL SECURITY;

  CREATE POLICY clinic_scope ON appointments
    USING (clinic_id = current_clinic_id()) WITH CHECK (clinic_id = current_clinic_id());
  CREATE POLICY clinic_scope ON appointment_status_log
    USING (clinic_id = current_clinic_id()) WITH CHECK (clinic_id = current_clinic_id());
  CREATE POLICY clinic_scope ON patient_intake
    USING (clinic_id = current_clinic_id()) WITH CHECK (clinic_id = current_clinic_id());

  GRANT SELECT, INSERT, UPDATE ON appointments, patient_intake TO docmee_app;
  GRANT SELECT, INSERT ON appointment_status_log TO docmee_app;
`;

const migration: Migration = { version: 5, name: "scheduling", sql };
export default migration;
