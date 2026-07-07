// Appointment status check (intent: appointment_status_check).
// Stateless: list the patient's upcoming appointments, or say there are none.
import { type Language, type ClinicInfo, type UpcomingAppointment, pick } from './shared.js'

export interface StatusContext {
  language: Language
  clinic: ClinicInfo
  appointments: UpcomingAppointment[]
}

export interface StatusResult {
  reply: string
  done: true
}

export function buildStatusReply(ctx: StatusContext): StatusResult {
  const L = ctx.language

  if (ctx.appointments.length === 0) {
    return {
      reply: pick(L, 'No tiene citas próximas.', 'You have no upcoming appointments.'),
      done: true,
    }
  }

  const lines = ctx.appointments.map((a) =>
    pick(
      L,
      `• ${a.date} a las ${a.time} con ${a.providerName}`,
      `• ${a.date} at ${a.time} with ${a.providerName}`,
    ),
  )
  const header = pick(L, 'Sus próximas citas:', 'Your upcoming appointments:')
  const footer = pick(L, `Ubicación: ${ctx.clinic.name}.`, `Location: ${ctx.clinic.name}.`)

  return { reply: [header, ...lines, footer].join('\n'), done: true }
}

/** Symmetric async entry point for the worker (mirrors the other flows). */
export async function advanceStatusFlow(ctx: StatusContext): Promise<StatusResult> {
  return buildStatusReply(ctx)
}
