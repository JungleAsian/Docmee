// Builds the optional Web Push fan-out for the notification worker (Req 39).
// Push is enabled only when VAPID keys are configured AND the recipient has at
// least one registered device; otherwise the worker dispatches email/panel as
// before. A device the push service reports gone (404/410) is pruned.
import { type PushDispatch, type VapidKeys } from '@docmee/notifications'
import { createPushSubscriptionsRepository, type Sql } from '@docmee/db'

/** Read the application-server VAPID keypair from the environment (null if unset). */
export function readVapidKeys(): VapidKeys | null {
  const publicKey = process.env['VAPID_PUBLIC_KEY']
  const privateKey = process.env['VAPID_PRIVATE_KEY']
  if (!publicKey || !privateKey) return null
  return {
    publicKey,
    privateKey,
    subject: process.env['VAPID_SUBJECT'] ?? 'mailto:ops@docmee.app',
  }
}

export async function buildPushDispatch(
  sql: Sql,
  clinicId: string,
  recipientEmail: string,
): Promise<PushDispatch | undefined> {
  const vapid = readVapidKeys()
  if (!vapid) return undefined

  const repo = createPushSubscriptionsRepository(sql)
  const rows = await repo.listByRecipient(clinicId, recipientEmail)
  if (rows.length === 0) return undefined

  return {
    vapid,
    subscriptions: rows.map((row) => ({
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    })),
    onExpired: async (endpoint) => {
      await repo.pruneEndpoint(endpoint)
    },
  }
}
