import { NOTIFICATION_PRIORITY, type NotificationType, type NotificationPriority } from './notification-types.js'
import { buildNotificationEmail } from './templates.js'
import { routeNotification } from './routing.js'
import { sendEmail as defaultSendEmail, type SendEmailFn } from './channels/email.channel.js'
import {
  sendWebPush as defaultSendWebPush,
  type WebPushSubscription,
  type VapidKeys,
} from './channels/web-push.channel.js'

export interface DispatchNotificationParams {
  clinicId: string
  conversationId?: string | null
  type: NotificationType
  data?: Record<string, unknown>
  recipientEmail: string
  /**
   * Whether the alert recipient is currently online in the panel. Drives the
   * email-vs-panel routing (see ./routing.ts). Defaults to offline (email sent).
   */
  recipientOnline?: boolean
  /**
   * Whether the recipient's notification preferences permit an email for this
   * alert type (see ./preferences.ts). Can only suppress a non-urgent email; p1
   * alerts always email. Defaults to true (no preference set).
   */
  emailAllowed?: boolean
}

/** Persistence the dispatcher needs — supplied by the worker (backed by @docmee/db). */
export interface NotificationStore {
  create(input: {
    clinicId: string
    conversationId?: string | null
    alertType: NotificationType
    priority: NotificationPriority
    /** Delivery channel chosen by routing: 'email' or panel-only 'in_app'. */
    notificationType: 'email' | 'in_app'
    recipient: string
    subject: string
    content: string
    status: 'pending'
  }): Promise<{ id: string }>
  updateStatus(id: string, status: 'sent' | 'failed', error?: string | null): Promise<void>
}

/**
 * Optional Web Push fan-out (Req 39 — installed-PWA mobile alerts). When the
 * worker supplies the recipient's device subscriptions + the VAPID keypair, the
 * dispatcher pushes a compact payload to every device so a secretary is alerted
 * on their phone even with the panel closed. Independent of email-vs-panel
 * routing and entirely best-effort: a push failure never affects the alert.
 */
export interface PushDispatch {
  subscriptions: WebPushSubscription[]
  vapid: VapidKeys
  /** Defaults to the node:crypto-backed sendWebPush; overridable for tests. */
  send?: typeof defaultSendWebPush
  /** Called with an endpoint the push service reported gone (404/410) to prune it. */
  onExpired?: (endpoint: string) => Promise<void> | void
}

export interface DispatchNotificationDeps {
  store: NotificationStore
  /** Defaults to the resend-backed sendEmail; overridable for tests. */
  sendEmail?: SendEmailFn
  push?: PushDispatch
}

/** Compact JSON the service worker renders as a notification (see sw.js push handler). */
export function buildPushPayload(
  type: NotificationType,
  subject: string,
  conversationId?: string | null,
): string {
  return JSON.stringify({
    title: subject,
    body: 'Open Docmee to respond.',
    tag: type,
    url: conversationId ? `/inbox?conversation=${conversationId}` : '/inbox',
  })
}

/** Fan an alert out to every device the recipient enabled. Never throws. */
async function deliverPush(
  push: PushDispatch,
  payload: string,
): Promise<void> {
  const send = push.send ?? defaultSendWebPush
  await Promise.all(
    push.subscriptions.map(async (subscription) => {
      try {
        const result = await send(subscription, payload, push.vapid)
        if (result.expired) await push.onExpired?.(subscription.endpoint)
      } catch {
        // Best-effort: a single dead device must not affect the alert.
      }
    }),
  )
}

/**
 * Persist a notification and deliver it on its routed channel(s). The alert is
 * always recorded for the in-panel feed; an email is additionally sent when
 * routing says so (p1 always, p2/standard only when the recipient is offline —
 * see ./routing.ts). Panel-only alerts are marked 'sent' on creation (delivered
 * to the feed). Email failures are recorded (status='failed') but never thrown —
 * a failed alert email must not crash the worker processing the job.
 */
export async function dispatchNotification(
  params: DispatchNotificationParams,
  deps: DispatchNotificationDeps,
): Promise<void> {
  const send = deps.sendEmail ?? defaultSendEmail
  const priority = NOTIFICATION_PRIORITY[params.type]
  const route = routeNotification(priority, params.recipientOnline, params.emailAllowed ?? true)
  const { subject, html } = buildNotificationEmail(params.type, params.data ?? {})

  const saved = await deps.store.create({
    clinicId: params.clinicId,
    conversationId: params.conversationId ?? null,
    alertType: params.type,
    priority,
    notificationType: route.channel,
    recipient: params.recipientEmail,
    subject,
    content: html,
    status: 'pending',
  })

  // Mobile push (Req 39) fires on every alert, independent of email-vs-panel
  // routing, so an away secretary is reached on their phone. Best-effort.
  if (deps.push && deps.push.subscriptions.length > 0) {
    await deliverPush(deps.push, buildPushPayload(params.type, subject, params.conversationId))
  }

  // Panel-only (online recipient, non-urgent): the feed entry IS the delivery.
  if (!route.email) {
    await deps.store.updateStatus(saved.id, 'sent')
    return
  }

  try {
    await send({ to: params.recipientEmail, subject, html })
    await deps.store.updateStatus(saved.id, 'sent')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await deps.store.updateStatus(saved.id, 'failed', message)
  }
}
