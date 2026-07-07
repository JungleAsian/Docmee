// Reschedule flow (intent: reschedule_request).
// Confirm which appointment → new date → new time → availability check →
// confirm → move the Google Calendar event and update the appointment row.
import type { CalendarOps, TimeSlot } from './google-calendar-client.js'
import {
  type Language,
  type ClinicInfo,
  type UpcomingAppointment,
  parseDate,
  clinicToday,
  parseTime,
  isAffirmative,
  isNegative,
  pick,
} from './shared.js'
import {
  type DoctorAvailability,
  hasAvailability,
  worksOnDay,
  filterSlotsByAvailability,
} from './doctor-availability.js'

export type RescheduleStep = 'confirm_appointment' | 'ask_date' | 'ask_time' | 'confirm_details' | 'done'

export interface RescheduleState {
  step: RescheduleStep
  appointmentId?: string
  preferredDate?: string
  preferredTime?: string
  confirmedSlot?: TimeSlot
}

export interface RescheduleContext {
  language: Language
  clinic: ClinicInfo
  appointment: UpcomingAppointment | null
  // Req 30: the duration of the existing appointment's service, so the moved slot
  // keeps the right length instead of collapsing to the 30-min default.
  serviceDurationMinutes?: number
  // Req 30: the booked doctor's working hours. When set, the new time must fall on
  // a day/inside an hour the doctor actually works — mirroring the booking flow so
  // a reschedule can't move an appointment outside that doctor's availability.
  availability?: DoctorAvailability
}

export interface RescheduleDeps {
  calendar: CalendarOps
  applyReschedule(input: { appointmentId: string; eventId: string | null; startTime: string; endTime: string }): Promise<void>
}

export interface RescheduleResult {
  nextState: RescheduleState
  reply: string
  done: boolean
}

export function initialRescheduleState(): RescheduleState {
  return { step: 'confirm_appointment' }
}

function slotStart(date: string, time: string): string {
  return `${date}T${time}:00`
}

// End of a slot starting at `startIso` (zone-less `YYYY-MM-DDTHH:MM:SS`) after
// `durationMinutes`. Kept zone-less to match the calendar's slot format so the
// rescheduled appointment row reflects the service's real length (Req 30) rather
// than the calendar's fixed 30-min grid.
function slotEnd(startIso: string, durationMinutes: number): string {
  const d = new Date(`${startIso}Z`)
  d.setUTCMinutes(d.getUTCMinutes() + durationMinutes)
  return d.toISOString().slice(0, 19)
}

export async function advanceRescheduleFlow(
  state: RescheduleState,
  message: string,
  ctx: RescheduleContext,
  deps: RescheduleDeps,
): Promise<RescheduleResult> {
  const L = ctx.language
  const duration = ctx.serviceDurationMinutes ?? 30

  if (!ctx.appointment) {
    return {
      nextState: { step: 'done' },
      reply: pick(L, 'No tiene citas próximas para reagendar.', 'You have no upcoming appointments to reschedule.'),
      done: true,
    }
  }
  const appt = ctx.appointment

  switch (state.step) {
    case 'confirm_appointment': {
      if (isAffirmative(message)) {
        return {
          nextState: { ...state, step: 'ask_date', appointmentId: appt.id },
          reply: pick(L, '¿Para qué nuevo día? (AAAA-MM-DD)', 'What new day would you like? (YYYY-MM-DD)'),
          done: false,
        }
      }
      if (isNegative(message)) {
        return {
          nextState: { step: 'done' },
          reply: pick(L, 'De acuerdo, su cita se mantiene.', 'No problem, your appointment stays as is.'),
          done: true,
        }
      }
      return {
        nextState: { ...state, step: 'confirm_appointment' },
        reply: pick(
          L,
          `Tiene una cita con ${appt.providerName} el ${appt.date} a las ${appt.time}. ¿Desea reagendarla? (sí/no)`,
          `You have an appointment with ${appt.providerName} on ${appt.date} at ${appt.time}. Would you like to reschedule it? (yes/no)`,
        ),
        done: false,
      }
    }

    case 'ask_date': {
      const date = parseDate(message, clinicToday(ctx.clinic.timezone))
      if (!date) {
        return {
          nextState: state,
          reply: pick(L, 'No entendí la fecha. Pruebe con "mañana", "el lunes" o 2026-07-01.', "I didn't catch the date. Try \"tomorrow\", \"next Monday\", or 2026-07-01."),
          done: false,
        }
      }
      return {
        nextState: { ...state, step: 'ask_time', preferredDate: date },
        reply: pick(L, '¿A qué hora? (por ejemplo 10:00)', 'What time? (e.g. 10:00)'),
        done: false,
      }
    }

    case 'ask_time': {
      const time = parseTime(message)
      const date = state.preferredDate
      if (!time || !date) {
        return {
          nextState: { ...state, step: 'ask_time' },
          reply: pick(L, '¿A qué hora? (por ejemplo 10:00)', 'What time? (e.g. 10:00)'),
          done: false,
        }
      }

      // Req 30: respect the booked doctor's working hours. A day the doctor is off
      // sends the patient back to pick another day without even hitting the calendar.
      const availability = ctx.availability
      if (availability && hasAvailability(availability) && !worksOnDay(availability, date)) {
        return {
          nextState: { ...state, step: 'ask_date', preferredDate: undefined, preferredTime: undefined },
          reply: pick(
            L,
            `${appt.providerName} no atiende ese día. ¿Qué otro día prefiere? (AAAA-MM-DD)`,
            `${appt.providerName} doesn't work that day. Which other day do you prefer? (YYYY-MM-DD)`,
          ),
          done: false,
        }
      }

      // Double-booking protection, then keep only slots inside the doctor's hours.
      const freeSlots = await deps.calendar.listSlots(date)
      const slots = availability ? filterSlotsByAvailability(freeSlots, date, availability) : freeSlots
      const match = slots.find((s) => s.start === slotStart(date, time))
      if (!match) {
        const alts = slots.slice(0, 4).map((s) => s.start.slice(11, 16))
        const altText = alts.length ? alts.join(', ') : pick(L, 'no hay horarios libres ese día', 'no free times that day')
        return {
          nextState: { ...state, step: 'ask_time', preferredTime: undefined },
          reply: pick(
            L,
            `Esa hora no está disponible. Horarios libres: ${altText}. ¿Cuál prefiere?`,
            `That time isn't available. Free times: ${altText}. Which works for you?`,
          ),
          done: false,
        }
      }
      return {
        nextState: { ...state, step: 'confirm_details', preferredTime: time, confirmedSlot: match },
        reply: pick(
          L,
          `Confirmo el cambio a ${date} a las ${time}. ¿Está correcto? (sí/no)`,
          `To confirm the change to ${date} at ${time}. Is that correct? (yes/no)`,
        ),
        done: false,
      }
    }

    case 'confirm_details': {
      if (isNegative(message) && !isAffirmative(message)) {
        return {
          nextState: { ...state, step: 'ask_date', preferredTime: undefined, confirmedSlot: undefined },
          reply: pick(L, '¿Para qué otro día? (AAAA-MM-DD)', 'Which other day? (YYYY-MM-DD)'),
          done: false,
        }
      }
      if (!isAffirmative(message)) {
        return {
          nextState: state,
          reply: pick(L, 'Por favor confirme con "sí" o "no".', 'Please confirm with "yes" or "no".'),
          done: false,
        }
      }
      const slot = state.confirmedSlot
      if (!slot || !state.appointmentId || !state.preferredDate || !state.preferredTime) {
        return {
          nextState: { ...state, step: 'ask_date' },
          reply: pick(L, '¿Para qué nuevo día? (AAAA-MM-DD)', 'What new day would you like? (YYYY-MM-DD)'),
          done: false,
        }
      }
      if (appt.googleEventId) {
        await deps.calendar.updateEvent({
          eventId: appt.googleEventId,
          title: `Cita: ${appt.providerName}`,
          date: state.preferredDate,
          time: state.preferredTime,
          durationMinutes: duration,
        })
      }
      await deps.applyReschedule({
        appointmentId: state.appointmentId,
        eventId: appt.googleEventId,
        startTime: slot.start,
        // Preserve the service's real length (Req 30); slot.end is the calendar's
        // fixed 30-min grid, which would shrink a longer appointment.
        endTime: slotEnd(slot.start, duration),
      })
      return {
        nextState: { ...state, step: 'done' },
        reply: pick(
          L,
          `¡Listo! Su cita con ${appt.providerName} quedó reagendada para el ${state.preferredDate} a las ${state.preferredTime}.`,
          `Done! Your appointment with ${appt.providerName} is now on ${state.preferredDate} at ${state.preferredTime}.`,
        ),
        done: true,
      }
    }

    case 'done': {
      return {
        nextState: state,
        reply: pick(L, 'Su cita ya fue reagendada.', 'Your appointment has already been rescheduled.'),
        done: true,
      }
    }
  }
}
