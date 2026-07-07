-- P02: Tenant and access tables

CREATE TABLE IF NOT EXISTS clinics (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  slug       TEXT        UNIQUE NOT NULL,
  plan       TEXT        NOT NULL DEFAULT 'starter',
  status     TEXT        NOT NULL DEFAULT 'active',
  settings   JSONB       NOT NULL DEFAULT '{}',
  timezone   TEXT        NOT NULL DEFAULT 'America/Guatemala',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT clinics_plan_check   CHECK (plan   IN ('starter', 'pro', 'enterprise')),
  CONSTRAINT clinics_status_check CHECK (status IN ('active', 'suspended', 'cancelled'))
);

SELECT add_updated_at_trigger('clinics');

CREATE TABLE IF NOT EXISTS clinic_users (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL,
  email      TEXT        NOT NULL,
  full_name  TEXT,
  status     TEXT        NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT clinic_users_status_check CHECK (status IN ('active', 'inactive', 'invited')),
  UNIQUE (clinic_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_clinic_users_clinic ON clinic_users(clinic_id);
CREATE INDEX IF NOT EXISTS idx_clinic_users_user   ON clinic_users(user_id);
SELECT add_updated_at_trigger('clinic_users');

CREATE TABLE IF NOT EXISTS roles (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID        REFERENCES clinics(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

SELECT add_updated_at_trigger('roles');

CREATE TABLE IF NOT EXISTS permissions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        UNIQUE NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id       UUID        NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID        NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_user_id UUID        NOT NULL REFERENCES clinic_users(id) ON DELETE CASCADE,
  role_id        UUID        NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_user_id, role_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  actor_id      UUID,
  actor_email   TEXT,
  action        TEXT        NOT NULL,
  resource_type TEXT        NOT NULL,
  resource_id   UUID,
  metadata      JSONB       NOT NULL DEFAULT '{}',
  ip_address    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_clinic     ON audit_events(clinic_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_resource   ON audit_events(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at DESC);
