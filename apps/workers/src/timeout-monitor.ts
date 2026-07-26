// Background timeout detection (Gap: secretary inactivity + stale conversations).
// Runs on an interval from index.ts. Two alert checks, both deduped per
// conversation so a long-stale conversation alerts at most once per
// DEDUP_WINDOW_MINUTES, plus a bot-reactivation pass:
//   1. SECRETARY_TIMEOUT  — a human-handled conversation (status handoff/assigned)
//      with no message in > SECRETARY_TIMEOUT_MINUTES.
//   2. STALE_CONVERSATION — an open conversation with no reply in > STALE_MINUTES.
//   3. BOT_REACTIVATION   — an auto-paused conversation (status handoff, never
//      assigned to a person) idle past BOT_REACTIVATION_MINUTES returns to the
//      bot (status → open) so it can answer again (Rev1 #5/#6).
import {
  dispatchNotification,
  pickEscalationRecipient,
  shouldEscalate,
  ESCALATION_AFTER_MINUTES,
  NOTIFICATION_TYPES,
  type NotificationStore,
  type NotificationType,
} from '@docmee/notifications'
import {
  createServiceDbClient,
  createConversationsRepository,
  createNotificationsRepository,
  createUsersRepository,
  type Conversation,
  type NotificationsRepository,
  type UsersRepository,
} from '@docmee/db'
import { buildNotificationStore } from './notification-store.js'

export const SECRETARY_TIMEOUT_MINUTES = 10
export const STALE_MINUTES = 30
export const BOT_REACTIVATION_MINUTES = 60
const DEDUP_WINDOW_MINUTES = 60
/** Only scan the last day of alerts when escalating — older ones never re-fire. */
const ESCALATION_SCAN_HOURS = 24

/**
 * A handoff is *auto-paused* (eligible for bot reactivation) when the bot paused
 * it (metadata.botPausedAt) and no human deliberately claimed it (assignedTo
 * null). Conversations a secretary explicitly assigned stay human-owned.
 */
export function isAutoPausedHandoff(conv: Conversation): boolean {
  return (
    conv.status === 'handoff' &&
    conv.assignedTo === null &&
    typeof (conv.metadata as { botPausedAt?: unknown }).botPausedAt === 'string'
  )
}

export async function runTimeoutChecks(): Promise<void> {
  const sql = createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })
  try {
    const conversations = createConversationsRepository(sql)
    const notifications = createNotificationsRepository(sql)
    const users = createUsersRepository(sql)
    const store = buildNotificationStore(notifications)

    // Resolve (and cache) the alert recipient per clinic for this run.
    const recipientCache = new Map<string, string | null>()
    const recipientFor = async (clinicId: string): Promise<string | null> => {
      if (!recipientCache.has(clinicId)) {
        const email =
          (await users.findPrimaryEmail(clinicId)) ?? process.env['ALERT_FALLBACK_EMAIL'] ?? null
        recipientCache.set(clinicId, email)
      }
      return recipientCache.get(clinicId) ?? null
    }

    const alertFor = async (conv: Conversation, type: NotificationType): Promise<void> => {
      if (await notifications.existsRecent(conv.clinicId, conv.id, type, DEDUP_WINDOW_MINUTES)) {
        return // already alerted recently
      }
      const recipientEmail = await recipientFor(conv.clinicId)
      if (!recipientEmail) {
        console.warn(`[timeout-monitor] no recipient for clinic ${conv.clinicId}; skipping ${type}`)
        return
      }
      await dispatchNotification(
        {
          clinicId: conv.clinicId,
          conversationId: conv.id,
          type,
          data: { conversationId: conv.id, status: conv.status, lastMessageAt: conv.lastMessageAt },
          recipientEmail,
          idempotencyKey: `${type}:${conv.id}:${conv.lastMessageAt ?? 'none'}`,
        },
        { store },
      )
    }

    const timedOut = await conversations.listStale(['handoff', 'assigned'], SECRETARY_TIMEOUT_MINUTES)
    for (const conv of timedOut) await alertFor(conv, NOTIFICATION_TYPES.SECRETARY_TIMEOUT)

    const stale = await conversations.listStale(['open'], STALE_MINUTES)
    for (const conv of stale) await alertFor(conv, NOTIFICATION_TYPES.STALE_CONVERSATION)

    // Bot reactivation (Rev1 #5/#6): hand auto-paused, unclaimed conversations
    // back to the bot once the patient/secretary have gone quiet long enough.
    const reactivatable = await conversations.listStale(['handoff'], BOT_REACTIVATION_MINUTES)
    for (const conv of reactivatable.filter(isAutoPausedHandoff)) {
      const metadata = { ...conv.metadata, botReactivatedAt: new Date().toISOString() }
      delete (metadata as { botPausedAt?: unknown }).botPausedAt
      delete (metadata as { handoffReason?: unknown }).handoffReason
      await conversations.update(conv.clinicId, conv.id, { status: 'open', metadata })
    }

    // CRE-60: auto-wake. Snoozed conversations whose snooze_until has passed return
    // to `open` so they resurface in the queue (and the bot can answer again).
    const dueSnoozed = await conversations.listDueSnoozed()
    for (const conv of dueSnoozed) {
      const metadata = { ...conv.metadata, snoozeWokeAt: new Date().toISOString() }
      await conversations.update(conv.clinicId, conv.id, { status: 'open', snoozeUntil: null, metadata })
    }

    // Escalation chain (Rev1 #18): urgent alerts nobody acknowledged in time
    // bubble up to the clinic admin (then a configured fallback).
    await runEscalationPass(notifications, users, store)
  } catch (err) {
    // A monitor tick must never crash the worker process.
    console.error('[timeout-monitor] check failed:', err instanceof Error ? err.message : err)
  } finally {
    await sql.end()
  }
}

/**
 * Escalation chain (Rev1 #18). Find p1 alerts that are still un-acknowledged past
 * ESCALATION_AFTER_MINUTES and raise a `secretary_escalated` alert to the next
 * person up the chain (clinic admin → ALERT_FALLBACK_EMAIL), deduped per
 * conversation so a stuck alert escalates at most once per DEDUP window.
 */
export async function runEscalationPass(
  notifications: NotificationsRepository,
  users: UsersRepository,
  store: NotificationStore,
): Promise<void> {
  const escalatable = await notifications.listEscalatable(ESCALATION_AFTER_MINUTES, ESCALATION_SCAN_HOURS)
  for (const alert of escalatable) {
    if (!alert.clinicId || !alert.conversationId) continue

    const ageMinutes = (Date.now() - new Date(alert.createdAt).getTime()) / 60_000
    if (!shouldEscalate({ priority: alert.priority ?? '', ageMinutes, status: alert.status })) continue

    if (
      await notifications.existsRecent(
        alert.clinicId,
        alert.conversationId,
        NOTIFICATION_TYPES.SECRETARY_ESCALATED,
        DEDUP_WINDOW_MINUTES,
      )
    ) {
      continue // already escalated this conversation recently
    }

    const adminEmail = await users.findEmailByRole(alert.clinicId, 'clinic_admin')
    const recipientEmail = pickEscalationRecipient({
      originalRecipient: alert.recipient,
      adminEmail,
      fallbackEmail: process.env['ALERT_FALLBACK_EMAIL'] ?? null,
    })
    if (!recipientEmail) {
      console.warn(`[timeout-monitor] no escalation target for clinic ${alert.clinicId}; skipping`)
      continue
    }

    await dispatchNotification(
      {
        clinicId: alert.clinicId,
        conversationId: alert.conversationId,
        type: NOTIFICATION_TYPES.SECRETARY_ESCALATED,
        data: {
          originalAlertId: alert.id,
          originalAlertType: alert.alertType,
          originalRecipient: alert.recipient,
          ageMinutes: Math.round(ageMinutes),
        },
        recipientEmail,
        idempotencyKey: `${NOTIFICATION_TYPES.SECRETARY_ESCALATED}:${alert.id}`,
      },
      { store },
    )
  }
}
