import type { Sql } from '../client.js'
import { toJson } from '../client.js'
import type { ConversationMessage, MessageRole, ContentType, DeliveryStatus } from '../types/index.js'

export interface CreateMessageInput {
  conversationId: string
  clinicId: string
  role: MessageRole
  content: string
  contentType?: ContentType
  channelMessageId?: string
  audioUrl?: string
  transcription?: string
  tokenCount?: number
  metadata?: Record<string, unknown>
}

export interface MessagesRepository {
  findById(clinicId: string, id: string): Promise<ConversationMessage | null>
  /**
   * Timestamp of the patient's most recent inbound (`user`) message across all of
   * their conversations, or null. Drives the 24-hour customer-care window check and
   * the no_response self-cancel for follow-up automation (Rev1 #14).
   */
  findLastInboundAt(clinicId: string, patientId: string): Promise<string | null>
  listByConversation(clinicId: string, conversationId: string): Promise<ConversationMessage[]>
  listByConversationSince(clinicId: string, conversationId: string, since: string): Promise<ConversationMessage[]>
  create(data: CreateMessageInput): Promise<ConversationMessage>
  markDelivered(clinicId: string, id: string, channelMessageId: string): Promise<void>
  /**
   * Record a delivery-lifecycle event (Req 3) for the outbound message whose
   * channel_message_id (the WhatsApp wamid) matches `channelMessageId`. Meta posts
   * these via the `statuses` webhook (sent → delivered → read, or failed). Returns
   * true when a matching message was found and the event recorded, false when no
   * outbound message carries that wamid (e.g. a status for a message we never
   * persisted) so the caller can decide whether to log it.
   */
  recordDeliveryStatus(
    clinicId: string,
    channelMessageId: string,
    status: DeliveryStatus,
    error?: string | null,
  ): Promise<boolean>
  /**
   * Record a `read` event for every outbound (assistant/agent) message in a
   * conversation sent at or before `watermarkMs` (epoch ms) that carries a
   * channel_message_id and is not already marked read. Messenger reports reads as a
   * watermark rather than per-message ids (Req 33), so this marks the whole prefix
   * of the thread read in one pass. Returns the number of messages newly marked.
   */
  recordReadReceipt(clinicId: string, conversationId: string, watermarkMs: number): Promise<number>
}

export function createMessagesRepository(sql: Sql): MessagesRepository {
  return {
    async findById(clinicId, id) {
      const rows = await sql<ConversationMessage[]>`
        SELECT * FROM conversation_messages WHERE clinic_id = ${clinicId} AND id = ${id} LIMIT 1
      `
      return rows[0] ?? null
    },

    async findLastInboundAt(clinicId, patientId) {
      const rows = await sql<[{ last: string | null }]>`
        SELECT MAX(m.created_at) AS last
        FROM conversation_messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.clinic_id = ${clinicId}
          AND c.patient_id = ${patientId}
          AND m.role = 'user'
      `
      return rows[0]?.last ?? null
    },

    async listByConversation(clinicId, conversationId) {
      // Attach the latest delivery-lifecycle state per message (Req 3) so the inbox
      // can show a sent/delivered/read/failed indicator on outbound bubbles. The
      // LATERAL picks the newest message_delivery_events row; messages with no
      // receipt (inbound, Messenger/Instagram, pre-feature sends) get null.
      return sql<ConversationMessage[]>`
        SELECT m.*, d.status AS delivery_status
        FROM conversation_messages m
        LEFT JOIN LATERAL (
          SELECT status
          FROM message_delivery_events e
          WHERE e.message_id = m.id
          ORDER BY e.created_at DESC
          LIMIT 1
        ) d ON TRUE
        WHERE m.clinic_id = ${clinicId} AND m.conversation_id = ${conversationId}
        ORDER BY m.created_at
      `
    },

    async listByConversationSince(clinicId, conversationId, since) {
      return sql<ConversationMessage[]>`
        SELECT * FROM conversation_messages
        WHERE clinic_id = ${clinicId}
          AND conversation_id = ${conversationId}
          AND created_at > ${since}::timestamptz
        ORDER BY created_at
      `
    },

    async create(data) {
      const rows = await sql<ConversationMessage[]>`
        INSERT INTO conversation_messages
          (conversation_id, clinic_id, role, content, content_type,
           channel_message_id, audio_url, transcription, token_count, metadata)
        VALUES (
          ${data.conversationId},
          ${data.clinicId},
          ${data.role},
          ${data.content},
          ${data.contentType ?? 'text'},
          ${data.channelMessageId ?? null},
          ${data.audioUrl        ?? null},
          ${data.transcription   ?? null},
          ${data.tokenCount      ?? null},
          ${sql.json(toJson(data.metadata ?? {}))}
        )
        ON CONFLICT (clinic_id, channel_message_id) WHERE channel_message_id IS NOT NULL
        DO NOTHING
        RETURNING *
      `
      // CRE-53: idempotent inbound. A redelivered channel message hits the partial
      // unique index and inserts nothing — return the existing row and skip the
      // last_message_at bump so a webhook retry can't duplicate or reorder the thread.
      if (rows.length === 0 && data.channelMessageId != null) {
        const existing = await sql<ConversationMessage[]>`
          SELECT * FROM conversation_messages
          WHERE clinic_id = ${data.clinicId} AND channel_message_id = ${data.channelMessageId}
          ORDER BY created_at DESC
          LIMIT 1
        `
        return existing[0]!
      }
      const msg = rows[0]!

      // Bump conversation.last_message_at
      await sql`
        UPDATE conversations SET last_message_at = ${msg.createdAt}::timestamptz
        WHERE id = ${data.conversationId} AND clinic_id = ${data.clinicId}
      `

      return msg
    },

    async markDelivered(clinicId, id, channelMessageId) {
      await sql`
        UPDATE conversation_messages
        SET channel_message_id = ${channelMessageId}
        WHERE clinic_id = ${clinicId} AND id = ${id}
      `
      await sql`
        INSERT INTO message_delivery_events (message_id, clinic_id, channel_message_id, status)
        VALUES (${id}, ${clinicId}, ${channelMessageId}, 'sent')
      `
    },

    async recordDeliveryStatus(clinicId, channelMessageId, status, error) {
      const rows = await sql<{ id: string }[]>`
        SELECT id FROM conversation_messages
        WHERE clinic_id = ${clinicId} AND channel_message_id = ${channelMessageId}
        ORDER BY created_at DESC
        LIMIT 1
      `
      const message = rows[0]
      if (!message) return false

      await sql`
        INSERT INTO message_delivery_events (message_id, clinic_id, channel_message_id, status, error)
        VALUES (${message.id}, ${clinicId}, ${channelMessageId}, ${status}, ${error ?? null})
      `
      return true
    },

    async recordReadReceipt(clinicId, conversationId, watermarkMs) {
      // Insert a 'read' event for each outbound message in the thread up to the
      // watermark that isn't already read. Idempotent: re-delivered watermarks
      // (Meta retries) add no duplicate rows.
      const rows = await sql<{ id: string }[]>`
        INSERT INTO message_delivery_events (message_id, clinic_id, channel_message_id, status)
        SELECT m.id, m.clinic_id, m.channel_message_id, 'read'
        FROM conversation_messages m
        WHERE m.clinic_id = ${clinicId}
          AND m.conversation_id = ${conversationId}
          AND m.role IN ('assistant', 'agent')
          AND m.channel_message_id IS NOT NULL
          AND m.created_at <= to_timestamp(${watermarkMs} / 1000.0)
          AND NOT EXISTS (
            SELECT 1 FROM message_delivery_events e
            WHERE e.message_id = m.id AND e.status = 'read'
          )
        RETURNING id
      `
      return rows.length
    },
  }
}
