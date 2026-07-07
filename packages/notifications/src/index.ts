// @docmee/notifications — secretary-alert notification domain.
// Email delivery (resend), the 17-type alert taxonomy, email templates, and the
// dispatcher. DB persistence is injected by the worker (keeps this package free
// of @docmee/db, mirroring the agents-package DI pattern).

export {
  NOTIFICATION_TYPES,
  NOTIFICATION_PRIORITY,
  isNotificationType,
  type NotificationType,
  type NotificationPriority,
} from './notification-types.js'

export { sendEmail, type SendEmailParams, type SendEmailFn } from './channels/email.channel.js'

export {
  sendWebPush,
  encryptWebPushPayload,
  buildVapidAuthHeader,
  generateVapidKeys,
  type WebPushSubscription,
  type PushSubscriptionKeys,
  type VapidKeys,
  type SendWebPushResult,
} from './channels/web-push.channel.js'

export { buildNotificationEmail, type NotificationEmail } from './templates.js'

export {
  routeNotification,
  isOnline,
  ONLINE_WINDOW_MINUTES,
  type RouteDecision,
} from './routing.js'

export {
  shouldEscalate,
  pickEscalationRecipient,
  ESCALATION_AFTER_MINUTES,
  type EscalationCandidate,
  type NotificationStatus,
} from './escalation.js'

export {
  dispatchNotification,
  buildPushPayload,
  type DispatchNotificationParams,
  type DispatchNotificationDeps,
  type PushDispatch,
  type NotificationStore,
} from './dispatcher.js'

export {
  ALERT_CATEGORY_KEYS,
  DEFAULT_ALERT_CATEGORIES,
  DEFAULT_NOTIFICATION_PREFS,
  isAlertCategoryAllowedByPrefs,
  isEmailAllowedByPrefs,
  normalizeNotificationPrefs,
  type AlertCategoryKey,
  type AlertCategoryPrefs,
  type NotificationPrefs,
} from './preferences.js'
