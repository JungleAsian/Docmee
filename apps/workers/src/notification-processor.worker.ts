// Consumes: notification queue.
// Producers enqueue either { ...agentData, reason } (agent/scheduling alertflow
// routes) or { clinicId, type, ... } (conversation processor token-expiry). This
// worker normalizes that into a canonical NotificationType, looks up the clinic's
// alert recipient, persists the notification and delivers it by email.
import {
  dispatchNotification,
  isNotificationType,
  isAlertCategoryAllowedByPrefs,
  isEmailAllowedByPrefs,
  isOnline,
  normalizeNotificationPrefs,
  NOTIFICATION_TYPES,
  type NotificationType,
} from '@docmee/notifications'
import {
  createServiceDbClient,
  createNotificationsRepository,
  createUsersRepository,
} from '@docmee/db'
import type { Job } from '@docmee/queue'
import { buildNotificationStore } from './notification-store.js'
import { buildPushDispatch } from './push-dispatch.js'

interface NotificationJobData {
  clinicId?: string
  conversationId?: string
  type?: string
  reason?: string
  recipientEmail?: string
  idempotencyKey?: string
  [key: string]: unknown
}

/** Map a raw job into one of the 20 canonical alert types (null if unmappable). */
export function resolveNotificationType(data: NotificationJobData): NotificationType | null {
  if (typeof data.type === 'string' && isNotificationType(data.type.toLowerCase())) {
    return data.type.toLowerCase() as NotificationType
  }
  switch (data.reason) {
    case 'emergency':
      return NOTIFICATION_TYPES.EMERGENCY
    case 'human_handoff':
      return NOTIFICATION_TYPES.HUMAN_HANDOFF_REQUESTED
    case 'upset':
      return NOTIFICATION_TYPES.UPSET_PATIENT
    default:
      return null
  }
}

export async function processNotificationJob(job: Job): Promise<void> {
  const data = job.data as NotificationJobData

  if (!data.clinicId) {
    console.warn('[notification] job has no clinicId; dropping')
    return
  }

  const type = resolveNotificationType(data)
  if (!type) {
    console.warn(`[notification] could not resolve type from job (reason=${data.reason}, type=${data.type}); dropping`)
    return
  }

  const sql = createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })
  try {
    const notifications = createNotificationsRepository(sql)
    const users = createUsersRepository(sql)

    const recipientEmail =
      data.recipientEmail ??
      (await users.findPrimaryEmail(data.clinicId)) ??
      process.env['ALERT_FALLBACK_EMAIL'] ??
      null

    if (!recipientEmail) {
      console.warn(`[notification] no recipient for clinic ${data.clinicId}; persisting skipped notification`)
      await notifications.create({
        clinicId: data.clinicId,
        conversationId: data.conversationId ?? null,
        alertType: type,
        recipient: 'unknown',
        content: '(no recipient configured)',
        status: 'skipped',
      })
      return
    }

    // Presence drives email-vs-panel routing: an online secretary just gets the
    // panel entry for non-urgent alerts (p1 still always emails). Unknown/offline
    // recipients are emailed.
    const lastSeen = await users.findLastSeenByEmail(data.clinicId, recipientEmail)
    const recipientOnline = isOnline(lastSeen, new Date())

    // The recipient's notification preferences can mute the EMAIL for a non-urgent
    // alert type (the bell feed still records it; p1 always emails — see routing).
    const prefs = normalizeNotificationPrefs(
      await users.findNotificationPrefsByEmail(data.clinicId, recipientEmail),
    )
    const alertData = {
      reason: data.reason,
      ...(typeof data['daysRemaining'] === 'number' ? { daysRemaining: data['daysRemaining'] } : {}),
      // Channel tag (token-expiry alerts) so the email names the right surface.
      ...(typeof data['channel'] === 'string' ? { channel: data['channel'] } : {}),
    }
    const emailAllowed =
      isEmailAllowedByPrefs(prefs, type) &&
      isAlertCategoryAllowedByPrefs(prefs, type, alertData)

    // Mobile push (Req 39): when VAPID is configured and the recipient has
    // registered devices, the alert is also pushed to their installed PWA.
    const push = await buildPushDispatch(sql, data.clinicId, recipientEmail)

    await dispatchNotification(
      {
        clinicId: data.clinicId,
        conversationId: data.conversationId ?? null,
        type,
        data: alertData,
        recipientEmail,
        recipientOnline,
        emailAllowed,
        idempotencyKey: data.idempotencyKey,
        ...(job.id != null ? { claimOwner: String(job.id) } : {}),
      },
      { store: buildNotificationStore(notifications), ...(push ? { push } : {}) },
    )
  } finally {
    await sql.end()
  }
}
