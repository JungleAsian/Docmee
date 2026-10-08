-- CRE-52: execute clinic-scoped application transactions as a role that cannot
-- bypass RLS. The application connection remains privileged only for explicitly
-- service-scoped work (migrations, webhooks, and cross-clinic workers).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
END $$;

-- The migration/application principal may assume the scoped role only inside
-- withClinicContext, which uses SET LOCAL ROLE in a transaction. Use the active
-- principal rather than assuming a particular managed-database username.
DO $$
BEGIN
  EXECUTE format('GRANT authenticated TO %I', current_user);
END $$;
GRANT USAGE ON SCHEMA public TO authenticated;

-- Give the scoped role access only to tables that already have RLS enabled.
-- Policies still decide which clinic rows are visible or writable.
DO $$
DECLARE
  table_record record;
BEGIN
  FOR table_record IN
    SELECT n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND c.relrowsecurity
      AND n.nspname = 'public'
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO authenticated',
      table_record.nspname,
      table_record.relname
    );
  END LOOP;
END $$;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
