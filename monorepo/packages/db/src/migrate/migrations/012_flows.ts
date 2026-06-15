import type { Migration } from "../runner.js";

/**
 * 012 — Custom flows + clinic rules (Phase 3B). Both are declarative DATA
 * (jsonb) interpreted by the deterministic engines in @docmee/core. Clinic-scoped
 * with ENABLE+FORCE RLS.
 */
const sql = /* sql */ `
  CREATE TABLE flows (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id  uuid NOT NULL REFERENCES clinics(id),
    name       text NOT NULL,
    definition jsonb NOT NULL,
    enabled    boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE clinic_rules (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id  uuid NOT NULL REFERENCES clinics(id),
    name       text NOT NULL,
    definition jsonb NOT NULL,
    priority   integer NOT NULL DEFAULT 0,
    enabled    boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  ALTER TABLE flows        ENABLE ROW LEVEL SECURITY;
  ALTER TABLE clinic_rules ENABLE ROW LEVEL SECURITY;
  ALTER TABLE flows        FORCE ROW LEVEL SECURITY;
  ALTER TABLE clinic_rules FORCE ROW LEVEL SECURITY;

  CREATE POLICY clinic_scope ON flows
    USING (clinic_id = current_clinic_id()) WITH CHECK (clinic_id = current_clinic_id());
  CREATE POLICY clinic_scope ON clinic_rules
    USING (clinic_id = current_clinic_id()) WITH CHECK (clinic_id = current_clinic_id());

  GRANT SELECT, INSERT, UPDATE ON flows, clinic_rules TO docmee_app;
`;

const migration: Migration = { version: 12, name: "flows", sql };
export default migration;
