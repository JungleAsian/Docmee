export const SCHEDULING_SESSION_IDLE_MS = 30 * 60 * 1000

export function schedulingAction(session: unknown): 'book' | 'reschedule' | 'cancel' | 'status' | null {
  if (!session || typeof session !== 'object' || !('action' in session)) return null
  const action = session.action
  return action === 'book' || action === 'reschedule' || action === 'cancel' || action === 'status'
    ? action : null
}

export function schedulingSessionExpired(session: unknown, now = Date.now()): boolean {
  if (!session || typeof session !== 'object' || !('lastActivityAt' in session)) return true
  const timestamp = typeof session.lastActivityAt === 'string' ? Date.parse(session.lastActivityAt) : NaN
  // Untimed legacy cursors cannot establish an active appointment conversation.
  return !Number.isFinite(timestamp) || timestamp > now || now - timestamp >= SCHEDULING_SESSION_IDLE_MS
}

export function isSchedulingMenuEscape(message: string): boolean {
  const normalized = message.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return normalized === 'menu' || normalized === 'inicio'
}
