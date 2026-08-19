import type { Sql } from '../client.js'
import { toJson } from '../client.js'
import type {
  Conversation,
  ConversationStatus,
  ConversationTag,
  InternalNote,
  Channel,
} from '../types/index.js'

export interface CreateConversationInput {
  clinicId: string
  patientId?: string
  channel: Channel
  channelContactHandle: string
  iaProfileId?: string
  metadata?: Record<string, unknown>
}

export interface UpdateConversationInput {
  status?: ConversationStatus
  snoozeUntil?: string | null
  assignedTo?: string | null
  iaProfileId?: string | null
  lastMessageAt?: string
  metadata?: Record<string, unknown>
}

export interface CreateTagInput {
  clinicId: string
  name: string
  color?: string
}

export interface CreateNoteInput {
  conversationId: string
  clinicId: string
  authorId: string
  content: string
}

export interface ConversationsRepository {
  findById(clinicId: string, id: string): Promise<Conversation | null>
  /**
   * The most recent still-active (not resolved/archived) conversation for a contact on a
   * channel, or null. Lets ingest workers thread a new inbound message onto the
   * patient's open thread instead of opening a duplicate.
   */
  findOpenByContact(clinicId: string, channel: Channel, contactHandle: string): Promise<Conversation | null>
  listByClinic(clinicId: string, status?: ConversationStatus): Promise<Conversation[]>
  searchByClinic(
    clinicId: string,
    input: { q?: string; status?: ConversationStatus; assignedTo?: string | null; limit?: number; offset?: number },
  ): Promise<{ rows: Conversation[]; total: number }>
  /** Every conversation for one patient, newest first (patient history view). */
  listByPatient(clinicId: string, patientId: string): Promise<Conversation[]>
  countActive(clinicId: string): Promise<number>
  /**
   * Conversations (across all clinics) in any of the given statuses whose last
   * inbound/outbound message is older than `olderThanMinutes`. Powers the
   * timeout monitor — service-client only (no clinic scoping).
   */
  listStale(statuses: ConversationStatus[], olderThanMinutes: number): Promise<Conversation[]>
  /** CRE-60: snoozed conversations whose snooze_until has passed (auto-wake). */
  listDueSnoozed(): Promise<Conversation[]>
  /**
   * Stall-timer candidates (across all clinics): open conversations carrying a
   * mid-flow cursor (pendingWorkflowRuns or customFlowState in metadata) whose
   * last activity is older than a small global floor. Per-clinic exact
   * thresholds are applied afterward in JS. Service-client only (no clinic
   * scoping), mirrors listStale/listDueSnoozed.
   */
  listMidFlowCandidates(olderThanMinutes: number): Promise<Conversation[]>
  create(data: CreateConversationInput): Promise<Conversation>
  update(clinicId: string, id: string, data: UpdateConversationInput): Promise<Conversation>
  bulkUpdate(clinicId: string, ids: string[], data: UpdateConversationInput): Promise<number>
  /**
   * REAL hard delete — the row is physically removed. Every dependent table
   * (conversation_messages, conversation_tag_links, internal_notes, and
   * transitively message_delivery_events) is cleaned up by existing
   * ON DELETE CASCADE FKs; appointments/ai_usage_events/notification_events/
   * workflow_approvals/workflow_ai_drafts survive with conversation_id set to
   * NULL via existing ON DELETE SET NULL FKs. Callers must capture any
   * metadata they need (status, channel, patientId) BEFORE calling this — the
   * row is gone afterward. Returns false if no row matched.
   */
  delete(clinicId: string, id: string): Promise<boolean>

  listTags(clinicId: string): Promise<ConversationTag[]>
  /** Tags currently linked to one conversation. */
  listTagsForConversation(clinicId: string, conversationId: string): Promise<ConversationTag[]>
  /**
   * Every (conversationId, tag name) pair for a clinic, in one query. Lets the
   * conversation-list endpoint surface safety/urgent flags per row for triage
   * without an N+1 fetch (Req 20 — urgent/emergency must be unmistakable in the
   * list, not only in the open conversation's tag panel).
   */
  listTagNamesByClinic(clinicId: string): Promise<Array<{ conversationId: string; name: string }>>
  /**
   * The single most recent message of every conversation in a clinic, in one query
   * (DISTINCT ON the conversation, newest first). Lets the conversation-list endpoint
   * show a last-message preview per row without an N+1 fetch — `content` is the raw
   * text (the caller renders a placeholder for audio/image content types).
   */
  listLastMessageByClinic(
    clinicId: string,
  ): Promise<Array<{ conversationId: string; content: string; contentType: string; role: string }>>
  /**
   * Every (conversationId, patient full name) pair for a clinic where the thread is
   * linked to a named patient, in one query. Lets the conversation-list endpoint show
   * the patient's real name per row instead of the raw channel handle (a phone
   * number / IGSID) without an N+1 fetch — mirrors the tag-name fan-in. Conversations
   * with no patient or an unnamed patient are simply absent (the caller falls back to
   * the channel handle).
   */
  listPatientNamesByClinic(
    clinicId: string,
  ): Promise<Array<{ conversationId: string; patientName: string }>>
  /** Distinct tags linked to any of a patient's conversations (patient history view). */
  listTagsForPatient(clinicId: string, patientId: string): Promise<ConversationTag[]>
  /** Resolve a clinic tag by its name (case-sensitive), or null. */
  findTagByName(clinicId: string, name: string): Promise<ConversationTag | null>
  createTag(data: CreateTagInput): Promise<ConversationTag>
  addTag(clinicId: string, conversationId: string, tagId: string): Promise<void>
  removeTag(clinicId: string, conversationId: string, tagId: string): Promise<void>

  listNotes(clinicId: string, conversationId: string): Promise<InternalNote[]>
  /** Internal notes across all of a patient's conversations, newest first (patient history view). */
  listNotesForPatient(clinicId: string, patientId: string): Promise<InternalNote[]>
  addNote(data: CreateNoteInput): Promise<InternalNote>
  /** A single note scoped to the clinic, or null. Used to authorize edit/delete. */
  findNoteById(clinicId: string, noteId: string): Promise<InternalNote | null>
  /** Replace a note's content (the updated_at trigger bumps the timestamp). */
  updateNote(clinicId: string, noteId: string, content: string): Promise<InternalNote | null>
  deleteNote(clinicId: string, noteId: string): Promise<void>
}

export function createConversationsRepository(sql: Sql): ConversationsRepository {
  return {
    async findById(clinicId, id) {
      const rows = await sql<Conversation[]>`
        SELECT * FROM conversations WHERE clinic_id = ${clinicId} AND id = ${id} LIMIT 1
      `
      return rows[0] ?? null
    },

    async findOpenByContact(clinicId, channel, contactHandle) {
      const rows = await sql<Conversation[]>`
        SELECT * FROM conversations
        WHERE clinic_id = ${clinicId}
          AND channel = ${channel}
          AND channel_contact_handle = ${contactHandle}
          AND status NOT IN ('resolved', 'archived')
        ORDER BY last_message_at DESC NULLS LAST, created_at DESC
        LIMIT 1
      `
      return rows[0] ?? null
    },

    async listByClinic(clinicId, status) {
      if (status) {
        return sql<Conversation[]>`
          SELECT * FROM conversations
          WHERE clinic_id = ${clinicId} AND status = ${status}
          ORDER BY last_message_at DESC NULLS LAST, created_at DESC
        `
      }
      return sql<Conversation[]>`
        SELECT * FROM conversations
        WHERE clinic_id = ${clinicId}
        ORDER BY last_message_at DESC NULLS LAST, created_at DESC
      `
    },

    async searchByClinic(clinicId, input) {
      const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)
      const offset = Math.max(input.offset ?? 0, 0)
      const q = input.q?.trim() ? `%${input.q.trim()}%` : null
      const rows = await sql<Conversation[]>`
        SELECT c.*
        FROM conversations c
        LEFT JOIN patients p ON p.id = c.patient_id AND p.clinic_id = c.clinic_id
        LEFT JOIN LATERAL (
          SELECT content
          FROM conversation_messages m
          WHERE m.conversation_id = c.id AND m.clinic_id = c.clinic_id
          ORDER BY m.created_at DESC
          LIMIT 1
        ) lm ON TRUE
        WHERE c.clinic_id = ${clinicId}
          AND (${input.status ?? null}::text IS NULL OR c.status = ${input.status ?? null})
          AND (${input.assignedTo ?? null}::uuid IS NULL OR c.assigned_to = ${input.assignedTo ?? null})
          AND (
            ${q}::text IS NULL
            OR c.channel_contact_handle ILIKE ${q}
            OR COALESCE(p.full_name, '') ILIKE ${q}
            OR COALESCE(lm.content, '') ILIKE ${q}
          )
        ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `
      const countRows = await sql<Array<{ count: string }>>`
        SELECT COUNT(DISTINCT c.id) AS count
        FROM conversations c
        LEFT JOIN patients p ON p.id = c.patient_id AND p.clinic_id = c.clinic_id
        LEFT JOIN conversation_messages m ON m.conversation_id = c.id AND m.clinic_id = c.clinic_id
        WHERE c.clinic_id = ${clinicId}
          AND (${input.status ?? null}::text IS NULL OR c.status = ${input.status ?? null})
          AND (${input.assignedTo ?? null}::uuid IS NULL OR c.assigned_to = ${input.assignedTo ?? null})
          AND (
            ${q}::text IS NULL
            OR c.channel_contact_handle ILIKE ${q}
            OR COALESCE(p.full_name, '') ILIKE ${q}
            OR COALESCE(m.content, '') ILIKE ${q}
          )
      `
      return { rows, total: parseInt(countRows[0]?.count ?? '0', 10) }
    },

    async listByPatient(clinicId, patientId) {
      return sql<Conversation[]>`
        SELECT * FROM conversations
        WHERE clinic_id = ${clinicId} AND patient_id = ${patientId}
        ORDER BY last_message_at DESC NULLS LAST, created_at DESC
      `
    },

    async countActive(clinicId) {
      const rows = await sql<[{ count: string }]>`
        SELECT COUNT(*) FROM conversations WHERE clinic_id = ${clinicId} AND status IN ('open', 'assigned')
      `
      return parseInt(rows[0]?.count ?? '0', 10)
    },

    async listStale(statuses, olderThanMinutes) {
      if (statuses.length === 0) return []
      return sql<Conversation[]>`
        SELECT * FROM conversations
        WHERE status = ANY(${statuses})
          AND COALESCE(last_message_at, created_at) < NOW() - ${`${olderThanMinutes} minutes`}::interval
        ORDER BY clinic_id, last_message_at NULLS LAST
      `
    },

    async create(data) {
      const rows = await sql<Conversation[]>`
        INSERT INTO conversations (clinic_id, patient_id, channel, channel_contact_handle, ia_profile_id, metadata)
        VALUES (
          ${data.clinicId},
          ${data.patientId ?? null},
          ${data.channel},
          ${data.channelContactHandle},
          ${data.iaProfileId ?? null},
          ${sql.json(toJson(data.metadata ?? {}))}
        )
        RETURNING *
      `
      return rows[0]!
    },

    async update(clinicId, id, data) {
      const rows = await sql<Conversation[]>`
        UPDATE conversations SET
          status          = COALESCE(${data.status          ?? null}, status),
          assigned_to     = CASE WHEN ${data.assignedTo    !== undefined} THEN ${data.assignedTo    ?? null} ELSE assigned_to     END,
          ia_profile_id   = CASE WHEN ${data.iaProfileId   !== undefined} THEN ${data.iaProfileId   ?? null} ELSE ia_profile_id   END,
          last_message_at = COALESCE(${data.lastMessageAt  ?? null}::timestamptz, last_message_at),
          snooze_until    = CASE WHEN ${data.snoozeUntil    !== undefined} THEN ${data.snoozeUntil    ?? null}::timestamptz ELSE snooze_until END,
          metadata        = CASE WHEN ${data.metadata       !== undefined} THEN ${sql.json(toJson(data.metadata ?? {}))} ELSE metadata END
        WHERE clinic_id = ${clinicId} AND id = ${id}
        RETURNING *
      `
      if (!rows[0]) throw new Error(`Conversation not found: ${id}`)
      return rows[0]
    },

    async listDueSnoozed() {
      return sql<Conversation[]>`
        SELECT * FROM conversations
        WHERE status = 'snoozed' AND snooze_until IS NOT NULL AND snooze_until <= NOW()
        ORDER BY snooze_until
        LIMIT 500
      `
    },

    async listMidFlowCandidates(olderThanMinutes) {
      return sql<Conversation[]>`
        SELECT * FROM conversations
        WHERE status = 'open'
          AND (metadata ? 'pendingWorkflowRuns' OR metadata ? 'customFlowState')
          AND COALESCE(last_message_at, created_at) < NOW() - ${`${olderThanMinutes} minutes`}::interval
        ORDER BY clinic_id, last_message_at NULLS LAST
        LIMIT 500
      `
    },

    async listTags(clinicId) {
      return sql<ConversationTag[]>`
        SELECT * FROM conversation_tags WHERE clinic_id = ${clinicId} ORDER BY name
      `
    },

    async listTagsForConversation(clinicId, conversationId) {
      return sql<ConversationTag[]>`
        SELECT t.* FROM conversation_tags t
        JOIN conversation_tag_links l ON l.tag_id = t.id
        WHERE t.clinic_id = ${clinicId} AND l.conversation_id = ${conversationId}
        ORDER BY t.name
      `
    },

    async listTagNamesByClinic(clinicId) {
      return sql<Array<{ conversationId: string; name: string }>>`
        SELECT l.conversation_id, t.name
        FROM conversation_tag_links l
        JOIN conversation_tags t ON t.id = l.tag_id
        JOIN conversations c ON c.id = l.conversation_id
        WHERE c.clinic_id = ${clinicId}
      `
    },

    async listLastMessageByClinic(clinicId) {
      return sql<Array<{ conversationId: string; content: string; contentType: string; role: string }>>`
        SELECT DISTINCT ON (m.conversation_id)
          m.conversation_id AS "conversationId",
          m.content,
          m.content_type AS "contentType",
          m.role
        FROM conversation_messages m
        WHERE m.clinic_id = ${clinicId}
        ORDER BY m.conversation_id, m.created_at DESC
      `
    },

    async listPatientNamesByClinic(clinicId) {
      return sql<Array<{ conversationId: string; patientName: string }>>`
        SELECT c.id AS "conversationId", p.full_name AS "patientName"
        FROM conversations c
        JOIN patients p ON p.id = c.patient_id
        WHERE c.clinic_id = ${clinicId}
          AND p.full_name IS NOT NULL
          AND p.full_name <> ''
      `
    },

    async listTagsForPatient(clinicId, patientId) {
      return sql<ConversationTag[]>`
        SELECT DISTINCT t.* FROM conversation_tags t
        JOIN conversation_tag_links l ON l.tag_id = t.id
        JOIN conversations c ON c.id = l.conversation_id
        WHERE t.clinic_id = ${clinicId} AND c.patient_id = ${patientId}
        ORDER BY t.name
      `
    },

    async findTagByName(clinicId, name) {
      const rows = await sql<ConversationTag[]>`
        SELECT * FROM conversation_tags WHERE clinic_id = ${clinicId} AND name = ${name} LIMIT 1
      `
      return rows[0] ?? null
    },

    async createTag(data) {
      const rows = await sql<ConversationTag[]>`
        INSERT INTO conversation_tags (clinic_id, name, color)
        VALUES (${data.clinicId}, ${data.name}, ${data.color ?? '#6366f1'})
        ON CONFLICT (clinic_id, name) DO UPDATE SET color = EXCLUDED.color
        RETURNING *
      `
      return rows[0]!
    },

    async bulkUpdate(clinicId, ids, data) {
      if (ids.length === 0) return 0
      const status = data.status ?? null
      const assignedTo = data.assignedTo ?? null
      const iaProfileId = data.iaProfileId ?? null
      const snoozeUntil = data.snoozeUntil ?? null
      const lastMessageAt = data.lastMessageAt ?? null
      const metadata = sql.json(toJson(data.metadata ?? {}))
      const rows = await sql<{ id: string }[]>`
        UPDATE conversations SET
          status          = COALESCE(${status}, status),
          assigned_to     = CASE WHEN ${data.assignedTo !== undefined} THEN ${assignedTo} ELSE assigned_to END,
          ia_profile_id   = CASE WHEN ${data.iaProfileId !== undefined} THEN ${iaProfileId} ELSE ia_profile_id END,
          snooze_until    = CASE WHEN ${data.snoozeUntil !== undefined} THEN ${snoozeUntil} ELSE snooze_until END,
          last_message_at = COALESCE(${lastMessageAt}, last_message_at),
          metadata        = CASE WHEN ${data.metadata !== undefined} THEN ${metadata} ELSE metadata END,
          updated_at      = NOW()
        WHERE clinic_id = ${clinicId} AND id IN ${sql(ids)}
        RETURNING id
      `
      return rows.length
    },

    async delete(clinicId, id) {
      const rows = await sql<{ id: string }[]>`
        DELETE FROM conversations
        WHERE clinic_id = ${clinicId} AND id = ${id}
        RETURNING id
      `
      return rows.length > 0
    },

    async addTag(clinicId, conversationId, tagId) {
      await sql`
        INSERT INTO conversation_tag_links (conversation_id, tag_id)
        SELECT ${conversationId}, ${tagId}
        WHERE EXISTS (
          SELECT 1 FROM conversations c WHERE c.id = ${conversationId} AND c.clinic_id = ${clinicId}
        )
        ON CONFLICT DO NOTHING
      `
    },

    async removeTag(_clinicId, conversationId, tagId) {
      await sql`
        DELETE FROM conversation_tag_links
        WHERE conversation_id = ${conversationId} AND tag_id = ${tagId}
      `
    },

    async listNotes(clinicId, conversationId) {
      return sql<InternalNote[]>`
        SELECT * FROM internal_notes
        WHERE clinic_id = ${clinicId} AND conversation_id = ${conversationId}
        ORDER BY created_at
      `
    },

    async listNotesForPatient(clinicId, patientId) {
      return sql<InternalNote[]>`
        SELECT n.* FROM internal_notes n
        JOIN conversations c ON c.id = n.conversation_id
        WHERE n.clinic_id = ${clinicId} AND c.patient_id = ${patientId}
        ORDER BY n.created_at DESC
      `
    },

    async addNote(data) {
      const rows = await sql<InternalNote[]>`
        INSERT INTO internal_notes (conversation_id, clinic_id, author_id, content)
        VALUES (${data.conversationId}, ${data.clinicId}, ${data.authorId}, ${data.content})
        RETURNING *
      `
      return rows[0]!
    },

    async findNoteById(clinicId, noteId) {
      const rows = await sql<InternalNote[]>`
        SELECT * FROM internal_notes
        WHERE clinic_id = ${clinicId} AND id = ${noteId}
        LIMIT 1
      `
      return rows[0] ?? null
    },

    async updateNote(clinicId, noteId, content) {
      const rows = await sql<InternalNote[]>`
        UPDATE internal_notes
        SET content = ${content}
        WHERE clinic_id = ${clinicId} AND id = ${noteId}
        RETURNING *
      `
      return rows[0] ?? null
    },

    async deleteNote(clinicId, noteId) {
      await sql`
        DELETE FROM internal_notes
        WHERE clinic_id = ${clinicId} AND id = ${noteId}
      `
    },
  }
}
