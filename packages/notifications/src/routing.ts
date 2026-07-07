// Channel routing for secretary alerts (Rev1 #18).
//
// Every alert is recorded in the in-panel notification feed (the bell). Whether
// it is ALSO emailed depends on the alert priority and whether the recipient is
// currently online in the panel:
//
//   • p1 (urgent)      → email always, even when the secretary is online.
//   • p2 / standard    → email ONLY when the recipient is offline; an online
//                        secretary just sees the panel entry (no email noise).
//
// This module is pure (no DB / no email): the worker resolves presence from
// clinic_users.last_seen and feeds the boolean in.
import type { NotificationPriority } from './notification-types.js'

/** A panel user is considered online if their last heartbeat is this recent. */
export const ONLINE_WINDOW_MINUTES = 5

export interface RouteDecision {
  /** Record an in-panel (bell) notification — always true. */
  panel: boolean
  /** Also deliver an email. */
  email: boolean
  /** The delivery channel stored on the notification row. */
  channel: 'email' | 'in_app'
}

/**
 * Decide where a notification of `priority` goes for a recipient who is
 * `recipientOnline`. When presence is unknown (undefined) we treat the recipient
 * as offline so an alert is never silently withheld from email.
 *
 * `emailAllowed` is the recipient's notification preference for this alert (see
 * ./preferences.ts). It can only SUPPRESS a non-urgent email — p1 (urgent) alerts
 * always email regardless, so a muted preference can never hide a safety alert.
 * Defaults to true (no preference / nothing muted), preserving prior behaviour.
 */
export function routeNotification(
  priority: NotificationPriority,
  recipientOnline?: boolean,
  emailAllowed = true,
): RouteDecision {
  const online = recipientOnline === true
  // Urgent alerts always email; non-urgent only when the recipient is offline AND
  // their preferences permit an email for this type.
  const email = priority === 'p1' ? true : !online && emailAllowed
  return { panel: true, email, channel: email ? 'email' : 'in_app' }
}

/**
 * True if a `last_seen` timestamp counts as currently online. Tolerates null
 * (never seen → offline). `now` is injectable for deterministic tests.
 */
export function isOnline(lastSeen: string | null | undefined, now: Date): boolean {
  if (!lastSeen) return false
  const seen = new Date(lastSeen).getTime()
  if (Number.isNaN(seen)) return false
  return now.getTime() - seen <= ONLINE_WINDOW_MINUTES * 60_000
}
