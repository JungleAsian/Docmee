-- P02: Channels and webhook infrastructure

CREATE TABLE IF NOT EXISTS channel_accounts (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id            UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  channel              TEXT        NOT NULL,
  account_id           TEXT        NOT NULL,
  display_name         TEXT,
  access_token_enc     TEXT,
  webhook_verify_token TEXT,
  status               TEXT        NOT NULL DEFAULT 'active',
  settings             JSONB       NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT channel_accounts_channel_check CHECK (channel IN ('whatsapp', 'messenger', 'instagram')),
  CONSTRAINT channel_accounts_status_check  CHECK (status  IN ('active', 'inactive', 'error')),
  UNIQUE (clinic_id, channel, account_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_accounts_clinic ON channel_accounts(clinic_id);
SELECT add_updated_at_trigger('channel_accounts');

CREATE TABLE IF NOT EXISTS webhook_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID        REFERENCES clinics(id) ON DELETE SET NULL,
  channel      TEXT        NOT NULL,
  event_type   TEXT        NOT NULL,
  payload      JSONB       NOT NULL,
  processed    BOOLEAN     NOT NULL DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_clinic     ON webhook_events(clinic_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed  ON webhook_events(processed, created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON webhook_events(created_at DESC);

CREATE TABLE IF NOT EXISTS message_delivery_events (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id         UUID        NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
  clinic_id          UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  channel_message_id TEXT,
  status             TEXT        NOT NULL,
  error              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT delivery_status_check CHECK (status IN ('sent', 'delivered', 'read', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_delivery_events_message ON message_delivery_events(message_id);
CREATE INDEX IF NOT EXISTS idx_delivery_events_clinic  ON message_delivery_events(clinic_id);
