import type { Sql } from '../client.js'
import { toJson } from '../client.js'
import type { NotificationEvent, NotificationStatus, NotificationType } from '../types/index.js'

export interface CreateNotificationInput {
  clinicId?: string | null
  /** Delivery channel. Defaults to 'email' (the only channel wired in P07). */
  notificationType?: NotificationType
  /** Secretary alert taxonomy value (emergency, booking_confirmed, …). */
  alertType: string
  priority?: string
  recipient: string
  subject?: string | null
  content: string
  conversationId?: string | null
  status?: NotificationStatus
  metadata?: Record<string, unknown>
  idempotencyKey?: string | null
}

export interface NotificationsRepository {
  /** Persist a notification (defaults to status 'pending'). */
  create(data: CreateNotificationInput): Promise<NotificationEvent>
  createOnce(data: CreateNotificationInput & { idempotencyKey: string }): Promise<{
    event: NotificationEvent
    created: boolean
  }>
  claimOnce(data: CreateNotificationInput & { idempotencyKey: string; claimOwner?: string | null }): Promise<{
    event: NotificationEvent
    claimed: boolean
  }>
  /** Most recent notifications for a clinic, newest first. */
  listByClinic(clinicId: string, limit?: number): Promise<NotificationEvent[]>
  /** Most recent platform-wide notifications, newest first. Superuser-only at route level. */
  listAll(limit?: number): Promise<NotificationEvent[]>
  /** Mark a notification acknowledged. Returns null if not found or out of scope. */
  acknowledge(id: string, clinicId?: string): Promise<NotificationEvent | null>
  /** Update delivery status (e.g. pending → sent / failed). */
  updateStatus(id: string, status: NotificationStatus, error?: string | null): Promise<void>
  /**
   * True if a notification of the given alert type already exists for this
   * conversation within the last `withinMinutes` minutes. Used by the timeout
   * monitor to avoid re-alerting on every tick.
   */
  existsRecent(
    clinicId: string,
    conversationId: string,
    alertType: string,
    withinMinutes: number,
  ): Promise<boolean>
  /**
   * Urgent (p1) conversation-scoped alerts that are still un-acknowledged after
   * `olderThanMinutes`, scanned only within the last `withinHours` (so ancient
   * alerts are not re-escalated forever). Already-escalated rows are excluded.
   * Used by the timeout monitor's escalation pass (Rev1 #18).
   */
  listEscalatable(olderThanMinutes: number, withinHours: number): Promise<NotificationEvent[]>
}

export function createNotificationsRepository(sql: Sql): NotificationsRepository {
  return {
    async create(data) {
      const rows = await sql<NotificationEvent[]>`
        INSERT INTO notification_events
          (clinic_id, notification_type, alert_type, priority, recipient, subject, content, conversation_id, status, metadata)
        VALUES (
          ${data.clinicId ?? null},
          ${data.notificationType ?? 'email'},
          ${data.alertType},
          ${data.priority ?? null},
          ${data.recipient},
          ${data.subject ?? null},
          ${data.content},
          ${data.conversationId ?? null},
          ${data.status ?? 'pending'},
          ${sql.json(toJson(data.metadata ?? {}))}
        )
        RETURNING *
      `
      return rows[0]!
    },

    async createOnce(data) {
      const rows = await sql<NotificationEvent[]>`
        INSERT INTO notification_events
          (clinic_id, notification_type, alert_type, priority, recipient, subject, content,
           conversation_id, status, metadata, idempotency_key)
        VALUES (
          ${data.clinicId ?? null},
          ${data.notificationType ?? 'email'},
          ${data.alertType},
          ${data.priority ?? null},
          ${data.recipient},
          ${data.subject ?? null},
          ${data.content},
          ${data.conversationId ?? null},
          ${data.status ?? 'pending'},
          ${sql.json(toJson(data.metadata ?? {}))},
          ${data.idempotencyKey}
        )
        ON CONFLICT (clinic_id, idempotency_key)
          WHERE clinic_id IS NOT NULL AND idempotency_key IS NOT NULL
        DO NOTHING
        RETURNING *
      `
      if (rows[0]) return { event: rows[0], created: true }
      const existing = await sql<NotificationEvent[]>`
        SELECT * FROM notification_events
        WHERE clinic_id = ${data.clinicId ?? null}
          AND idempotency_key = ${data.idempotencyKey}
        LIMIT 1
      `
      return { event: existing[0]!, created: false }
    },

    async claimOnce(data) {
      const rows = await sql<NotificationEvent[]>`
        INSERT INTO notification_events
          (clinic_id, notification_type, alert_type, priority, recipient, subject, content,
           conversation_id, status, metadata, idempotency_key, delivery_claimed_at,
           delivery_claim_owner, delivery_attempts)
        VALUES (
          ${data.clinicId ?? null},
          ${data.notificationType ?? 'email'},
          ${data.alertType},
          ${data.priority ?? null},
          ${data.recipient},
          ${data.subject ?? null},
          ${data.content},
          ${data.conversationId ?? null},
          'pending',
          ${sql.json(toJson(data.metadata ?? {}))},
          ${data.idempotencyKey},
          NOW(),
          ${data.claimOwner ?? null},
          1
        )
        ON CONFLICT (clinic_id, idempotency_key)
          WHERE clinic_id IS NOT NULL AND idempotency_key IS NOT NULL
        DO UPDATE SET
          delivery_claimed_at = NOW(),
          delivery_claim_owner = EXCLUDED.delivery_claim_owner,
          delivery_attempts = notification_events.delivery_attempts + 1,
          status = 'pending',
          error = NULL
        WHERE (
             EXCLUDED.delivery_claim_owner IS NOT NULL
             AND notification_events.delivery_claim_owner = EXCLUDED.delivery_claim_owner
           )
           OR notification_events.status = 'failed'
           OR (
             notification_events.status = 'pending'
             AND (
               notification_events.delivery_claimed_at IS NULL
               OR notification_events.delivery_claimed_at < NOW() - INTERVAL '5 minutes'
             )
           )
        RETURNING *
      `
      if (rows[0]) return { event: rows[0], claimed: true }
      const existing = await sql<NotificationEvent[]>`
        SELECT * FROM notification_events
        WHERE clinic_id = ${data.clinicId ?? null}
          AND idempotency_key = ${data.idempotencyKey}
        LIMIT 1
      `
      return { event: existing[0]!, claimed: false }
    },

    async listByClinic(clinicId, limit = 50) {
      return sql<NotificationEvent[]>`
        SELECT * FROM notification_events
        WHERE clinic_id = ${clinicId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
    },

    async listAll(limit = 50) {
      return sql<NotificationEvent[]>`
        SELECT * FROM notification_events
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
    },

    async acknowledge(id, clinicId) {
      if (clinicId) {
        const rows = await sql<NotificationEvent[]>`
          UPDATE notification_events
          SET status = 'acknowledged', acknowledged_at = NOW()
          WHERE id = ${id}
            AND clinic_id = ${clinicId}
          RETURNING *
        `
        return rows[0] ?? null
      }
      const rows = await sql<NotificationEvent[]>`
        UPDATE notification_events
        SET status = 'acknowledged', acknowledged_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `
      return rows[0] ?? null
    },

    async updateStatus(id, status, error) {
      await sql`
        UPDATE notification_events
        SET status  = ${status},
            sent_at = CASE WHEN ${status} = 'sent' THEN NOW() ELSE sent_at END,
            error   = ${error ?? null},
            delivery_claimed_at = NULL,
            delivery_claim_owner = NULL
        WHERE id = ${id}
      `
    },

    async existsRecent(clinicId, conversationId, alertType, withinMinutes) {
      const rows = await sql<[{ exists: boolean }]>`
        SELECT EXISTS (
          SELECT 1 FROM notification_events
          WHERE clinic_id       = ${clinicId}
            AND conversation_id = ${conversationId}
            AND alert_type      = ${alertType}
            AND (
              status IN ('sent', 'acknowledged', 'skipped')
              OR (
                status = 'pending'
                AND delivery_claimed_at > NOW() - INTERVAL '5 minutes'
              )
            )
            AND created_at      > NOW() - ${`${withinMinutes} minutes`}::interval
        ) AS exists
      `
      return rows[0]?.exists ?? false
    },

    async listEscalatable(olderThanMinutes, withinHours) {
      return sql<NotificationEvent[]>`
        SELECT * FROM notification_events
        WHERE priority        = 'p1'
          AND conversation_id IS NOT NULL
          AND status         NOT IN ('acknowledged', 'skipped')
          AND alert_type     <> 'secretary_escalated'
          AND created_at      < NOW() - ${`${olderThanMinutes} minutes`}::interval
          AND created_at      > NOW() - ${`${withinHours} hours`}::interval
        ORDER BY created_at
      `
    },
  }
}
