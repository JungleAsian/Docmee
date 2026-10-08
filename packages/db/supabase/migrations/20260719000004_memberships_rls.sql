-- CRE-52: memberships are read by clinic-scoped staff and team routes.
--
-- The authenticated transaction role was intentionally granted only RLS-enabled
-- tables in 20260719000001.  memberships pre-dated that migration without an
-- RLS policy, which left live team/calendar requests failing with SQLSTATE 42501
-- after SET LOCAL ROLE authenticated.  Scope membership rows to the active
-- clinic, while allowing reads of the global ia_studio_admin membership needed
-- to resolve the effective staff role.  Global memberships remain service-only
-- for writes; clinic transactions must never create or modify them.

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memberships_read_scope ON memberships;
DROP POLICY IF EXISTS memberships_insert_scope ON memberships;
DROP POLICY IF EXISTS memberships_update_scope ON memberships;
DROP POLICY IF EXISTS memberships_delete_scope ON memberships;

CREATE POLICY memberships_read_scope
  ON memberships
  FOR SELECT
  TO authenticated
  USING (clinic_id = app_clinic_id() OR clinic_id IS NULL);

CREATE POLICY memberships_insert_scope
  ON memberships
  FOR INSERT
  TO authenticated
  WITH CHECK (clinic_id = app_clinic_id());

CREATE POLICY memberships_update_scope
  ON memberships
  FOR UPDATE
  TO authenticated
  USING (clinic_id = app_clinic_id())
  WITH CHECK (clinic_id = app_clinic_id());

CREATE POLICY memberships_delete_scope
  ON memberships
  FOR DELETE
  TO authenticated
  USING (clinic_id = app_clinic_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON memberships TO authenticated;
