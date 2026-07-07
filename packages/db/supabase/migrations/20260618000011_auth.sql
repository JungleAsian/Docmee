-- P08: Auth & API
-- clinic_users gains the columns the panel login needs:
--   - password_hash → scrypt hash (see @docmee/shared hashPassword); NULL for
--     invited users who have not set a password yet.
--   - panel_language → per-user UI language for the clinic panel (Decision: es default).
-- Roles already exist (roles / user_roles from P02); login derives the JWT role
-- from the user's highest-privilege role name.

ALTER TABLE clinic_users
  ADD COLUMN IF NOT EXISTS password_hash  TEXT,
  ADD COLUMN IF NOT EXISTS panel_language TEXT NOT NULL DEFAULT 'es';

ALTER TABLE clinic_users
  ADD CONSTRAINT clinic_users_panel_language_check
  CHECK (panel_language IN ('es', 'en'));

-- Lower-cased email lookup for login (emails are unique per clinic in practice,
-- but the panel logs in by email alone, so index the lower(email) form).
CREATE INDEX IF NOT EXISTS idx_clinic_users_email ON clinic_users(LOWER(email));
