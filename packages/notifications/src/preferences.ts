// Per-user notification preferences (Rev1 #24).
//
// A clinic user can mute the EMAIL channel for non-urgent alerts. Two knobs:
//   • emailEnabled — master switch for alert emails (default true).
//   • mutedTypes   — specific alert types the user does not want emailed.
//
// IMPORTANT: these gate ONLY the email channel. The in-panel bell feed always
// records every alert (see ./routing.ts — panel is unconditionally true), so a
// muted alert still shows in the bell; the user just won't get the email. And
// urgent (p1) alerts are NEVER suppressed by prefs — that rule lives in
// routeNotification, so emergencies/handoffs always email regardless of prefs.
//
// This module is pure (no DB): the worker reads the stored JSON from
// clinic_users.notification_prefs and feeds it in.
import type { NotificationType } from './notification-types.js'
import { NOTIFICATION_TYPES, isNotificationType } from './notification-types.js'

export const ALERT_CATEGORY_KEYS = [
  'whatsapp',
  'internal',
  'newBooking',
  'cancellation',
  'bookingRevision',
] as const

export type AlertCategoryKey = (typeof ALERT_CATEGORY_KEYS)[number]

export type AlertCategoryPrefs = Record<AlertCategoryKey, boolean>

export const DEFAULT_ALERT_CATEGORIES: AlertCategoryPrefs = {
  whatsapp: true,
  internal: true,
  newBooking: true,
  cancellation: true,
  bookingRevision: true,
}

const CATEGORY_TYPES: Record<Exclude<AlertCategoryKey, 'whatsapp'>, NotificationType[]> = {
  internal: [
    NOTIFICATION_TYPES.EMERGENCY,
    NOTIFICATION_TYPES.HUMAN_HANDOFF_REQUESTED,
    NOTIFICATION_TYPES.BOT_FAILED,
    NOTIFICATION_TYPES.UPSET_PATIENT,
    NOTIFICATION_TYPES.SECRETARY_ESCALATED,
    NOTIFICATION_TYPES.SECRETARY_TIMEOUT,
    NOTIFICATION_TYPES.LOW_REVIEW_SCORE,
    NOTIFICATION_TYPES.KB_MISS_THRESHOLD,
    NOTIFICATION_TYPES.META_TOKEN_EXPIRING,
    NOTIFICATION_TYPES.LICENSE_EXPIRING,
    NOTIFICATION_TYPES.LICENSE_EXPIRED,
    NOTIFICATION_TYPES.OPTED_OUT,
  ],
  newBooking: [NOTIFICATION_TYPES.BOOKING_CONFIRMED],
  cancellation: [NOTIFICATION_TYPES.BOOKING_CANCELLED],
  bookingRevision: [NOTIFICATION_TYPES.BOOKING_RESCHEDULED],
}

export interface NotificationPrefs {
  /** Master switch for alert emails. */
  emailEnabled: boolean
  /** Alert types the user has opted out of receiving by email. */
  mutedTypes: NotificationType[]
  /** Admin-facing grouped alert subscriptions. */
  alertCategories?: AlertCategoryPrefs
  /** Browser-side audible alerts for the panel. */
  soundEnabled: boolean
  /** Show the floating J.zel assistant for this user. */
  jzelEnabled?: boolean
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  emailEnabled: true,
  mutedTypes: [],
  alertCategories: { ...DEFAULT_ALERT_CATEGORIES },
  soundEnabled: false,
  jzelEnabled: true,
}

/**
 * Coerce an untrusted stored or posted value into a well-formed NotificationPrefs.
 * Missing or malformed keys fall back to the permissive default (email on, nothing
 * muted) so a bad row can never silently swallow a secretary's alerts. Unknown
 * alert-type strings in mutedTypes are dropped.
 */
export function normalizeNotificationPrefs(raw: unknown): NotificationPrefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_NOTIFICATION_PREFS }
  const obj = raw as Record<string, unknown>
  const emailEnabled = obj['emailEnabled'] === false ? false : true
  const soundEnabled = obj['soundEnabled'] === true
  const jzelEnabled = obj['jzelEnabled'] === false ? false : true
  const mutedRaw = Array.isArray(obj['mutedTypes']) ? obj['mutedTypes'] : []
  const mutedTypes = mutedRaw.filter(
    (v): v is NotificationType => typeof v === 'string' && isNotificationType(v),
  )
  const categoriesRaw = obj['alertCategories']
  const alertCategories = { ...DEFAULT_ALERT_CATEGORIES }
  if (categoriesRaw && typeof categoriesRaw === 'object') {
    const categories = categoriesRaw as Record<string, unknown>
    for (const key of ALERT_CATEGORY_KEYS) {
      if (categories[key] === false) alertCategories[key] = false
      if (categories[key] === true) alertCategories[key] = true
    }
  }
  return { emailEnabled, mutedTypes: [...new Set(mutedTypes)], alertCategories, soundEnabled, jzelEnabled }
}

/**
 * Whether the user's prefs allow an email for `type`. This is the user-pref gate
 * only — it does NOT account for priority/presence (routeNotification owns that,
 * and forces p1 emails through regardless). Returns false when the master switch
 * is off or the type is explicitly muted.
 */
export function isEmailAllowedByPrefs(prefs: NotificationPrefs, type: NotificationType): boolean {
  if (!prefs.emailEnabled) return false
  return !prefs.mutedTypes.includes(type)
}

export function isAlertCategoryAllowedByPrefs(
  prefs: NotificationPrefs,
  type: NotificationType,
  data?: Record<string, unknown>,
): boolean {
  const alertCategories = prefs.alertCategories ?? DEFAULT_ALERT_CATEGORIES
  if (data?.['channel'] === 'whatsapp' && !alertCategories.whatsapp) return false
  for (const [category, types] of Object.entries(CATEGORY_TYPES) as Array<[Exclude<AlertCategoryKey, 'whatsapp'>, NotificationType[]]>) {
    if (types.includes(type) && !alertCategories[category]) return false
  }
  return true
}
