-- Clinic-scoped access model.
-- Adds account-level memberships while keeping the legacy clinic_users/user_roles
-- model in place for compatibility with existing operational screens.

ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE permissions
  ADD COLUMN IF NOT EXISTS key TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT;

UPDATE permissions SET key = name WHERE key IS NULL;

ALTER TABLE permissions
  ALTER COLUMN key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_permissions_key_unique ON permissions(key);

CREATE TABLE IF NOT EXISTS memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('active', 'suspended'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_unique_scope
  ON memberships(user_id, COALESCE(clinic_id, '00000000-0000-0000-0000-000000000000'::uuid), role_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_clinic ON memberships(clinic_id);

CREATE TABLE IF NOT EXISTS user_menu_overrides (
  user_id UUID NOT NULL,
  clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE,
  menu_key TEXT NOT NULL,
  hidden BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, clinic_id, menu_key)
);

WITH seeded_permissions(key, name, category, description) AS (
  VALUES
    ('inbox.view', 'inbox.view', 'Inbox', 'View conversations in the clinic inbox'),
    ('inbox.assign', 'inbox.assign', 'Inbox', 'Assign or hand off conversations'),
    ('appointments.manage', 'appointments.manage', 'Appointments', 'Create and update appointments'),
    ('calendar.view', 'calendar.view', 'Calendar', 'View clinic calendars'),
    ('patients.manage', 'patients.manage', 'Patients', 'Create and update patient records'),
    ('analytics.view', 'analytics.view', 'Analytics', 'View operational analytics and reports'),
    ('admin.users.manage', 'admin.users.manage', 'Admin', 'Manage clinic users and memberships'),
    ('admin.clinic.configure', 'admin.clinic.configure', 'Admin', 'Configure clinic settings and integrations'),
    ('platform.clinics.manage', 'platform.clinics.manage', 'Platform', 'Manage all clinics as a superuser')
)
INSERT INTO permissions (key, name, category, description)
SELECT key, name, category, description FROM seeded_permissions
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name,
    category = EXCLUDED.category,
    description = EXCLUDED.description;

WITH seeded_roles(name, description) AS (
  VALUES
    ('secretary', 'Default clinic secretary role'),
    ('doctor', 'Default clinic doctor role'),
    ('clinic_admin', 'Default clinic administrator role'),
    ('ia_studio_admin', 'Global Docmee superuser role')
)
INSERT INTO roles (clinic_id, name, description, is_system)
SELECT NULL, name, description, TRUE FROM seeded_roles
WHERE NOT EXISTS (
  SELECT 1 FROM roles r WHERE r.clinic_id IS NULL AND r.name = seeded_roles.name
);

UPDATE roles
SET is_system = TRUE
WHERE clinic_id IS NULL
  AND name IN ('secretary', 'doctor', 'clinic_admin', 'ia_studio_admin');

WITH grants(role_name, permission_key) AS (
  VALUES
    ('secretary', 'inbox.view'),
    ('secretary', 'inbox.assign'),
    ('secretary', 'appointments.manage'),
    ('secretary', 'calendar.view'),
    ('secretary', 'patients.manage'),
    ('doctor', 'inbox.view'),
    ('doctor', 'calendar.view'),
    ('clinic_admin', 'inbox.view'),
    ('clinic_admin', 'inbox.assign'),
    ('clinic_admin', 'appointments.manage'),
    ('clinic_admin', 'calendar.view'),
    ('clinic_admin', 'patients.manage'),
    ('clinic_admin', 'analytics.view'),
    ('clinic_admin', 'admin.users.manage'),
    ('clinic_admin', 'admin.clinic.configure'),
    ('ia_studio_admin', 'inbox.view'),
    ('ia_studio_admin', 'inbox.assign'),
    ('ia_studio_admin', 'appointments.manage'),
    ('ia_studio_admin', 'calendar.view'),
    ('ia_studio_admin', 'patients.manage'),
    ('ia_studio_admin', 'analytics.view'),
    ('ia_studio_admin', 'admin.users.manage'),
    ('ia_studio_admin', 'admin.clinic.configure'),
    ('ia_studio_admin', 'platform.clinics.manage')
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM grants g
JOIN roles r ON r.name = g.role_name AND r.clinic_id IS NULL AND r.is_system = TRUE
JOIN permissions p ON p.key = g.permission_key
ON CONFLICT DO NOTHING;

WITH legacy_roles AS (
  SELECT
    cu.id AS clinic_user_id,
    cu.user_id AS account_user_id,
    cu.clinic_id,
    cu.status,
    COALESCE(
      (
        ARRAY_AGG(r.name ORDER BY
          CASE r.name
            WHEN 'ia_studio_admin' THEN 4
            WHEN 'clinic_admin' THEN 3
            WHEN 'doctor' THEN 2
            ELSE 1
          END DESC
        ) FILTER (WHERE r.name IS NOT NULL)
      )[1],
      'secretary'
    ) AS role_name
  FROM clinic_users cu
  LEFT JOIN user_roles ur ON ur.clinic_user_id = cu.id
  LEFT JOIN roles r ON r.id = ur.role_id
  GROUP BY cu.id
)
INSERT INTO memberships (user_id, clinic_id, role_id, status)
SELECT
  lr.account_user_id,
  CASE WHEN sr.name = 'ia_studio_admin' THEN NULL ELSE lr.clinic_id END,
  sr.id,
  CASE WHEN lr.status = 'active' THEN 'active' ELSE 'suspended' END
FROM legacy_roles lr
JOIN roles sr ON sr.name = lr.role_name AND sr.clinic_id IS NULL AND sr.is_system = TRUE
ON CONFLICT DO NOTHING;

