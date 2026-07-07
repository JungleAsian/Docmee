// CRE-61: first-response SLA helpers for the inbox queue. A thread is "waiting"
// when the patient's message is the most recent one (i.e. unanswered). The badge
// escalates ok → warn → breach as the wait crosses the thresholds so an operator
// can triage at a glance. Pure functions → unit-tested, no clock coupling.
export type SlaLevel = 'ok' | 'warn' | 'breach'

/** Minutes the patient has been waiting for a reply, or null if not waiting. */
export function waitingMinutes(
  lastMessageAt: string | null | undefined,
  lastRole: string | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!lastMessageAt || lastRole !== 'user') return null
  const elapsed = now - new Date(lastMessageAt).getTime()
  if (!Number.isFinite(elapsed) || elapsed < 0) return null
  return Math.floor(elapsed / 60_000)
}

export function slaLevel(minutes: number, warnAfter = 15, breachAfter = 60): SlaLevel {
  if (minutes >= breachAfter) return 'breach'
  if (minutes >= warnAfter) return 'warn'
  return 'ok'
}

/** Compact human label: 5m, 1h 20m, 2h, 1d. */
export function formatWaiting(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const rem = minutes % 60
    return rem ? `${hours}h ${rem}m` : `${hours}h`
  }
  return `${Math.floor(hours / 24)}d`
}
