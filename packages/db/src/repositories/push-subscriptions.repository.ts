// Req 39 — Web Push subscriptions for the installed InboxOS PWA. Stores one row
// per device a secretary has enabled; the notification worker fans an alert out
// to every device a recipient owns. Pure CRUD on push_subscriptions.
import type { Sql } from '../client.js'
import type { PushSubscriptionRow } from '../types/index.js'

export interface UpsertPushSubscriptionInput {
  clinicId: string
  userId: string
  userEmail: string
  endpoint: string
  p256dh: string
  auth: string
}

export interface PushSubscriptionsRepository {
  /**
   * Insert or refresh a device subscription. Keyed by the (unique) endpoint, so a
   * device re-subscribing updates its keys/owner rather than duplicating.
   */
  upsert(input: UpsertPushSubscriptionInput): Promise<PushSubscriptionRow>
  /** Every device a recipient has enabled, for the notification worker fan-out. */
  listByRecipient(clinicId: string, userEmail: string): Promise<PushSubscriptionRow[]>
  /**
   * Remove a device by endpoint, scoped to its owner so a user can only delete
   * their own subscription. Returns false when nothing matched.
   */
  deleteByEndpoint(userId: string, endpoint: string): Promise<boolean>
  /**
   * Remove a dead endpoint regardless of owner — used by the worker when the push
   * service reports the subscription gone (404/410). Returns false when absent.
   */
  pruneEndpoint(endpoint: string): Promise<boolean>
}

export function createPushSubscriptionsRepository(sql: Sql): PushSubscriptionsRepository {
  return {
    async upsert(input) {
      const rows = await sql<PushSubscriptionRow[]>`
        INSERT INTO push_subscriptions (clinic_id, user_id, user_email, endpoint, p256dh, auth)
        VALUES (
          ${input.clinicId},
          ${input.userId},
          ${input.userEmail},
          ${input.endpoint},
          ${input.p256dh},
          ${input.auth}
        )
        ON CONFLICT (endpoint) DO UPDATE SET
          clinic_id  = EXCLUDED.clinic_id,
          user_id    = EXCLUDED.user_id,
          user_email = EXCLUDED.user_email,
          p256dh     = EXCLUDED.p256dh,
          auth       = EXCLUDED.auth,
          updated_at = NOW()
        RETURNING *
      `
      return rows[0]!
    },

    async listByRecipient(clinicId, userEmail) {
      return sql<PushSubscriptionRow[]>`
        SELECT * FROM push_subscriptions
        WHERE clinic_id = ${clinicId} AND user_email = ${userEmail}
        ORDER BY created_at ASC
      `
    },

    async deleteByEndpoint(userId, endpoint) {
      const rows = await sql<{ id: string }[]>`
        DELETE FROM push_subscriptions
        WHERE user_id = ${userId} AND endpoint = ${endpoint}
        RETURNING id
      `
      return rows.length > 0
    },

    async pruneEndpoint(endpoint) {
      const rows = await sql<{ id: string }[]>`
        DELETE FROM push_subscriptions WHERE endpoint = ${endpoint} RETURNING id
      `
      return rows.length > 0
    },
  }
}
