// Frontend mirror of the secretary-alert taxonomy (Req 24). Mirrors the canonical
// map in @docmee/notifications/notification-types.ts — kept local so the Next app
// carries no workspace dependency on that package (same pattern as types.ts).
//
// Used by the notification bell (priority → icon/colour) and the preferences panel
// (only NON-p1 alerts can be muted; p1 safety alerts always email).
import type { TranslationKey } from './i18n'
import type { AlertCategoryKey } from './types'

export type AlertPriority = 'p1' | 'p2' | 'standard'

export const NOTIFICATION_PRIORITY: Record<string, AlertPriority> = {
  // P1 — urgent (always emailed, never mutable)
  emergency: 'p1',
  human_handoff_requested: 'p1',
  bot_failed: 'p1',
  upset_patient: 'p1',
  secretary_escalated: 'p1',
  // P2 — important
  new_patient: 'p2',
  new_message: 'p2',
  booking_confirmed: 'p2',
  booking_cancelled: 'p2',
  booking_rescheduled: 'p2',
  opted_out: 'p2',
  appointment_reminder: 'p2',
  // Standard
  conversation_assigned: 'standard',
  conversation_resolved: 'standard',
  stale_conversation: 'standard',
  secretary_timeout: 'standard',
  meta_token_expiring: 'standard',
  daily_summary: 'standard',
  kb_miss_threshold: 'standard',
  license_expiring: 'standard',
  license_expired: 'standard',
}

/** All alert types, in display order. */
export const ALERT_TYPES = Object.keys(NOTIFICATION_PRIORITY)

// Item 4 of the 25-item batch: which alert category an alert type belongs to, for
// picking its audible tone. Mirrors CATEGORY_TYPES in
// @docmee/notifications/preferences.ts. Types with no category (daily_summary,
// etc.) always play the 'internal' tone.
export const ALERT_CATEGORY_FOR: Record<string, AlertCategoryKey> = {
  emergency: 'internal',
  human_handoff_requested: 'internal',
  bot_failed: 'internal',
  upset_patient: 'internal',
  secretary_escalated: 'internal',
  secretary_timeout: 'internal',
  low_review_score: 'internal',
  kb_miss_threshold: 'internal',
  meta_token_expiring: 'internal',
  license_expiring: 'internal',
  license_expired: 'internal',
  opted_out: 'internal',
  booking_confirmed: 'newBooking',
  booking_cancelled: 'cancellation',
  booking_rescheduled: 'bookingRevision',
  new_patient: 'newMessage',
  new_message: 'newMessage',
}
export function alertCategoryFor(alertType: string | null | undefined): AlertCategoryKey {
  return (alertType && ALERT_CATEGORY_FOR[alertType]) || 'internal'
}

/** Assignable sound-preset categories, in display order (for the settings UI). */
export const SOUND_CATEGORY_KEYS: AlertCategoryKey[] = [
  'newBooking',
  'cancellation',
  'bookingRevision',
  'newMessage',
  'internal',
]
export const SOUND_PRESETS = ['default', 'chime', 'ping', 'bell'] as const

/** Alert types a user may mute (p1 safety alerts always email and are excluded). */
export const MUTABLE_ALERT_TYPES = ALERT_TYPES.filter((t) => NOTIFICATION_PRIORITY[t] !== 'p1')

export function alertPriority(alertType: string | null | undefined): AlertPriority {
  return (alertType && NOTIFICATION_PRIORITY[alertType]) || 'standard'
}

/** i18n key for a human label of an alert type, e.g. notif.type.emergency. */
export function alertLabelKey(alertType: string): TranslationKey {
  return `notif.type.${alertType}` as TranslationKey
}

/** Tailwind dot colour by priority for the feed marker. */
export const PRIORITY_DOT: Record<AlertPriority, string> = {
  p1: 'bg-red-500',
  p2: 'bg-amber-500',
  standard: 'bg-gray-400',
}

/** Per-alert-type glyph for the feed row icon (Screen 11). Falls back to 🔔. */
const ALERT_ICON: Record<string, string> = {
  emergency: '🚑',
  human_handoff_requested: '🙋',
  bot_failed: '🤖',
  upset_patient: '😟',
  secretary_escalated: '⏫',
  new_patient: '🧑',
  new_message: '💬',
  booking_confirmed: '📅',
  booking_cancelled: '❌',
  booking_rescheduled: '🔁',
  opted_out: '🚫',
  appointment_reminder: '⏰',
  conversation_assigned: '📌',
  conversation_resolved: '✅',
  stale_conversation: '🕒',
  secretary_timeout: '⌛',
  meta_token_expiring: '🔑',
  daily_summary: '📊',
  kb_miss_threshold: '❓',
  license_expiring: '🔑',
  license_expired: '🔑',
}

export function alertIcon(alertType: string | null | undefined): string {
  return (alertType && ALERT_ICON[alertType]) || '🔔'
}

// Patient-safety alerts — an emergency keyword paused the bot. Always unmistakable
// (solid-red badge). Mirrors router.ts: emergency → bot silenced, routed to a human.
const SAFETY_ALERT_TYPES = new Set(['emergency'])
export function isSafetyAlert(alertType: string | null | undefined): boolean {
  return Boolean(alertType && SAFETY_ALERT_TYPES.has(alertType))
}

// Bot→human handoff alerts — the conversation needs a person (patient asked for one,
// the bot failed, or a secretary escalated). Surfaced with a handoff badge.
const HANDOFF_ALERT_TYPES = new Set([
  'human_handoff_requested',
  'bot_failed',
  'secretary_escalated',
])
export function isHandoffAlert(alertType: string | null | undefined): boolean {
  return Boolean(alertType && HANDOFF_ALERT_TYPES.has(alertType))
}

// Who is handling the conversation behind an alert, derived from the taxonomy
// (the alert type encodes it): safety/handoff/upset → a human is/should be in the
// loop; bot-driven patient events → the assistant handled it; everything else is a
// system/info notice with no conversation mode. Drives the Bot/Human-mode badge.
export type AlertHandling = 'human' | 'bot' | 'system'
const HUMAN_HANDLED = new Set([
  'emergency',
  'human_handoff_requested',
  'bot_failed',
  'upset_patient',
  'secretary_escalated',
])
const BOT_HANDLED = new Set([
  'new_patient',
  'new_message',
  'booking_confirmed',
  'booking_cancelled',
  'booking_rescheduled',
  'appointment_reminder',
  'conversation_resolved',
])
export function alertHandling(alertType: string | null | undefined): AlertHandling {
  if (alertType && HUMAN_HANDLED.has(alertType)) return 'human'
  if (alertType && BOT_HANDLED.has(alertType)) return 'bot'
  return 'system'
}

/** Friendly channel label from metadata.channel (proper nouns — not translated). */
const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  messenger: 'Messenger',
  instagram: 'Instagram',
  webchat: 'Web chat',
  system: 'System',
  automation: 'Automation',
  calendar: 'Calendar',
}
export function channelLabel(channel: unknown): string | null {
  if (typeof channel !== 'string' || !channel) return null
  return CHANNEL_LABEL[channel] ?? channel.charAt(0).toUpperCase() + channel.slice(1)
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function readableValue(value: unknown): string {
  if (value == null || value === '') return ''
  if (typeof value === 'string') return formatAlertText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(readableValue).filter(Boolean).join(', ')
  if (typeof value === 'object') return objectToReadableLines(value as Record<string, unknown>)
  return String(value)
}

function objectToReadableLines(value: Record<string, unknown>): string {
  return Object.entries(value)
    .filter(([, entry]) => entry != null && entry !== '')
    .map(([key, entry]) => `${titleCase(key)}: ${readableValue(entry)}`)
    .join('\n')
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  }
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase()
    if (lower[0] === '#') {
      const code = lower[1] === 'x' ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return named[lower] ?? match
  })
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]*>/g, '')
}

function htmlToReadableText(value: string): string {
  return value
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(h[1-6]|p|div|section|article|li|ul|ol|table|tr)\s*>/gi, '\n')
    .replace(/<\s*(h[1-6]|p|div|section|article|li|ul|ol|table|tr)\b[^>]*>/gi, '\n')
    .replace(/<\s*pre\b[^>]*>([\s\S]*?)<\s*\/\s*pre\s*>/gi, (_match, inner: string) => {
      const preText = decodeHtmlEntities(stripHtmlTags(inner)).trim()
      return preText ? `\n${formatAlertText(preText)}\n` : '\n'
    })
    .replace(/<[^>]*>/g, '')
}

export function formatAlertText(value: string | null | undefined): string {
  const source = value?.trim()
  const raw = source && /<\s*\/?\s*[a-z][^>]*>/i.test(source)
    ? htmlToReadableText(source).trim()
    : source
  if (!raw) return ''

  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) return parsed.map(readableValue).filter(Boolean).join('\n')
      if (parsed && typeof parsed === 'object') return objectToReadableLines(parsed as Record<string, unknown>)
    } catch {
      // Fall through to plain-text cleanup when content only looks like JSON.
    }
  }

  return raw
    .replace(/\\n/g, '\n')
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed) return ''
      const keyValue = trimmed.match(/^([a-zA-Z0-9_.-]+)\s*[:=]\s*(.+)$/)
      if (keyValue) return `${titleCase(keyValue[1])}: ${formatAlertText(keyValue[2])}`
      return decodeHtmlEntities(trimmed).replace(/_/g, ' ').replace(/\s+/g, ' ')
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

export function formatAlertDetailText(value: string | null | undefined, title?: string | null): string {
  const formatted = formatAlertText(value)
  const normalizedTitle = title?.trim().toLowerCase()
  if (!formatted || !normalizedTitle) return formatted

  const lines = formatted.split('\n')
  if (lines[0]?.trim().toLowerCase() === normalizedTitle) {
    return lines.slice(1).join('\n').trim()
  }
  return formatted
}

export function alertTitleText(subject: string | null | undefined, fallback: string): string {
  const formatted = formatAlertText(subject)
  return formatted || fallback
}
