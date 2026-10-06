-- Superuser change log: every change made to a workflow, setting or configuration,
-- with who made it and what changed. Written by the API's change-log hook and read
-- only through the ia_studio_admin-only /change-log endpoint.
--
-- clinic_id is deliberately not a foreign key: the log must outlive the clinic it
-- describes (including the entry recording that clinic's deletion).
CREATE TABLE IF NOT EXISTS change_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  clinic_id     UUID,
  clinic_name   TEXT,
  actor_id      UUID,
  actor_email   TEXT,
  actor_role    TEXT,
  area          TEXT        NOT NULL,
  action        TEXT        NOT NULL,
  method        TEXT        NOT NULL,
  route         TEXT        NOT NULL,
  resource_type TEXT        NOT NULL,
  resource_id   TEXT,
  resource_name TEXT,
  outcome       TEXT        NOT NULL CHECK (outcome IN ('succeeded', 'failed')),
  status_code   INTEGER     NOT NULL,
  summary       TEXT        NOT NULL,
  changes       JSONB       NOT NULL DEFAULT '{}',
  request_id    TEXT
);

CREATE INDEX IF NOT EXISTS change_log_created_idx        ON change_log (created_at DESC);
CREATE INDEX IF NOT EXISTS change_log_clinic_created_idx ON change_log (clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS change_log_area_created_idx   ON change_log (area, created_at DESC);

-- No policies: only the owning service role (which bypasses RLS) can read or write.
ALTER TABLE change_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE change_log IS
  'Superuser-only log of workflow, setting and configuration changes. Secrets are redacted before insert.';
