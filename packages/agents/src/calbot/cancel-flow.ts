// Cancellation flow (intent: cancel_request).
// 1. Find the patient's upcoming appointment (injected via context).
// 2. Show date/time/doctor and ask for confirmation.
// 3. On confirm → delete the Google Calendar event + mark the row cancelled.
import { type Language, type UpcomingAppointment, isAffirmative, isNegative, pick } from './shared.js'

export type CancelStep = 'confirm' | 'done'

export interface CancelState {
  step: CancelStep
}

export interface CancelContext {
  language: Language
  appointment: UpcomingAppointment | null
}

export interface CancelDeps {
  /** May throw (e.g. token expired, event already gone) — the flow catches it and cancels in Docmee regardless. */
  deleteEvent(eventId: string): Promise<void>
  markCancelled(appointmentId: string, calendar: { eventDeleted: boolean; error: string | null }): Promise<void>
}

export interface CancelResult {
  nextState: CancelState
  reply: string
  done: boolean
}

export function initialCancelState(): CancelState {
  return { step: 'confirm' }
}

export async function advanceCancelFlow(
  state: CancelState,
  message: string,
  ctx: CancelContext,
  deps: CancelDeps,
): Promise<CancelResult> {
  const L = ctx.language

  if (!ctx.appointment) {
    return {
      nextState: { step: 'done' },
      reply: pick(L, 'No tiene citas próximas para cancelar.', 'You have no upcoming appointments to cancel.'),
      done: true,
    }
  }

  const appt = ctx.appointment

  if (isAffirmative(message)) {
    // The Docmee-side cancellation always applies — deleting the Calendar event
    // is best-effort. A failure here (or no event to begin with) is recorded and
    // retried in the background rather than blocking the cancellation.
    let eventDeleted = false
    let calendarError: string | null = null
    if (appt.googleEventId) {
      try {
        await deps.deleteEvent(appt.googleEventId)
        eventDeleted = true
      } catch (err) {
        calendarError = err instanceof Error ? err.message : String(err)
      }
    }
    await deps.markCancelled(appt.id, { eventDeleted, error: calendarError })
    return {
      nextState: { step: 'done' },
      reply: pick(
        L,
        `Su cita con ${appt.providerName} del ${appt.date} a las ${appt.time} ha sido cancelada.`,
        `Your appointment with ${appt.providerName} on ${appt.date} at ${appt.time} has been cancelled.`,
      ),
      done: true,
    }
  }

  if (isNegative(message)) {
    return {
      nextState: { step: 'done' },
      reply: pick(L, 'De acuerdo, su cita se mantiene.', 'No problem, your appointment stays as is.'),
      done: true,
    }
  }

  // First turn (or unclear answer): present the appointment and ask to confirm.
  return {
    nextState: { step: 'confirm' },
    reply: pick(
      L,
      `Tiene una cita con ${appt.providerName} el ${appt.date} a las ${appt.time}. ¿Desea cancelarla? (sí/no)`,
      `You have an appointment with ${appt.providerName} on ${appt.date} at ${appt.time}. Do you want to cancel it? (yes/no)`,
    ),
    done: false,
  }
}
