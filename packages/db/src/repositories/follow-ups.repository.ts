// P18 (Gap #37): Follow-up tracking — records automated review requests so we
// never double-send and can measure click-through.
import type { Sql } from '../client.js'
import { toJson } from '../client.js'
import type { FollowUp, FollowUpStatus } from '../types/index.js'

export interface CreateFollowUpInput {
  clinicId: string
  patientId: string
  appointmentId?: string
  type: string
  status?: FollowUpStatus
  metadata?: Record<string, unknown>
}

export interface FollowUpsRepository {
  listByClinic(clinicId: string): Promise<FollowUp[]>
  findByAppointment(clinicId: string, appointmentId: string, type: string): Promise<FollowUp | null>
  /** Insert a follow-up, ignoring the (appointment, type) duplicate. Returns null if it already existed. */
  createIfAbsent(data: CreateFollowUpInput): Promise<FollowUp | null>
  /**
   * Has a follow-up of this type already been recorded for this conversation within
   * the last `withinHours`? Dedupes the conversation-scoped no_response nudge, which
   * carries its conversation id in metadata (no appointment to key on).
   */
  existsRecentByConversation(clinicId: string, conversationId: string, type: string, withinHours: number): Promise<boolean>
  /**
   * How many PROACTIVE messages were actually sent to this patient within the last
   * `withinHours` (any follow-up type)? Feeds the outbound anti-spam cap (Req 19 Meta
   * Compliance) — only delivered rows count (status sent/clicked, keyed on review_sent_at).
   */
  countSentToPatientSince(clinicId: string, patientId: string, withinHours: number): Promise<number>
  markSent(clinicId: string, id: string): Promise<void>
  /** Stamp the click and flip status → 'clicked'. Returns the row (or null if unknown). */
  markClicked(id: string): Promise<FollowUp | null>
  // ── Rev 2 Approval node ──────────────────────────────────────────────────────
  /** Store/refresh a drafted follow-up awaiting secretary sign-off (status
   *  'pending_approval'); metadata carries { draft, job } for preview + re-enqueue. */
  upsertPendingApproval(data: CreateFollowUpInput): Promise<FollowUp>
  /** Drafted follow-ups awaiting a secretary decision. */
  listPendingApprovals(clinicId: string): Promise<FollowUp[]>
  findById(clinicId: string, id: string): Promise<FollowUp | null>
  /** Atomically claim a pending_approval row for sending (→ 'sent'). Null if already claimed/sent. */
  claimForSend(clinicId: string, id: string): Promise<FollowUp | null>
  /** A secretary declined the draft (pending_approval → 'rejected'; never sent). */
  reject(clinicId: string, id: string): Promise<void>
}

export function createFollowUpsRepository(sql: Sql): FollowUpsRepository {
  return {
    async listByClinic(clinicId) {
      return sql<FollowUp[]>`
        SELECT * FROM follow_ups WHERE clinic_id = ${clinicId} ORDER BY created_at DESC
      `
    },

    async findByAppointment(clinicId, appointmentId, type) {
      const rows = await sql<FollowUp[]>`
        SELECT * FROM follow_ups
        WHERE clinic_id = ${clinicId} AND appointment_id = ${appointmentId} AND type = ${type}
        LIMIT 1
      `
      return rows[0] ?? null
    },

    async createIfAbsent(data) {
      const rows = await sql<FollowUp[]>`
        INSERT INTO follow_ups (clinic_id, patient_id, appointment_id, type, status, metadata)
        VALUES (
          ${data.clinicId},
          ${data.patientId},
          ${data.appointmentId ?? null},
          ${data.type},
          ${data.status ?? 'pending'},
          ${sql.json(toJson(data.metadata ?? {}))}
        )
        ON CONFLICT (appointment_id, type) WHERE appointment_id IS NOT NULL DO NOTHING
        RETURNING *
      `
      return rows[0] ?? null
    },

    async existsRecentByConversation(clinicId, conversationId, type, withinHours) {
      const rows = await sql<[{ exists: boolean }]>`
        SELECT EXISTS (
          SELECT 1 FROM follow_ups
          WHERE clinic_id = ${clinicId}
            AND type = ${type}
            AND metadata->>'conversationId' = ${conversationId}
            AND created_at > NOW() - ${`${withinHours} hours`}::interval
        ) AS exists
      `
      return rows[0]?.exists ?? false
    },

    async countSentToPatientSince(clinicId, patientId, withinHours) {
      const rows = await sql<[{ count: number }]>`
        SELECT COUNT(*)::int AS count FROM follow_ups
        WHERE clinic_id = ${clinicId}
          AND patient_id = ${patientId}
          AND status IN ('sent', 'clicked')
          AND review_sent_at > NOW() - ${`${withinHours} hours`}::interval
      `
      return Number(rows[0]?.count ?? 0)
    },

    async markSent(clinicId, id) {
      await sql`
        UPDATE follow_ups SET status = 'sent', review_sent_at = NOW()
        WHERE clinic_id = ${clinicId} AND id = ${id}
      `
    },

    async markClicked(id) {
      const rows = await sql<FollowUp[]>`
        UPDATE follow_ups
        SET status = 'clicked', review_clicked_at = COALESCE(review_clicked_at, NOW())
        WHERE id = ${id}
        RETURNING *
      `
      return rows[0] ?? null
    },

    async upsertPendingApproval(data) {
      const rows = await sql<FollowUp[]>`
        INSERT INTO follow_ups (clinic_id, patient_id, appointment_id, type, status, metadata)
        VALUES (
          ${data.clinicId},
          ${data.patientId},
          ${data.appointmentId ?? null},
          ${data.type},
          'pending_approval',
          ${sql.json(toJson(data.metadata ?? {}))}
        )
        ON CONFLICT (appointment_id, type) WHERE appointment_id IS NOT NULL
          DO UPDATE SET status = 'pending_approval', metadata = EXCLUDED.metadata, created_at = NOW()
        RETURNING *
      `
      return rows[0]!
    },

    async listPendingApprovals(clinicId) {
      return sql<FollowUp[]>`
        SELECT * FROM follow_ups
        WHERE clinic_id = ${clinicId} AND status = 'pending_approval'
        ORDER BY created_at DESC
      `
    },

    async findById(clinicId, id) {
      const rows = await sql<FollowUp[]>`
        SELECT * FROM follow_ups WHERE clinic_id = ${clinicId} AND id = ${id} LIMIT 1
      `
      return rows[0] ?? null
    },

    async claimForSend(clinicId, id) {
      const rows = await sql<FollowUp[]>`
        UPDATE follow_ups SET status = 'sent', review_sent_at = NOW()
        WHERE clinic_id = ${clinicId} AND id = ${id} AND status = 'pending_approval'
        RETURNING *
      `
      return rows[0] ?? null
    },

    async reject(clinicId, id) {
      await sql`
        UPDATE follow_ups SET status = 'rejected'
        WHERE clinic_id = ${clinicId} AND id = ${id} AND status = 'pending_approval'
      `
    },
  }
}
