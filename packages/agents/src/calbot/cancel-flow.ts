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
  deleteEvent(eventId: string): Promise<void>
  markCancelled(appointmentId: string): Promise<void>
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
    if (appt.googleEventId) await deps.deleteEvent(appt.googleEventId)
    await deps.markCancelled(appt.id)
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
