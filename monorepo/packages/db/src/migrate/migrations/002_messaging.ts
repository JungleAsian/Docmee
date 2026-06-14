import type { Migration } from "../runner.js";

/**
 * 002 — Messaging: patients, conversations, messages, error_log.
 *
 * - Encrypted identifiers stored as ciphertext + key_version, with companion HMAC
 *   columns for equality lookups (decision #2). Ciphertext is NEVER used in WHERE.
 * - Opt-out columns on patients (decision #5), enforced at the outbound chokepoint.
 * - Idempotency: (clinic_id, provider_message_id) unique → process-exactly-once
 *   (decision #7).
 * - error_log.clinic_id is nullable for UNROUTED events (unknown phone_number_id),
 *   which are written via the admin path since they have no clinic context.
 */
const sql = /* sql */ `
  CREATE TABLE patients (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id               uuid NOT NULL REFERENCES clinics(id),
    name                    text,
    -- encrypted phone + searchable HMAC
    phone_ciphertext        text,
    phone_key_version       integer,
    phone_hmac              text,
    -- encrypted channel identifier + searchable HMAC
    channel_id_ciphertext   text,
    channel_id_key_version  integer,
    channel_id_hmac         text,
    status                  text NOT NULL DEFAULT 'lead',
    -- opt-out (decision #5)
    opted_out               boolean NOT NULL DEFAULT false,
    opted_out_at            timestamptz,
    opted_out_scope         text NOT NULL DEFAULT 'all',
    created_at              timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE conversations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id           uuid NOT NULL REFERENCES clinics(id),
    patient_id          uuid NOT NULL REFERENCES patients(id),
    channel             text NOT NULL
                          CHECK (channel IN ('whatsapp','messenger','instagram')),
    mode                text NOT NULL DEFAULT 'bot'
                          CHECK (mode IN ('bot','human','paused','resolved')),
    assignee_id         uuid REFERENCES clinic_users(id),
    last_interaction_at timestamptz NOT NULL DEFAULT now(),
    window_expires_at   timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE messages (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id            uuid NOT NULL REFERENCES clinics(id),
    conversation_id      uuid NOT NULL REFERENCES conversations(id),
    direction            text NOT NULL CHECK (direction IN ('inbound','outbound')),
    author               text NOT NULL CHECK (author IN ('patient','bot','staff')),
    -- encrypted message content
    content_ciphertext   text,
    content_key_version  integer,
    -- idempotency key (Meta wamid); unique per clinic when present
    provider_message_id  text,
    created_at           timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE error_log (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    clinic_id  uuid REFERENCES clinics(id),
    type       text NOT NULL,
    detail     jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  -- ── Indexes ─────────────────────────────────────────────────────────────────
  CREATE UNIQUE INDEX patients_clinic_phone_hmac
    ON patients (clinic_id, phone_hmac) WHERE phone_hmac IS NOT NULL;
  CREATE INDEX patients_clinic_channel_hmac
    ON patients (clinic_id, channel_id_hmac) WHERE channel_id_hmac IS NOT NULL;
  CREATE UNIQUE INDEX messages_idempotency
    ON messages (clinic_id, provider_message_id)
    WHERE provider_message_id IS NOT NULL;
  CREATE INDEX messages_conversation
    ON messages (clinic_id, conversation_id, created_at);
  CREATE INDEX conversations_clinic_recent
    ON conversations (clinic_id, last_interaction_at DESC);

  -- ── Row-level security ──────────────────────────────────────────────────────
  ALTER TABLE patients      ENABLE ROW LEVEL SECURITY;
  ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
  ALTER TABLE messages      ENABLE ROW LEVEL SECURITY;
  ALTER TABLE error_log     ENABLE ROW LEVEL SECURITY;
  ALTER TABLE patients      FORCE ROW LEVEL SECURITY;
  ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
  ALTER TABLE messages      FORCE ROW LEVEL SECURITY;
  ALTER TABLE error_log     FORCE ROW LEVEL SECURITY;

  CREATE POLICY clinic_scope ON patients
    USING (clinic_id = current_clinic_id())
    WITH CHECK (clinic_id = current_clinic_id());
  CREATE POLICY clinic_scope ON conversations
    USING (clinic_id = current_clinic_id())
    WITH CHECK (clinic_id = current_clinic_id());
  CREATE POLICY clinic_scope ON messages
    USING (clinic_id = current_clinic_id())
    WITH CHECK (clinic_id = current_clinic_id());
  CREATE POLICY clinic_scope ON error_log
    USING (clinic_id = current_clinic_id())
    WITH CHECK (clinic_id = current_clinic_id());

  GRANT SELECT, INSERT, UPDATE ON patients, conversations, messages, error_log
    TO docmee_app;
`;

const migration: Migration = { version: 2, name: "messaging", sql };
export default migration;
