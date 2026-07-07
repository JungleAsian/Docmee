// Escalation chain for unacknowledged urgent alerts (Rev1 #18).
//
// A p1 (urgent) alert that nobody acknowledges within ESCALATION_AFTER_MINUTES is
// escalated up the chain: the next responsible person (the clinic admin, then a
// configured fallback) is alerted with a `secretary_escalated` notification.
//
// This module is pure (no DB / no email): the timeout monitor finds the stale
// alerts, resolves the candidate emails, and feeds them in.

/** A p1 alert unacknowledged for this long escalates to the next chain level. */
export const ESCALATION_AFTER_MINUTES = 15

/** Mirrors @docmee/db NotificationStatus without coupling this package to it. */
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'skipped' | 'acknowledged'

export interface EscalationCandidate {
  ageMinutes: number
  /** Current delivery/handling status of the original alert. */
  status: NotificationStatus
  priority: string
}

/**
 * True when an alert is urgent, old enough, and still un-acknowledged. An alert
 * that a secretary already acknowledged (or that was skipped for lack of a
 * recipient) never escalates.
 */
export function shouldEscalate(candidate: EscalationCandidate): boolean {
  if (candidate.priority !== 'p1') return false
  if (candidate.ageMinutes < ESCALATION_AFTER_MINUTES) return false
  return candidate.status !== 'acknowledged' && candidate.status !== 'skipped'
}

/**
 * Pick the next recipient up the chain, skipping the person who already had the
 * alert (no point re-emailing them). Order: clinic admin → fallback. Returns null
 * when there is nobody new to escalate to.
 */
export function pickEscalationRecipient(opts: {
  originalRecipient: string
  adminEmail?: string | null
  fallbackEmail?: string | null
}): string | null {
  const original = opts.originalRecipient.trim().toLowerCase()
  for (const candidate of [opts.adminEmail, opts.fallbackEmail]) {
    const email = candidate?.trim()
    if (email && email.toLowerCase() !== original) return email
  }
  return null
}
