-- P02: Operations and observability tables

CREATE TABLE IF NOT EXISTS notification_events (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         UUID        REFERENCES clinics(id) ON DELETE CASCADE,
  notification_type TEXT        NOT NULL,
  recipient         TEXT        NOT NULL,
  subject           TEXT,
  content           TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'pending',
  sent_at           TIMESTAMPTZ,
  error             TEXT,
  metadata          JSONB       NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT notif_type_check   CHECK (notification_type IN ('email', 'sms', 'push', 'in_app')),
  CONSTRAINT notif_status_check CHECK (status            IN ('pending', 'sent', 'failed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS idx_notif_events_clinic ON notification_events(clinic_id);
CREATE INDEX IF NOT EXISTS idx_notif_events_status ON notification_events(status, created_at);

CREATE TABLE IF NOT EXISTS error_reviews (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID        REFERENCES clinics(id) ON DELETE SET NULL,
  error_type    TEXT        NOT NULL,
  error_message TEXT        NOT NULL,
  stack_trace   TEXT,
  context       JSONB       NOT NULL DEFAULT '{}',
  status        TEXT        NOT NULL DEFAULT 'open',
  reviewed_by   UUID,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT error_reviews_status_check CHECK (status IN ('open', 'reviewed', 'resolved', 'ignored'))
);

CREATE INDEX IF NOT EXISTS idx_error_reviews_clinic ON error_reviews(clinic_id);
CREATE INDEX IF NOT EXISTS idx_error_reviews_status ON error_reviews(status, created_at DESC);
SELECT add_updated_at_trigger('error_reviews');

CREATE TABLE IF NOT EXISTS feature_flags (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT        NOT NULL,
  description         TEXT,
  enabled             BOOLEAN     NOT NULL DEFAULT FALSE,
  clinic_id           UUID        REFERENCES clinics(id) ON DELETE CASCADE,
  rollout_percentage  INTEGER     NOT NULL DEFAULT 0,
  metadata            JSONB       NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT feature_flags_rollout_check CHECK (rollout_percentage BETWEEN 0 AND 100),
  UNIQUE (name, clinic_id)
);

SELECT add_updated_at_trigger('feature_flags');

CREATE TABLE IF NOT EXISTS dev_seed_runs (
  id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name     TEXT        NOT NULL,
  ran_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status   TEXT        NOT NULL DEFAULT 'success',
  metadata JSONB       NOT NULL DEFAULT '{}',
  CONSTRAINT dev_seed_status_check CHECK (status IN ('success', 'failed', 'partial'))
);
