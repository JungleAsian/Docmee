import type { Sql } from '../client.js'
import { toJson } from '../client.js'

export type ScheduledStatus = 'pending' | 'sending' | 'sent' | 'cancelled' | 'blocked' | 'failed' | 'delivery_unknown'
export interface ScheduledMessage {
  id: string; clinicId: string; conversationId: string; patientId: string; authorId: string
  accountId: string; providerAccountId: string; recipient: string
  kind: 'text' | 'template'; content: string | null; templateId: string | null
  scheduledAt: string; timezone: string; status: ScheduledStatus; version: number
  reasonCode: string | null; createdAt: string; idempotencyKey: string; requestFingerprint: string
}
export interface ScheduledMessageInput {
  kind: 'text' | 'template'; content?: string; templateId?: string; scheduledAt: string; timezone: string
}
export interface CreateScheduledMessageInput extends ScheduledMessageInput {
  clinicId: string; conversationId: string; patientId: string; authorId: string
  accountId: string; providerAccountId: string; recipient: string; idempotencyKey: string; requestFingerprint: string
}

export function createScheduledMessagesRepository(sql: Sql) {
  return {
    async list(clinicId: string, conversationId: string) {
      // Never hide a pending send or unresolved delivery behind the history bound.
      return sql<ScheduledMessage[]>`SELECT * FROM (
        SELECT * FROM scheduled_messages WHERE clinic_id = ${clinicId} AND conversation_id = ${conversationId} AND status IN ('pending', 'sending', 'delivery_unknown')
        UNION ALL
        (SELECT * FROM scheduled_messages WHERE clinic_id = ${clinicId} AND conversation_id = ${conversationId} AND status NOT IN ('pending', 'sending', 'delivery_unknown') ORDER BY created_at DESC LIMIT 100)
      ) visible ORDER BY created_at DESC`
    },
    async find(clinicId: string, conversationId: string, id: string) {
      const rows = await sql<ScheduledMessage[]>`SELECT * FROM scheduled_messages WHERE clinic_id = ${clinicId} AND conversation_id = ${conversationId} AND id = ${id}`
      return rows[0] ?? null
    },
    async findByIdempotencyKey(clinicId: string, conversationId: string, authorId: string, key: string) {
      const rows = await sql<ScheduledMessage[]>`SELECT * FROM scheduled_messages WHERE clinic_id = ${clinicId} AND conversation_id = ${conversationId} AND author_id = ${authorId} AND idempotency_key = ${key}`
      return rows[0] ?? null
    },
    async create(d: CreateScheduledMessageInput) {
      const rows = await sql<ScheduledMessage[]>`
        INSERT INTO scheduled_messages (clinic_id, conversation_id, patient_id, author_id, account_id, provider_account_id, recipient, kind, content, template_id, scheduled_at, timezone, idempotency_key, request_fingerprint)
        VALUES (${d.clinicId}, ${d.conversationId}, ${d.patientId}, ${d.authorId}, ${d.accountId}, ${d.providerAccountId}, ${d.recipient}, ${d.kind}, ${d.content ?? null}, ${d.templateId ?? null}, ${d.scheduledAt}, ${d.timezone}, ${d.idempotencyKey}, ${d.requestFingerprint})
        ON CONFLICT (clinic_id, conversation_id, author_id, idempotency_key) DO UPDATE SET idempotency_key = scheduled_messages.idempotency_key RETURNING *`
      return rows[0]!
    },
    async edit(clinicId: string, conversationId: string, id: string, version: number, d: ScheduledMessageInput) {
      const rows = await sql<ScheduledMessage[]>`UPDATE scheduled_messages SET kind = ${d.kind}, content = ${d.content ?? null}, template_id = ${d.templateId ?? null}, scheduled_at = ${d.scheduledAt}, timezone = ${d.timezone}, version = version + 1, updated_at = NOW()
        WHERE clinic_id = ${clinicId} AND conversation_id = ${conversationId} AND id = ${id} AND version = ${version} AND status = 'pending' RETURNING *`
      return rows[0] ?? null
    },
    async cancel(clinicId: string, conversationId: string, id: string, version: number) {
      const rows = await sql<ScheduledMessage[]>`UPDATE scheduled_messages SET status = 'cancelled', version = version + 1, updated_at = NOW()
        WHERE clinic_id = ${clinicId} AND conversation_id = ${conversationId} AND id = ${id} AND version = ${version} AND status = 'pending' RETURNING *`
      return rows[0] ?? null
    },
    async claim(clinicId: string, id: string, version: number) {
      const rows = await sql<ScheduledMessage[]>`UPDATE scheduled_messages SET status = 'sending', attempt_started_at = NOW(), updated_at = NOW()
        WHERE clinic_id = ${clinicId} AND id = ${id} AND version = ${version} AND status = 'pending' AND scheduled_at <= NOW() RETURNING *`
      return rows[0] ?? null
    },
    async lastInboundAt(clinicId: string, patientId: string, recipient: string, providerAccountId: string) {
      const rows = await sql<{ last: string | null }[]>`SELECT MAX(m.created_at) AS last FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE m.clinic_id = ${clinicId} AND c.clinic_id = ${clinicId} AND c.patient_id = ${patientId} AND c.channel = 'whatsapp' AND c.channel_contact_handle = ${recipient}
          AND m.role = 'user' AND m.metadata->>'phoneNumberId' = ${providerAccountId}`
      return rows[0]?.last ?? null
    },
    async outcome(message: ScheduledMessage, status: ScheduledStatus, reasonCode: string | null) {
      // The update and audit are one statement; stale/replayed claim holders cannot change terminal rows.
      await sql`WITH changed AS (UPDATE scheduled_messages SET status = ${status}, reason_code = ${reasonCode}, updated_at = NOW()
        WHERE clinic_id = ${message.clinicId} AND id = ${message.id} AND version = ${message.version} AND status = 'sending' RETURNING *)
        INSERT INTO audit_events (clinic_id, actor_id, action, resource_type, resource_id, metadata)
        SELECT clinic_id, author_id, 'scheduled_message.' || status, 'scheduled_message', id, jsonb_build_object('reasonCode', reason_code, 'version', version) FROM changed`
    },
    async confirmed(message: ScheduledMessage, providerMessageId: string, content: string) {
      // One transaction/statement: persist provider acceptance and timeline, then merge CURRENT metadata.
      // CASE uses current locked status: a thread closed while the provider call ran stays closed.
      // A slow, single in-flight send can produce a known ID after stale reconciliation;
      // that explicit confirmation can resolve stale uncertainty, never cause another send.
      await sql`WITH accepted AS (
        UPDATE scheduled_messages SET status = 'sent', provider_message_id = ${providerMessageId}, reason_code = NULL, updated_at = NOW()
        WHERE clinic_id = ${message.clinicId} AND id = ${message.id} AND version = ${message.version}
          AND (status = 'sending' OR (status = 'delivery_unknown' AND reason_code = 'stale_attempt')) RETURNING *
      ), timeline AS (
        INSERT INTO conversation_messages (conversation_id, clinic_id, role, content, content_type, channel_message_id, metadata)
        SELECT conversation_id, clinic_id, 'agent', ${content}, kind, ${providerMessageId}, ${sql.json(toJson({ authorId: message.authorId, scheduledMessageId: message.id, templateId: message.templateId }))} FROM accepted RETURNING id, conversation_id, created_at
      ), paused AS (
        UPDATE conversations c SET status = CASE WHEN c.status = 'open' THEN 'handoff' ELSE c.status END,
          metadata = CASE WHEN c.status = 'open' THEN COALESCE(c.metadata, '{}'::jsonb) || jsonb_build_object('botPausedAt', NOW(), 'handoffReason', 'human_reply') ELSE c.metadata END,
          last_message_at = GREATEST(c.last_message_at, t.created_at), updated_at = NOW()
        FROM accepted a JOIN timeline t ON t.conversation_id = a.conversation_id
        WHERE c.clinic_id = a.clinic_id AND c.id = a.conversation_id RETURNING c.id
      ) INSERT INTO audit_events (clinic_id, actor_id, action, resource_type, resource_id, metadata)
        SELECT clinic_id, author_id, 'scheduled_message.sent', 'scheduled_message', id, jsonb_build_object('version', version) FROM accepted`
    },
    async reconcile() {
      await sql`WITH stale AS (UPDATE scheduled_messages SET status = 'delivery_unknown', reason_code = 'stale_attempt', updated_at = NOW()
        WHERE status = 'sending' AND attempt_started_at < NOW() - INTERVAL '5 minutes' RETURNING *)
        INSERT INTO audit_events (clinic_id, actor_id, action, resource_type, resource_id, metadata)
        SELECT clinic_id, author_id, 'scheduled_message.delivery_unknown', 'scheduled_message', id, jsonb_build_object('reasonCode', reason_code) FROM stale`
      return sql<ScheduledMessage[]>`SELECT * FROM scheduled_messages WHERE status = 'pending' AND scheduled_at <= NOW() ORDER BY scheduled_at LIMIT 100`
    },
  }
}
export type ScheduledMessagesRepository = ReturnType<typeof createScheduledMessagesRepository>
