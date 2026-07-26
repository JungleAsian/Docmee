// 8-step appointment booking state machine.
//
// One call = one inbound patient message → one reply, advancing the state by one
// (sometimes two) steps. The worker persists `nextState` between turns
// (conversations.metadata) and sends `reply`. Side effects — Google Calendar and
// the appointments table — are injected, so the whole flow is pure logic and is
// tested without a network or a database (and without an LLM: parsing is
// deterministic, see ./shared).
import type { CalendarOps, TimeSlot } from './google-calendar-client.js'
import {
  type Language,
  type ClinicInfo,
  type ProviderRef,
  type ServiceRef,
  parseDate,
  parseTime,
  clinicToday,
  addDays,
  isAffirmative,
  isNegative,
  matchProvider,
  matchService,
  pick,
} from './shared.js'
import {
  hasAvailability,
  worksOnDay,
  filterSlotsByAvailability,
  type DoctorAvailability,
} from './doctor-availability.js'

export type BookingStep =
  | 'confirm_doctor'
  | 'ask_service'
  | 'ask_reason'
  | 'ask_date'
  | 'ask_time'
  | 'check_availability'
  | 'confirm_details'
  | 'create_event'
  | 'send_confirmation'

export interface BookingState {
  step: BookingStep
  /** True after the patient has been shown the clinic's doctor picker. */
  doctorPrompted?: boolean
  providerId?: string
  doctorName?: string
  specialty?: string | null
  // Req 30: the chosen service (when the doctor offers any). Its duration sets the
  // appointment slot length.
  serviceId?: string
  serviceName?: string
  serviceDurationMinutes?: number
  reason?: string
  preferredDate?: string // YYYY-MM-DD
  preferredTime?: string // HH:MM
  confirmedSlot?: TimeSlot
  googleEventId?: string
}

export interface BookingContext {
  language: Language
  clinic: ClinicInfo
  providers: ProviderRef[]
  patientName: string | null
  serviceDurationMinutes?: number
  /** Injectable clock for deterministic tests; production defaults to the current time. */
  now?: Date
}

export interface BookingDeps {
  calendar: CalendarOps
  // Req 10 (Patient Data Capture): the full intake collected during the flow is
  // handed to the worker so it can persist the doctor/specialty, reason and the
  // patient's preferred date/time onto the appointment and the patient record —
  // not just the calendar event.
  saveAppointment(input: {
    providerId: string
    doctorName: string | null
    specialty: string | null
    serviceId: string | null
    startTime: string
    endTime: string
    reason: string
    preferredDate: string
    preferredTime: string
    googleEventId: string
  }): Promise<void>
}

export interface FlowResult {
  nextState: BookingState
  reply: string
  /** Terminal: the appointment was created (or the flow handed off). */
  done: boolean
  /** Escalate to a human (e.g. no providers configured). */
  handoff?: boolean
}

export function initialBookingState(): BookingState {
  return { step: 'confirm_doctor' }
}

function slotStart(date: string, time: string): string {
  return `${date}T${time}:00`
}

function listProviderOptions(providers: ProviderRef[]): string {
  return providers
    .map((provider, index) => {
      const specialty = provider.specialty ? ` — ${provider.specialty}` : ''
      return `${index + 1}. ${provider.fullName}${specialty}`
    })
    .join('\n')
}

function doctorPrompt(providers: ProviderRef[], L: Language, retry = false): string {
  const options = listProviderOptions(providers)
  if (retry) {
    return pick(
      L,
      `No pude identificar esa opción. Elija un doctor disponible:\n${options}\nResponda con el número o el nombre del doctor.`,
      `I couldn't match that option. Choose an available doctor:\n${options}\nReply with the number or the doctor's name.`,
    )
  }
  return pick(
    L,
    `¿Con cuál de los doctores disponibles desea agendar?\n${options}\nResponda con el número o el nombre del doctor.`,
    `Which available doctor would you like to see?\n${options}\nReply with the number or the doctor's name.`,
  )
}

function listServiceNames(services: ServiceRef[]): string {
  return services.map((s, i) => `${i + 1}. ${s.name}`).join('  ')
}

function reasonPrompt(L: Language): string {
  return pick(L, '¿Cuál es el motivo de la consulta?', 'What is the reason for your visit?')
}

// Once the doctor is known, branch on their configured services (Req 30):
//   >1 service  → ask the patient which one
//    1 service  → auto-pick it and go straight to the reason
//    0 services  → keep the original behaviour (clinic default duration)
function afterDoctorSelected(provider: ProviderRef, state: BookingState, L: Language): FlowResult {
  const services = provider.services ?? []
  const base: BookingState = {
    ...state,
    providerId: provider.id,
    doctorName: provider.fullName,
    specialty: provider.specialty ?? null,
  }

  if (services.length > 0) {
    return {
      nextState: { ...base, step: 'ask_service' },
      reply: pick(
        L,
        `Perfecto, ${provider.fullName}. ¿Qué servicio necesita?  ${listServiceNames(services)}`,
        `Great, ${provider.fullName}. Which service do you need?  ${listServiceNames(services)}`,
      ),
      done: false,
    }
  }

  return {
    nextState: { ...base, step: 'confirm_doctor' },
    reply: pick(
      L,
      `${provider.fullName} no tiene servicios habilitados. Un miembro del equipo le ayudará.`,
      `${provider.fullName} has no enabled services. A team member will help you.`,
    ),
    done: true,
    handoff: true,
  }
}

function clinicNow(timezone: string, now: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    time: `${value('hour')}:${value('minute')}`,
  }
}

function futureSlots(slots: TimeSlot[], timezone: string, now: Date): TimeSlot[] {
  const local = clinicNow(timezone, now)
  return slots.filter((slot) => {
    const date = slot.start.slice(0, 10)
    const time = slot.start.slice(11, 16)
    return date > local.date || (date === local.date && time > local.time)
  })
}

/**
 * CRE-49: scan forward from `startDate` for up to `days`, collecting the first
 * `max` free slots that fall inside the doctor's working hours. Stops early once
 * `max` is reached, so a clinic with availability costs only a call or two.
 */
async function findUpcomingSlots(
  deps: BookingDeps,
  startDate: string,
  availability: DoctorAvailability | undefined,
  opts: { days: number; max: number },
  timezone: string,
  now: Date,
): Promise<TimeSlot[]> {
  const out: TimeSlot[] = []
  for (let i = 0; i < opts.days && out.length < opts.max; i++) {
    const date = addDays(startDate, i)
    if (availability && hasAvailability(availability) && !worksOnDay(availability, date)) continue
    const free = await deps.calendar.listSlots(date)
    const inHours = availability ? filterSlotsByAvailability(free, date, availability) : free
    const slots = futureSlots(inHours, timezone, now)
    out.push(...slots)
  }
  return out.slice(0, opts.max)
}

export async function advanceBookingFlow(
  state: BookingState,
  message: string,
  ctx: BookingContext,
  deps: BookingDeps,
): Promise<FlowResult> {
  const L = ctx.language
  const now = ctx.now ?? new Date()
  const localNow = clinicNow(ctx.clinic.timezone, now)
  // Req 30: the chosen service's duration wins over the clinic-wide default.
  const duration = state.serviceDurationMinutes ?? ctx.serviceDurationMinutes ?? 30

  switch (state.step) {
    case 'confirm_doctor': {
      if (ctx.providers.length === 0) {
        return {
          nextState: state,
          reply: pick(L, 'Un miembro de nuestro equipo le ayudará a agendar su cita.', 'A team member will help you schedule your appointment.'),
          done: true,
          handoff: true,
        }
      }
      const configuredProvider = ctx.providers.find((p) => p.id === state.providerId)
      if (configuredProvider) return afterDoctorSelected(configuredProvider, state, L)

      if (!state.doctorPrompted) {
        return {
          nextState: { ...state, step: 'confirm_doctor', doctorPrompted: true },
          reply: doctorPrompt(ctx.providers, L),
          done: false,
        }
      }

      const provider = matchProvider(message, ctx.providers)
      if (!provider) {
        return {
          nextState: { ...state, step: 'confirm_doctor', doctorPrompted: true },
          reply: doctorPrompt(ctx.providers, L, true),
          done: false,
        }
      }
      return afterDoctorSelected(provider, state, L)
    }

    case 'ask_service': {
      const provider = ctx.providers.find((p) => p.id === state.providerId)
      const services = provider?.services ?? []
      if (services.length === 0) {
        return {
          nextState: { ...state, step: 'confirm_doctor', providerId: undefined },
          reply: pick(
            L,
            'Los servicios de ese doctor ya no están disponibles. Un miembro del equipo le ayudará.',
            "That doctor's services are no longer available. A team member will help you.",
          ),
          done: true,
          handoff: true,
        }
      }
      const chosen = matchService(message, services)
      if (!chosen) {
        return {
          nextState: { ...state, step: 'ask_service' },
          reply: pick(
            L,
            `No identifiqué el servicio. ¿Qué servicio necesita?  ${listServiceNames(services)}`,
            `I didn't catch the service. Which service do you need?  ${listServiceNames(services)}`,
          ),
          done: false,
        }
      }
      return {
        nextState: {
          ...state,
          step: 'ask_reason',
          serviceId: chosen.id,
          serviceName: chosen.name,
          serviceDurationMinutes: chosen.durationMinutes,
        },
        reply: reasonPrompt(L),
        done: false,
      }
    }

    case 'ask_reason': {
      const reason = message.trim()
      if (!reason) {
        return {
          nextState: state,
          reply: pick(L, '¿Cuál es el motivo de la consulta?', 'What is the reason for your visit?'),
          done: false,
        }
      }

      const provider = ctx.providers.find((p) => p.id === state.providerId)
      const availability = provider?.availability
      const startDate = localNow.date
      const availableDays: string[] = []

      for (let i = 0; i < 5; i++) {
        const date = addDays(startDate, i)
        if (availability && hasAvailability(availability) && !worksOnDay(availability, date)) continue
        const freeSlots = await deps.calendar.listSlots(date)
        const inHours = availability ? filterSlotsByAvailability(freeSlots, date, availability) : freeSlots
        const slots = futureSlots(inHours, ctx.clinic.timezone, now)
        const times = slots.slice(0, 3).map((slot) => slot.start.slice(11, 16))
        if (times.length > 0) availableDays.push(`${date}: ${times.join(', ')}`)
      }

      if (availableDays.length === 0) {
        return {
          nextState: { ...state, step: 'ask_date', reason },
          reply: pick(
            L,
            `No encontré horarios disponibles con ${state.doctorName ?? 'el doctor'} durante los próximos 5 días. Puede indicar una fecha posterior.`,
            `I couldn't find any openings with ${state.doctorName ?? 'the doctor'} during the next 5 days. You can enter a later date.`,
          ),
          done: false,
        }
      }

      return {
        nextState: { ...state, step: 'ask_date', reason },
        reply: pick(
          L,
          `Horarios disponibles con ${state.doctorName ?? 'el doctor'} durante los próximos 5 días:\n${availableDays.join('\n')}\nResponda con la fecha que prefiere.`,
          `Available options with ${state.doctorName ?? 'the doctor'} during the next 5 days:\n${availableDays.join('\n')}\nReply with your preferred date.`,
        ),
        done: false,
      }
    }

    case 'ask_date': {
      const date = parseDate(message, clinicToday(ctx.clinic.timezone))
      if (!date) {
        return {
          nextState: state,
          reply: pick(
            L,
            'No entendí la fecha. Pruebe con "mañana", "el lunes" o una fecha como 2026-07-01.',
            "I didn't catch the date. Try \"tomorrow\", \"next Monday\", or a date like 2026-07-01.",
          ),
          done: false,
        }
      }
      if (date < localNow.date) {
        return {
          nextState: { ...state, step: 'ask_date', preferredDate: undefined, preferredTime: undefined },
          reply: pick(
            L,
            'Esa fecha ya pasó. Elija uno de los horarios futuros disponibles.',
            'That date has already passed. Choose one of the available future times.',
          ),
          done: false,
        }
      }

      const provider = ctx.providers.find((p) => p.id === state.providerId)
      const availability = provider?.availability

      // A selected date is enough to query the chosen doctor's calendar. Present
      // only live, in-hours options instead of asking the patient to guess a time
      // and waiting for a rejection before showing availability.
      if (availability && hasAvailability(availability) && !worksOnDay(availability, date)) {
        const upcoming = await findUpcomingSlots(
          deps, date, availability, { days: 14, max: 3 }, ctx.clinic.timezone, now,
        )
        if (upcoming.length) {
          const opts = upcoming.map((slot) => `${slot.start.slice(0, 10)} ${slot.start.slice(11, 16)}`).join(', ')
          return {
            nextState: { ...state, step: 'ask_date', preferredDate: undefined, preferredTime: undefined },
            reply: pick(
              L,
              `${state.doctorName ?? 'El doctor'} no atiende ese día. Próximos horarios: ${opts}. ¿Qué día prefiere?`,
              `${state.doctorName ?? 'The doctor'} doesn't work that day. Next available: ${opts}. Which day works for you?`,
            ),
            done: false,
          }
        }
        return {
          nextState: { ...state, step: 'ask_date', preferredDate: undefined, preferredTime: undefined },
          reply: pick(
            L,
            `${state.doctorName ?? 'El doctor'} no atiende ese día. ¿Qué otro día prefiere?`,
            `${state.doctorName ?? 'The doctor'} doesn't work that day. Which other day do you prefer?`,
          ),
          done: false,
        }
      }

      const freeSlots = await deps.calendar.listSlots(date)
      const inHours = availability ? filterSlotsByAvailability(freeSlots, date, availability) : freeSlots
      const slots = futureSlots(inHours, ctx.clinic.timezone, now)
      const sameDay = slots.slice(0, 6).map((slot) => slot.start.slice(11, 16))
      if (sameDay.length === 0) {
        const upcoming = await findUpcomingSlots(
          deps, addDays(date, 1), availability, { days: 14, max: 4 }, ctx.clinic.timezone, now,
        )
        if (upcoming.length) {
          const opts = upcoming.map((slot) => `${slot.start.slice(0, 10)} ${slot.start.slice(11, 16)}`).join(', ')
          return {
            nextState: { ...state, step: 'ask_date', preferredDate: undefined, preferredTime: undefined },
            reply: pick(
              L,
              `No hay horarios libres el ${date}. Próximos disponibles: ${opts}. ¿Qué día prefiere?`,
              `No free times on ${date}. Next available: ${opts}. Which day works for you?`,
            ),
            done: false,
          }
        }
        return {
          nextState: { ...state, step: 'ask_date', preferredDate: undefined, preferredTime: undefined },
          reply: pick(
            L,
            `No encontré horarios con ${state.doctorName ?? 'ese doctor'} en las próximas dos semanas. Un miembro del equipo le ayudará.`,
            `I couldn't find any openings with ${state.doctorName ?? 'that doctor'} in the next two weeks. A team member will help you.`,
          ),
          done: true,
          handoff: true,
        }
      }

      return {
        nextState: { ...state, step: 'ask_time', preferredDate: date },
        reply: pick(
          L,
          `Horarios disponibles con ${state.doctorName ?? 'el doctor'} el ${date}: ${sameDay.join(', ')}. ¿Cuál prefiere?`,
          `Available times with ${state.doctorName ?? 'the doctor'} on ${date}: ${sameDay.join(', ')}. Which works for you?`,
        ),
        done: false,
      }
    }

    case 'ask_time':
    case 'check_availability': {
      const time = parseTime(message)
      const date = state.preferredDate
      if (!time || !date) {
        return {
          nextState: { ...state, step: 'ask_time' },
          reply: pick(L, '¿A qué hora le gustaría? (por ejemplo 10:00)', 'What time would you like? (e.g. 10:00)'),
          done: false,
        }
      }

      // Req 30: respect the chosen doctor's working hours. If they don't work the
      // requested weekday at all, send them back to pick another day rather than
      // listing the clinic's (irrelevant) free slots.
      const provider = ctx.providers.find((p) => p.id === state.providerId)
      const availability = provider?.availability
      if (availability && hasAvailability(availability) && !worksOnDay(availability, date)) {
        // CRE-49: don't dead-end — surface this doctor's next working slots.
        const upcoming = await findUpcomingSlots(
          deps, date, availability, { days: 14, max: 3 }, ctx.clinic.timezone, now,
        )
        if (upcoming.length) {
          const opts = upcoming.map((slot) => `${slot.start.slice(0, 10)} ${slot.start.slice(11, 16)}`).join(', ')
          return {
            nextState: { ...state, step: 'ask_date', preferredDate: undefined, preferredTime: undefined },
            reply: pick(
              L,
              `${state.doctorName ?? 'El doctor'} no atiende ese día. Próximos horarios: ${opts}. ¿Qué día prefiere?`,
              `${state.doctorName ?? 'The doctor'} doesn't work that day. Next available: ${opts}. Which day works for you?`,
            ),
            done: false,
          }
        }
        return {
          nextState: { ...state, step: 'ask_date', preferredDate: undefined, preferredTime: undefined },
          reply: pick(
            L,
            `${state.doctorName ?? 'El doctor'} no atiende ese día. ¿Qué otro día prefiere?`,
            `${state.doctorName ?? 'The doctor'} doesn't work that day. Which other day do you prefer?`,
          ),
          done: false,
        }
      }

      // Double-booking protection: only times that are actually free this day pass.
      // Then keep only slots inside the doctor's working hours (Req 30).
      const freeSlots = await deps.calendar.listSlots(date)
      const inHours = availability ? filterSlotsByAvailability(freeSlots, date, availability) : freeSlots
      const slots = futureSlots(inHours, ctx.clinic.timezone, now)
      const wantStart = slotStart(date, time)
      const match = slots.find((s) => s.start === wantStart)

      if (!match) {
        const sameDay = slots.slice(0, 4).map((s) => s.start.slice(11, 16))
        if (sameDay.length) {
          return {
            nextState: { ...state, step: 'ask_time', preferredTime: undefined },
            reply: pick(
              L,
              `Esa hora no está disponible. Horarios libres el ${date}: ${sameDay.join(', ')}. ¿Cuál prefiere?`,
              `That time isn't available. Free times on ${date}: ${sameDay.join(', ')}. Which works for you?`,
            ),
            done: false,
          }
        }
        // CRE-49: this day is fully booked — proactively offer the next open days.
        const upcoming = await findUpcomingSlots(
          deps, addDays(date, 1), availability, { days: 14, max: 4 }, ctx.clinic.timezone, now,
        )
        if (upcoming.length) {
          const opts = upcoming.map((slot) => `${slot.start.slice(0, 10)} ${slot.start.slice(11, 16)}`).join(', ')
          return {
            nextState: { ...state, step: 'ask_date', preferredDate: undefined, preferredTime: undefined },
            reply: pick(
              L,
              `No hay horarios libres el ${date}. Próximos disponibles: ${opts}. ¿Qué día prefiere?`,
              `No free times on ${date}. Next available: ${opts}. Which day works for you?`,
            ),
            done: false,
          }
        }
        return {
          nextState: { ...state, step: 'ask_date', preferredDate: undefined, preferredTime: undefined },
          reply: pick(
            L,
            `No encontré horarios con ${state.doctorName ?? 'ese doctor'} en las próximas dos semanas. Un miembro del equipo le ayudará.`,
            `I couldn't find any openings with ${state.doctorName ?? 'that doctor'} in the next two weeks. A team member will help you.`,
          ),
          done: true,
          handoff: true,
        }
      }

      return {
        nextState: { ...state, step: 'confirm_details', preferredTime: time, confirmedSlot: match },
        reply: pick(
          L,
          `Confirmo: ${state.doctorName} el ${date} a las ${time}. ¿Está correcto? (sí/no)`,
          `To confirm: ${state.doctorName} on ${date} at ${time}. Is that correct? (yes/no)`,
        ),
        done: false,
      }
    }

    case 'confirm_details':
    case 'create_event':
    case 'send_confirmation': {
      if (isNegative(message) && !isAffirmative(message)) {
        return {
          nextState: { ...state, step: 'ask_date', preferredTime: undefined, confirmedSlot: undefined },
          reply: pick(L, 'Sin problema. ¿Qué otro día prefiere? (AAAA-MM-DD)', 'No problem. Which other day do you prefer? (YYYY-MM-DD)'),
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
      if (!slot || !state.providerId || !state.preferredDate || !state.preferredTime) {
        // Defensive: lost state → restart date selection rather than book garbage.
        return {
          nextState: { ...state, step: 'ask_date' },
          reply: pick(L, '¿Qué día prefiere? (AAAA-MM-DD)', 'Which day do you prefer? (YYYY-MM-DD)'),
          done: false,
        }
      }

      const provider = ctx.providers.find((candidate) => candidate.id === state.providerId)
      const service = provider?.services?.find((candidate) => candidate.id === state.serviceId)
      if (!provider || !service) {
        return {
          nextState: {
            ...state,
            step: 'confirm_doctor',
            providerId: undefined,
            doctorName: undefined,
            specialty: undefined,
            serviceId: undefined,
            serviceName: undefined,
            preferredDate: undefined,
            preferredTime: undefined,
            confirmedSlot: undefined,
          },
          reply: pick(
            L,
            'El doctor o servicio seleccionado ya no está disponible. Elija otra opción.',
            'The selected doctor or service is no longer available. Choose another option.',
          ),
          done: false,
        }
      }
      const availability = provider?.availability
      const latest = await deps.calendar.listSlots(state.preferredDate)
      const inHours = availability
        ? filterSlotsByAvailability(latest, state.preferredDate, availability)
        : latest
      const stillAvailable = futureSlots(inHours, ctx.clinic.timezone, now)
        .some((candidate) => candidate.start === slot.start && candidate.end === slot.end)
      if (!stillAvailable) {
        return {
          nextState: {
            ...state,
            step: 'ask_date',
            preferredDate: undefined,
            preferredTime: undefined,
            confirmedSlot: undefined,
          },
          reply: pick(
            L,
            'Ese horario ya no está disponible. Elija otro horario futuro.',
            'That time is no longer available. Choose another future time.',
          ),
          done: false,
        }
      }

      const title = pick(
        L,
        `Cita: ${ctx.patientName ?? 'Paciente'} con ${state.doctorName}`,
        `Appointment: ${ctx.patientName ?? 'Patient'} with ${state.doctorName}`,
      )
      const eventId = await deps.calendar.createEvent({
        title,
        date: state.preferredDate,
        time: state.preferredTime,
        durationMinutes: duration,
        description: state.reason,
      })
      await deps.saveAppointment({
        providerId: state.providerId,
        doctorName: state.doctorName ?? null,
        specialty: state.specialty ?? null,
        serviceId: state.serviceId ?? null,
        startTime: slot.start,
        endTime: slot.end,
        reason: state.reason ?? '',
        preferredDate: state.preferredDate,
        preferredTime: state.preferredTime,
        googleEventId: eventId,
      })

      return {
        nextState: { ...state, step: 'send_confirmation', googleEventId: eventId },
        reply: pick(
          L,
          `¡Listo! Su cita con ${state.doctorName} quedó agendada para el ${state.preferredDate} a las ${state.preferredTime}. Le esperamos en ${ctx.clinic.name}.`,
          `Done! Your appointment with ${state.doctorName} is booked for ${state.preferredDate} at ${state.preferredTime}. We look forward to seeing you at ${ctx.clinic.name}.`,
        ),
        done: true,
      }
    }
  }
}
