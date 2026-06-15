import type { Migration } from "../runner.js";

/**
 * 008 — Automation & templates (Phase 2C). Meta templates (approval-gated), the
 * consent ledger, the automation rule catalog, and the automation queue. The queue
 * has a partial unique index for IDEMPOTENT scheduling (no duplicate pending
 * automation per appointment + type).
 */
const sql = /* sql */ `
  CREATE TABLE meta_templates (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id  uuid NOT NULL REFERENCES clinics(id),
    name       text NOT NULL,
    language   text NOT NULL DEFAULT 'es',
    category   text NOT NULL DEFAULT 'utility',
    status     text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','rejected')),
    body       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX meta_templates_name ON meta_templates (clinic_id, name, language);

  -- Consent ledger (append-only rows; latest per scope wins).
  CREATE TABLE patient_consent (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id   uuid NOT NULL REFERENCES clinics(id),
    patient_id  uuid NOT NULL REFERENCES patients(id),
    scope       text NOT NULL DEFAULT 'transactional',
    granted     boolean NOT NULL DEFAULT true,
    source      text,
    created_at  timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX patient_consent_lookup ON patient_consent (clinic_id, patient_id, scope, created_at DESC);

  CREATE TABLE automation_rules (
    clinic_id  uuid NOT NULL REFERENCES clinics(id),
    type       text NOT NULL,
    enabled    boolean NOT NULL DEFAULT true,
    config     jsonb NOT NULL DEFAULT '{}',
    PRIMARY KEY (clinic_id, type)
  );

  CREATE TABLE automation_queue (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id       uuid NOT NULL REFERENCES clinics(id),
    patient_id      uuid NOT NULL REFERENCES patients(id),
    conversation_id uuid REFERENCES conversations(id),
    appointment_id  uuid REFERENCES appointments(id),
    type            text NOT NULL,
    run_at          timestamptz NOT NULL DEFAULT now(),
    status          text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','sent','skipped','cancelled')),
    skip_reason     text,
    template_name   text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    sent_at         timestamptz
  );
  -- Idempotent scheduling: at most one PENDING automation per appointment + type.
  CREATE UNIQUE INDEX automation_queue_idem
    ON automation_queue (clinic_id, type, appointment_id)
    WHERE appointment_id IS NOT NULL AND status = 'pending';
  CREATE INDEX automation_queue_due ON automation_queue (clinic_id, status, run_at);

  ALTER TABLE meta_templates    ENABLE ROW LEVEL SECURITY;
  ALTER TABLE patient_consent   ENABLE ROW LEVEL SECURITY;
  ALTER TABLE automation_rules  ENABLE ROW LEVEL SECURITY;
  ALTER TABLE automation_queue  ENABLE ROW LEVEL SECURITY;
  ALTER TABLE meta_templates    FORCE ROW LEVEL SECURITY;
  ALTER TABLE patient_consent   FORCE ROW LEVEL SECURITY;
  ALTER TABLE automation_rules  FORCE ROW LEVEL SECURITY;
  ALTER TABLE automation_queue  FORCE ROW LEVEL SECURITY;

  CREATE POLICY clinic_scope ON meta_templates
    USING (clinic_id = current_clinic_id()) WITH CHECK (clinic_id = current_clinic_id());
  CREATE POLICY clinic_scope ON patient_consent
    USING (clinic_id = current_clinic_id()) WITH CHECK (clinic_id = current_clinic_id());
  CREATE POLICY clinic_scope ON automation_rules
    USING (clinic_id = current_clinic_id()) WITH CHECK (clinic_id = current_clinic_id());
  CREATE POLICY clinic_scope ON automation_queue
    USING (clinic_id = current_clinic_id()) WITH CHECK (clinic_id = current_clinic_id());

  GRANT SELECT, INSERT, UPDATE ON meta_templates, patient_consent,
    automation_rules, automation_queue TO docmee_app;
`;

const migration: Migration = { version: 8, name: "automation", sql };
export default migration;
