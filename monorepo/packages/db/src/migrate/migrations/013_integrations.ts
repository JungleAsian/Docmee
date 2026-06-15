import type { Migration } from "../runner.js";

/**
 * 013 — Integrations & OCR (Phase 3C). Document uploads (OCR → KB chunks),
 * outward integration configs (Sheets/CRM; credentials write-only after save),
 * and report schedules. All clinic-scoped with ENABLE+FORCE RLS.
 */
const sql = /* sql */ `
  CREATE TABLE document_uploads (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id   uuid NOT NULL REFERENCES clinics(id),
    filename    text NOT NULL,
    status      text NOT NULL DEFAULT 'uploaded'
                  CHECK (status IN ('uploaded','processed','failed')),
    chunk_count integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE clinic_integrations (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id  uuid NOT NULL REFERENCES clinics(id),
    type       text NOT NULL CHECK (type IN ('sheets','crm')),
    config     jsonb NOT NULL DEFAULT '{}',
    enabled    boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE report_schedules (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id  uuid NOT NULL REFERENCES clinics(id),
    type       text NOT NULL,
    cadence    text NOT NULL CHECK (cadence IN ('daily','weekly','monthly')),
    config     jsonb NOT NULL DEFAULT '{}',
    enabled    boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  ALTER TABLE document_uploads     ENABLE ROW LEVEL SECURITY;
  ALTER TABLE clinic_integrations  ENABLE ROW LEVEL SECURITY;
  ALTER TABLE report_schedules     ENABLE ROW LEVEL SECURITY;
  ALTER TABLE document_uploads     FORCE ROW LEVEL SECURITY;
  ALTER TABLE clinic_integrations  FORCE ROW LEVEL SECURITY;
  ALTER TABLE report_schedules     FORCE ROW LEVEL SECURITY;

  CREATE POLICY clinic_scope ON document_uploads
    USING (clinic_id = current_clinic_id()) WITH CHECK (clinic_id = current_clinic_id());
  CREATE POLICY clinic_scope ON clinic_integrations
    USING (clinic_id = current_clinic_id()) WITH CHECK (clinic_id = current_clinic_id());
  CREATE POLICY clinic_scope ON report_schedules
    USING (clinic_id = current_clinic_id()) WITH CHECK (clinic_id = current_clinic_id());

  GRANT SELECT, INSERT, UPDATE ON document_uploads, clinic_integrations,
    report_schedules TO docmee_app;
`;

const migration: Migration = { version: 13, name: "integrations", sql };
export default migration;
