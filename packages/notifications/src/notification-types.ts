// The 21 secretary-alert notification types and their dispatch priority.
// These are the alert taxonomy (distinct from the delivery channel — email vs.
// in_app panel — which is decided per-alert by ./routing.ts from the priority
// and the recipient's online presence).

export const NOTIFICATION_TYPES = {
  // P1 — Urgent (immediate dispatch, always emailed even when online)
  EMERGENCY:               'emergency',
  HUMAN_HANDOFF_REQUESTED: 'human_handoff_requested',
  BOT_FAILED:              'bot_failed',
  UPSET_PATIENT:           'upset_patient',
  SECRETARY_ESCALATED:     'secretary_escalated',

  // P2 — Important (< 5 min)
  NEW_PATIENT:             'new_patient',
  BOOKING_CONFIRMED:       'booking_confirmed',
  BOOKING_CANCELLED:       'booking_cancelled',
  BOOKING_RESCHEDULED:     'booking_rescheduled',
  OPTED_OUT:               'opted_out',
  APPOINTMENT_REMINDER:    'appointment_reminder',
  LOW_REVIEW_SCORE:        'low_review_score',

  // Standard
  CONVERSATION_ASSIGNED:   'conversation_assigned',
  CONVERSATION_RESOLVED:   'conversation_resolved',
  STALE_CONVERSATION:      'stale_conversation',
  SECRETARY_TIMEOUT:       'secretary_timeout',
  META_TOKEN_EXPIRING:     'meta_token_expiring',
  DAILY_SUMMARY:           'daily_summary',
  KB_MISS_THRESHOLD:       'kb_miss_threshold',
  LICENSE_EXPIRING:        'license_expiring',
  LICENSE_EXPIRED:         'license_expired',
} as const

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES]

export type NotificationPriority = 'p1' | 'p2' | 'standard'

export const NOTIFICATION_PRIORITY: Record<NotificationType, NotificationPriority> = {
  emergency:               'p1',
  human_handoff_requested: 'p1',
  bot_failed:              'p1',
  upset_patient:           'p1',
  secretary_escalated:     'p1',
  new_patient:             'p2',
  booking_confirmed:       'p2',
  booking_cancelled:       'p2',
  booking_rescheduled:     'p2',
  opted_out:               'p2',
  appointment_reminder:    'p2',
  low_review_score:        'p2',
  conversation_assigned:   'standard',
  conversation_resolved:   'standard',
  stale_conversation:      'standard',
  secretary_timeout:       'standard',
  meta_token_expiring:     'standard',
  daily_summary:           'standard',
  kb_miss_threshold:       'standard',
  license_expiring:        'standard',
  license_expired:         'standard',
}

/** Set of valid alert-type string values, for runtime narrowing. */
const VALID_TYPES = new Set<string>(Object.values(NOTIFICATION_TYPES))

export function isNotificationType(value: string): value is NotificationType {
  return VALID_TYPES.has(value)
}
