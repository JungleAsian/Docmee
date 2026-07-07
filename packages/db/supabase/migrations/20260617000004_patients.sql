-- P02: Patients and conversations

CREATE TABLE IF NOT EXISTS patients (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  full_name  TEXT,
  status     TEXT        NOT NULL DEFAULT 'new',
  notes      TEXT,
  metadata   JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT patients_status_check CHECK (status IN ('new', 'returning', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_patients_clinic ON patients(clinic_id);
SELECT add_updated_at_trigger('patients');

CREATE TABLE IF NOT EXISTS patient_contacts (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id     UUID        NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  clinic_id      UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  channel        TEXT        NOT NULL,
  contact_handle TEXT        NOT NULL,
  is_primary     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT patient_contacts_channel_check CHECK (channel IN ('whatsapp', 'messenger', 'instagram')),
  UNIQUE (clinic_id, channel, contact_handle)
);

CREATE INDEX IF NOT EXISTS idx_patient_contacts_patient ON patient_contacts(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_contacts_lookup  ON patient_contacts(clinic_id, channel, contact_handle);
SELECT add_updated_at_trigger('patient_contacts');

CREATE TABLE IF NOT EXISTS conversations (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id            UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id           UUID        REFERENCES patients(id) ON DELETE SET NULL,
  channel              TEXT        NOT NULL,
  channel_contact_handle TEXT      NOT NULL,
  status               TEXT        NOT NULL DEFAULT 'open',
  assigned_to          UUID        REFERENCES clinic_users(id) ON DELETE SET NULL,
  ia_profile_id        UUID,
  last_message_at      TIMESTAMPTZ,
  metadata             JSONB       NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT conversations_channel_check CHECK (channel IN ('whatsapp', 'messenger', 'instagram')),
  CONSTRAINT conversations_status_check  CHECK (status  IN ('open', 'assigned', 'resolved', 'handoff'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_clinic        ON conversations(clinic_id);
CREATE INDEX IF NOT EXISTS idx_conversations_patient       ON conversations(patient_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status        ON conversations(clinic_id, status);
CREATE INDEX IF NOT EXISTS idx_conversations_last_msg      ON conversations(last_message_at DESC);
SELECT add_updated_at_trigger('conversations');

CREATE TABLE IF NOT EXISTS conversation_messages (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id    UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  clinic_id          UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  role               TEXT        NOT NULL,
  content            TEXT        NOT NULL,
  content_type       TEXT        NOT NULL DEFAULT 'text',
  channel_message_id TEXT,
  audio_url          TEXT,
  transcription      TEXT,
  token_count        INTEGER,
  metadata           JSONB       NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT messages_role_check         CHECK (role         IN ('user', 'assistant', 'system', 'agent')),
  CONSTRAINT messages_content_type_check CHECK (content_type IN ('text', 'audio', 'image', 'template', 'interactive'))
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_clinic       ON conversation_messages(clinic_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at   ON conversation_messages(created_at);

CREATE TABLE IF NOT EXISTS conversation_tags (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  color      TEXT        NOT NULL DEFAULT '#6366f1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, name)
);

SELECT add_updated_at_trigger('conversation_tags');

CREATE TABLE IF NOT EXISTS conversation_tag_links (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tag_id          UUID        NOT NULL REFERENCES conversation_tags(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (conversation_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_tag_links_conversation ON conversation_tag_links(conversation_id);
CREATE INDEX IF NOT EXISTS idx_tag_links_tag          ON conversation_tag_links(tag_id);

CREATE TABLE IF NOT EXISTS internal_notes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  clinic_id       UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  author_id       UUID        NOT NULL,
  content         TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_internal_notes_conversation ON internal_notes(conversation_id);
SELECT add_updated_at_trigger('internal_notes');
