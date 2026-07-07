// Screen 3 (Patient profile & history) — pure derivations shared by the patient
// profile page and its tests. Kept side-effect free (the caller passes `nowIso`)
// so the timeline grouping, the next-live-appointment pick and the last-interaction
// stamp are deterministic and unit-testable.
import type { Appointment, Conversation } from './types'

/**
 * Split a patient's appointments into upcoming (start ≥ now) and past (start <
 * now). The API returns them newest-first; we keep upcoming soonest-first (so the
 * nearest visit reads at the top of the timeline) and past newest-first.
 */
export function splitAppointments(
  appointments: Appointment[],
  nowIso: string,
): { upcoming: Appointment[]; past: Appointment[] } {
  const upcoming = appointments
    .filter((a) => a.startTime >= nowIso)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
  const past = appointments
    .filter((a) => a.startTime < nowIso)
    .sort((a, b) => b.startTime.localeCompare(a.startTime))
  return { upcoming, past }
}

/**
 * The soonest upcoming appointment that is still live (not cancelled / no-show) —
 * what the summary tile and the conversation-status card surface as "next".
 */
export function nextLiveAppointment(upcoming: Appointment[]): Appointment | null {
  return upcoming.find((a) => a.status !== 'cancelled' && a.status !== 'no_show') ?? null
}

/** Most recent message timestamp across every conversation (this thread included). */
export function lastInteractionAt(conversations: Conversation[]): string | null {
  return (
    conversations
      .map((c) => c.lastMessageAt)
      .filter((d): d is string => Boolean(d))
      .sort()
      .at(-1) ?? null
  )
}

/**
 * Closed (resolved/archived) past conversations other than the one we came from —
 * shown read-only in the timeline. Newest-first.
 */
export function pastConversations(
  conversations: Conversation[],
  currentId: string,
): Conversation[] {
  return conversations
    .filter((c) => c.id !== currentId && (c.status === 'resolved' || c.status === 'archived'))
    .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
}
