import type { Migration } from "../runner.js";

/**
 * 001 — Foundation: tenancy, disjoint identities, RLS infrastructure, audit log.
 * Clinic-scoped tables enable + FORCE row-level security; policies key off
 * `current_clinic_id()` (the GUC pinned by withClinicContext).
 *
 * A dedicated non-superuser app role (`docmee_app`) is the RLS-bound role the API
 * and workers connect as. The migration/admin role owns the tables and is the only
 * cross-tenant door (decision #1).
 */
const sql = /* sql */ `
  -- Non-superuser application role: RLS always applies to it.
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'docmee_app') THEN
      CREATE ROLE docmee_app NOLOGIN;
    END IF;
  END
  $$;

  -- Resolve the clinic pinned for the current transaction (NULL if unset).
  CREATE OR REPLACE FUNCTION current_clinic_id() RETURNS uuid
    LANGUAGE sql STABLE AS $fn$
      SELECT NULLIF(current_setting('app.clinic_id', true), '')::uuid
    $fn$;

  -- ── Tenancy ───────────────────────────────────────────────────────────────
  CREATE TABLE clinics (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                     text NOT NULL,
    status                   text NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active','inactive')),
    -- Meta WhatsApp routing key; inbound is matched to a clinic by this id.
    whatsapp_phone_number_id text UNIQUE,
    locale                   text NOT NULL DEFAULT 'es' CHECK (locale IN ('es','en')),
    created_at               timestamptz NOT NULL DEFAULT now()
  );

  -- ── Disjoint identities (decision #3) ───────────────────────────────────────
  CREATE TABLE platform_users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text NOT NULL UNIQUE,
    name          text NOT NULL,
    password_hash text NOT NULL,
    must_rotate   boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE clinic_users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id     uuid NOT NULL REFERENCES clinics(id),
    email         text NOT NULL UNIQUE,
    name          text NOT NULL,
    role          text NOT NULL
                    CHECK (role IN ('doctor','secretary','admin','assistant')),
    password_hash text NOT NULL,
    must_rotate   boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now()
  );

  -- ── Doctor seam (decision #4) — laid now, dormant until 3A ──────────────────
  CREATE TABLE doctors (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id  uuid NOT NULL REFERENCES clinics(id),
    name       text NOT NULL,
    specialty  text,
    active     boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE staff_doctor_assignments (
    clinic_user_id uuid NOT NULL REFERENCES clinic_users(id),
    doctor_id      uuid NOT NULL REFERENCES doctors(id),
    clinic_id      uuid NOT NULL REFERENCES clinics(id),
    PRIMARY KEY (clinic_user_id, doctor_id)
  );

  -- ── Governance: append-only audit log ───────────────────────────────────────
  CREATE TABLE audit_log (
    id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    clinic_id                 uuid REFERENCES clinics(id),
    actor_clinic_user_id      uuid REFERENCES clinic_users(id),
    -- Elevated-impersonation seam (decision #2 final-sweep): empty in Phase 0,
    -- populated in 2A so platform-staff actions stay attributable.
    acted_by_platform_user_id uuid REFERENCES platform_users(id),
    action                    text NOT NULL,
    target                    text,
    detail                    jsonb,
    created_at                timestamptz NOT NULL DEFAULT now()
  );

  -- ── Row-level security ──────────────────────────────────────────────────────
  ALTER TABLE clinics       ENABLE ROW LEVEL SECURITY;
  ALTER TABLE clinic_users  ENABLE ROW LEVEL SECURITY;
  ALTER TABLE platform_users ENABLE ROW LEVEL SECURITY;
  ALTER TABLE doctors       ENABLE ROW LEVEL SECURITY;
  ALTER TABLE staff_doctor_assignments ENABLE ROW LEVEL SECURITY;
  ALTER TABLE audit_log     ENABLE ROW LEVEL SECURITY;
  ALTER TABLE clinics       FORCE ROW LEVEL SECURITY;
  ALTER TABLE clinic_users  FORCE ROW LEVEL SECURITY;
  ALTER TABLE platform_users FORCE ROW LEVEL SECURITY;
  ALTER TABLE doctors       FORCE ROW LEVEL SECURITY;
  ALTER TABLE staff_doctor_assignments FORCE ROW LEVEL SECURITY;
  ALTER TABLE audit_log     FORCE ROW LEVEL SECURITY;

  CREATE POLICY clinic_self ON clinics
    USING (id = current_clinic_id());
  CREATE POLICY clinic_scope ON clinic_users
    USING (clinic_id = current_clinic_id());
  CREATE POLICY clinic_scope ON doctors
    USING (clinic_id = current_clinic_id());
  CREATE POLICY clinic_scope ON staff_doctor_assignments
    USING (clinic_id = current_clinic_id());
  CREATE POLICY clinic_scope ON audit_log
    USING (clinic_id = current_clinic_id())
    WITH CHECK (clinic_id = current_clinic_id());
  -- platform_users: no policy for the app role => deny. Login uses a SECURITY
  -- DEFINER function (below); cross-tenant admin uses the admin role.

  -- Login lookups run before any clinic context exists, so they go through
  -- SECURITY DEFINER functions owned by the privileged (table-owner) role, which
  -- bypass RLS for the single controlled email lookup only.
  CREATE OR REPLACE FUNCTION find_clinic_user_by_email(p_email text)
    RETURNS TABLE (id uuid, clinic_id uuid, name text, role text,
                   password_hash text, must_rotate boolean)
    LANGUAGE sql STABLE SECURITY DEFINER AS $fn$
      SELECT id, clinic_id, name, role, password_hash, must_rotate
      FROM clinic_users WHERE email = lower(p_email)
    $fn$;

  CREATE OR REPLACE FUNCTION find_platform_user_by_email(p_email text)
    RETURNS TABLE (id uuid, name text, password_hash text, must_rotate boolean)
    LANGUAGE sql STABLE SECURITY DEFINER AS $fn$
      SELECT id, name, password_hash, must_rotate
      FROM platform_users WHERE email = lower(p_email)
    $fn$;

  -- App role needs table privileges; RLS still constrains the rows it sees.
  GRANT SELECT, INSERT, UPDATE ON clinics, clinic_users, doctors,
    staff_doctor_assignments, audit_log TO docmee_app;
  GRANT EXECUTE ON FUNCTION current_clinic_id() TO docmee_app;
  GRANT EXECUTE ON FUNCTION find_clinic_user_by_email(text) TO docmee_app;
  GRANT EXECUTE ON FUNCTION find_platform_user_by_email(text) TO docmee_app;
`;

const migration: Migration = { version: 1, name: "foundation", sql };
export default migration;
