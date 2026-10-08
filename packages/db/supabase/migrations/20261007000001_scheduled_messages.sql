-- Staff-authored delayed messages. DB is authoritative; queue payloads carry IDs only.
ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS components JSONB;
CREATE TABLE scheduled_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  author_id UUID NOT NULL,
  account_id UUID NOT NULL,
  provider_account_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('text','template')),
  content TEXT,
  template_id UUID,
  scheduled_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','cancelled','blocked','failed','delivery_unknown')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  reason_code TEXT,
  attempt_started_at TIMESTAMPTZ,
  provider_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, conversation_id, author_id, idempotency_key),
  CHECK ((kind = 'text' AND content IS NOT NULL AND template_id IS NULL) OR (kind = 'template' AND template_id IS NOT NULL))
);
CREATE INDEX scheduled_messages_due ON scheduled_messages(scheduled_at) WHERE status = 'pending';
CREATE INDEX scheduled_messages_conversation ON scheduled_messages(clinic_id, conversation_id, created_at DESC);
ALTER TABLE scheduled_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY scheduled_messages_clinic ON scheduled_messages
  USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
  WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid);
