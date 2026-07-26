import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  advanceBookingFlow,
  initialBookingState,
  type BookingContext,
  type BookingDeps,
  type BookingState,
} from '../calbot/booking-flow.js'
import type { CalendarOps, TimeSlot } from '../calbot/google-calendar-client.js'

const DATE = '2026-07-01'

function slotsFor(times: string[]): TimeSlot[] {
  return times.map((t) => ({ start: `${DATE}T${t}:00`, end: `${DATE}T${t}:30` }))
}

function makeCalendar(over: Partial<CalendarOps> = {}): CalendarOps {
  return {
    listSlots: vi.fn().mockResolvedValue(slotsFor(['09:00', '10:00', '10:30'])),
    createEvent: vi.fn().mockResolvedValue('evt_123'),
    updateEvent: vi.fn().mockResolvedValue(undefined),
    deleteEvent: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}

function makeDeps(calendar: CalendarOps): BookingDeps {
  return { calendar, saveAppointment: vi.fn().mockResolvedValue(undefined) }
}

const ctx: BookingContext = {
  language: 'es',
  clinic: { name: 'Clínica Demo', timezone: 'America/Guatemala' },
  providers: [{
    id: 'prov-1',
    fullName: 'Dra. García',
    specialty: 'Pediatría',
    services: [{ id: 's1', name: 'Consulta general', durationMinutes: 30 }],
  }],
  patientName: 'Ana',
  now: new Date('2026-07-01T12:00:00Z'),
}

beforeEach(() => vi.clearAllMocks())

describe('advanceBookingFlow (LLM_STUB)', () => {
  beforeEach(() => {
    process.env['LLM_STUB'] = 'true'
  })

  it('advances through all 8 steps and books the appointment', async () => {
    const calendar = makeCalendar()
    const deps = makeDeps(calendar)
    let state: BookingState = initialBookingState()

    // confirm_doctor presents the available-doctor picker.
    let r = await advanceBookingFlow(state, 'quiero una cita', ctx, deps)
    expect(r.nextState.step).toBe('confirm_doctor')
    expect(r.reply).toContain('1. Dra. García')
    expect(r.reply).toContain('Pediatría')
    state = r.nextState

    // The patient may choose by list number.
    r = await advanceBookingFlow(state, '1', ctx, deps)
    expect(r.nextState.step).toBe('ask_service')
    expect(r.nextState.providerId).toBe('prov-1')
    state = r.nextState

    r = await advanceBookingFlow(state, '1', ctx, deps)
    expect(r.nextState.step).toBe('ask_reason')
    state = r.nextState

    // ask_reason → ask_date
    r = await advanceBookingFlow(state, 'control general', ctx, deps)
    expect(r.nextState.step).toBe('ask_date')
    expect(r.nextState.reason).toBe('control general')
    expect(r.reply).toContain('próximos 5 días')
    expect(r.reply).not.toContain('¿Qué día prefiere?')
    state = r.nextState

    // ask_date → ask_time
    r = await advanceBookingFlow(state, `el ${DATE}`, ctx, deps)
    expect(r.nextState.step).toBe('ask_time')
    expect(r.nextState.preferredDate).toBe(DATE)
    expect(r.reply).toContain('09:00')
    expect(r.reply).toContain('10:00')
    expect(r.reply).not.toContain('¿A qué hora le gustaría?')
    expect(calendar.listSlots).toHaveBeenCalledWith(DATE)
    state = r.nextState

    // ask_time → check availability → confirm_details
    r = await advanceBookingFlow(state, '10:00', ctx, deps)
    expect(r.nextState.step).toBe('confirm_details')
    expect(r.nextState.confirmedSlot?.start).toBe(`${DATE}T10:00:00`)
    state = r.nextState

    // confirm_details → creates event + persists + confirmation
    r = await advanceBookingFlow(state, 'sí, confirmo', ctx, deps)
    expect(r.done).toBe(true)
    expect(r.nextState.googleEventId).toBe('evt_123')
    expect(calendar.createEvent).toHaveBeenCalledTimes(1)
    expect(deps.saveAppointment).toHaveBeenCalledTimes(1)
    // Req 10: the full intake collected during the flow is handed to the worker —
    // doctor + specialty, the reason, and the patient's preferred date/time.
    expect((deps.saveAppointment as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
      providerId: 'prov-1',
      doctorName: 'Dra. García',
      specialty: 'Pediatría',
      reason: 'control general',
      preferredDate: DATE,
      preferredTime: '10:00',
      startTime: `${DATE}T10:00:00`,
      googleEventId: 'evt_123',
    })
  })

  it('shows calendar-derived options for each of the next five days after the reason', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-01T12:00:00Z'))
      const calendar = makeCalendar({
        listSlots: vi.fn().mockImplementation(async (date: string) => {
          if (date === '2026-07-02') {
            return [
              { start: `${date}T09:00:00`, end: `${date}T09:30:00` },
              { start: `${date}T09:30:00`, end: `${date}T10:00:00` },
            ]
          }
          if (date === '2026-07-04') {
            return [{ start: `${date}T11:00:00`, end: `${date}T11:30:00` }]
          }
          return []
        }),
      })
      const deps = makeDeps(calendar)
      const state: BookingState = {
        step: 'ask_reason',
        providerId: 'prov-1',
        doctorName: 'Doctor',
      }
      const englishCtx: BookingContext = {
        ...ctx,
        language: 'en',
        clinic: { ...ctx.clinic, timezone: 'UTC' },
      }

      const r = await advanceBookingFlow(state, 'Routine consultation', englishCtx, deps)

      expect(r.nextState.step).toBe('ask_date')
      expect(r.reply).toContain('Available options with Doctor during the next 5 days')
      expect(r.reply).toContain('2026-07-02: 09:00, 09:30')
      expect(r.reply).toContain('2026-07-04: 11:00')
      expect(r.reply).not.toContain('Which day do you prefer?')
      expect(calendar.listSlots).toHaveBeenCalledTimes(5)
      expect((calendar.listSlots as ReturnType<typeof vi.fn>).mock.calls.map(([date]) => date)).toEqual([
        '2026-07-01',
        '2026-07-02',
        '2026-07-03',
        '2026-07-04',
        '2026-07-05',
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('lists multiple providers and accepts a numbered doctor choice', async () => {
    const calendar = makeCalendar()
    const deps = makeDeps(calendar)
    const multi: BookingContext = {
      ...ctx,
      providers: [
        { id: 'prov-1', fullName: 'Dra. García', services: [{ id: 's1', name: 'Consulta', durationMinutes: 30 }] },
        { id: 'prov-2', fullName: 'Dr. López', services: [{ id: 's2', name: 'Consulta', durationMinutes: 30 }] },
      ],
    }
    let r = await advanceBookingFlow(initialBookingState(), 'hola', multi, deps)
    expect(r.nextState.step).toBe('confirm_doctor')
    expect(r.reply).toContain('1. Dra. García')
    expect(r.reply).toContain('2. Dr. López')

    r = await advanceBookingFlow(r.nextState, '2', multi, deps)
    expect(r.nextState.step).toBe('ask_service')
    expect(r.nextState.providerId).toBe('prov-2')
  })

  it('re-prompts when the doctor choice is not recognised', async () => {
    const deps = makeDeps(makeCalendar())
    const prompted = await advanceBookingFlow(initialBookingState(), 'hola', ctx, deps)
    const r = await advanceBookingFlow(prompted.nextState, 'doctor desconocido', ctx, deps)
    expect(r.nextState.step).toBe('confirm_doctor')
    expect(r.reply).toContain('1. Dra. García')
  })
})

describe('per-doctor working hours (Req 30)', () => {
  // 2026-07-01 is a Wednesday. The doctor works Wed 09:00–12:00 only.
  const provider = {
    id: 'prov-1',
    fullName: 'Dra. García',
    specialty: 'Pediatría',
    availability: { wed: [{ start: '09:00', end: '12:00' }] },
    services: [{ id: 's1', name: 'Consulta', durationMinutes: 30 }],
  }
  const hoursCtx: BookingContext = { ...ctx, providers: [provider] }

  it('offers only the doctor in-hours slots as soon as the date is chosen', async () => {
    const calendar = makeCalendar({ listSlots: vi.fn().mockResolvedValue(slotsFor(['09:00', '11:00', '14:00'])) })
    const deps = makeDeps(calendar)
    const state: BookingState = {
      step: 'ask_date',
      providerId: 'prov-1',
      doctorName: 'Doctor',
      reason: 'control',
    }
    const r = await advanceBookingFlow(state, DATE, hoursCtx, deps)
    expect(r.nextState.step).toBe('ask_time')
    expect(r.nextState.preferredDate).toBe(DATE)
    expect(r.reply).toContain('09:00')
    expect(r.reply).toContain('11:00')
    expect(r.reply).not.toContain('14:00')
    expect(calendar.listSlots).toHaveBeenCalledWith(DATE)
  })

  it('rejects a time outside the doctor hours and offers in-hours alternatives', async () => {
    // The clinic calendar reports 10:00 booked, but 09:00, 11:00 and 14:00 free.
    // 14:00 is outside the doctor's hours and must NOT be offered.
    const calendar = makeCalendar({ listSlots: vi.fn().mockResolvedValue(slotsFor(['09:00', '11:00', '14:00'])) })
    const deps = makeDeps(calendar)
    const state: BookingState = {
      step: 'ask_time',
      providerId: 'prov-1',
      doctorName: 'Dra. García',
      reason: 'control',
      preferredDate: DATE,
    }
    const r = await advanceBookingFlow(state, '14:00', hoursCtx, deps)
    expect(r.done).toBe(false)
    expect(r.nextState.step).toBe('ask_time')
    expect(r.reply).toMatch(/09:00/)
    expect(r.reply).toMatch(/11:00/)
    expect(r.reply).not.toMatch(/14:00/)
    expect(deps.saveAppointment).not.toHaveBeenCalled()
  })

  it('books a time that falls inside the doctor hours', async () => {
    const calendar = makeCalendar({ listSlots: vi.fn().mockResolvedValue(slotsFor(['09:00', '11:00', '14:00'])) })
    const deps = makeDeps(calendar)
    const state: BookingState = {
      step: 'ask_time',
      providerId: 'prov-1',
      doctorName: 'Dra. García',
      reason: 'control',
      preferredDate: DATE,
    }
    const r = await advanceBookingFlow(state, '11:00', hoursCtx, deps)
    expect(r.nextState.step).toBe('confirm_details')
    expect(r.nextState.confirmedSlot?.start).toBe(`${DATE}T11:00:00`)
  })

  it('sends the patient back to pick another day when the doctor is off that day', async () => {
    const calendar = makeCalendar()
    const deps = makeDeps(calendar)
    // Doctor works Wed only; ask for 2026-07-04 (a Saturday).
    const state: BookingState = {
      step: 'ask_time',
      providerId: 'prov-1',
      doctorName: 'Dra. García',
      reason: 'control',
      preferredDate: '2026-07-04',
    }
    const r = await advanceBookingFlow(state, '10:00', hoursCtx, deps)
    expect(r.done).toBe(false)
    expect(r.nextState.step).toBe('ask_date')
    expect(r.nextState.preferredDate).toBeUndefined()
    // CRE-49: the off-day branch now scans forward for this doctor's next openings.
    expect(calendar.listSlots).toHaveBeenCalled()
    expect(deps.saveAppointment).not.toHaveBeenCalled()
  })

  it('offers the next open days when the requested day is fully booked (CRE-49)', async () => {
    const free: TimeSlot[] = [{ start: '2026-07-02T09:00:00', end: '2026-07-02T09:30:00' }]
    // Requested day has no free slots; the following day does.
    const listSlots = vi.fn().mockImplementation((d: string) => Promise.resolve(d === '2026-07-02' ? free : []))
    const calendar = makeCalendar({ listSlots })
    const deps = makeDeps(calendar)
    const state: BookingState = {
      step: 'ask_time',
      providerId: 'prov-1',
      doctorName: 'Dra. García',
      reason: 'control',
      preferredDate: DATE,
    }
    const r = await advanceBookingFlow(state, '10:00', ctx, deps)
    expect(r.done).toBe(false)
    expect(r.nextState.step).toBe('ask_date')
    expect(r.nextState.preferredDate).toBeUndefined()
    expect(r.reply).toContain('2026-07-02') // surfaced the next open day
    expect(listSlots).toHaveBeenCalledWith(DATE)
    expect(deps.saveAppointment).not.toHaveBeenCalled()
  })
})

describe('per-doctor services (Req 30)', () => {
  const twoServices = [
    { id: 's1', name: 'Consulta general', durationMinutes: 30 },
    { id: 's2', name: 'Limpieza dental', durationMinutes: 45 },
  ]

  async function walkToBooking(servicesCtx: BookingContext, serviceReply: string | null) {
    const calendar = makeCalendar()
    const deps = makeDeps(calendar)
    let state: BookingState = initialBookingState()

    // Choose the available doctor before continuing to service/reason.
    let r = await advanceBookingFlow(state, 'quiero una cita', servicesCtx, deps)
    r = await advanceBookingFlow(r.nextState, '1', servicesCtx, deps)
    state = r.nextState

    if (serviceReply !== null) {
      // The flow asked which service; answer it.
      expect(state.step).toBe('ask_service')
      r = await advanceBookingFlow(state, serviceReply, servicesCtx, deps)
      state = r.nextState
    }
    expect(state.step).toBe('ask_reason')

    r = await advanceBookingFlow(state, 'control general', servicesCtx, deps)
    state = r.nextState
    r = await advanceBookingFlow(state, `el ${DATE}`, servicesCtx, deps)
    state = r.nextState
    r = await advanceBookingFlow(state, '10:00', servicesCtx, deps)
    state = r.nextState
    r = await advanceBookingFlow(state, 'sí, confirmo', servicesCtx, deps)
    return { result: r, calendar, deps }
  }

  it('asks which service when the doctor offers several, then books with that service duration', async () => {
    const multiCtx: BookingContext = {
      ...ctx,
      providers: [{ id: 'prov-1', fullName: 'Dra. García', specialty: 'Pediatría', services: twoServices }],
    }
    const { result, calendar, deps } = await walkToBooking(multiCtx, 'limpieza')
    expect(result.done).toBe(true)
    // 45-minute service duration is used for the calendar event (not the 30 default).
    expect((calendar.createEvent as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
      durationMinutes: 45,
    })
    expect((deps.saveAppointment as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
      serviceId: 's2',
    })
  })

  it('matches the service by its list number', async () => {
    const multiCtx: BookingContext = {
      ...ctx,
      providers: [{ id: 'prov-1', fullName: 'Dra. García', services: twoServices }],
    }
    const { deps } = await walkToBooking(multiCtx, '1')
    expect((deps.saveAppointment as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
      serviceId: 's1',
    })
  })

  it('re-prompts when the service reply is not recognised', async () => {
    const multiCtx: BookingContext = {
      ...ctx,
      providers: [{ id: 'prov-1', fullName: 'Dra. García', services: twoServices }],
    }
    const deps = makeDeps(makeCalendar())
    let r = await advanceBookingFlow(initialBookingState(), 'cita', multiCtx, deps)
    r = await advanceBookingFlow(r.nextState, '1', multiCtx, deps)
    r = await advanceBookingFlow(r.nextState, 'algo que no existe', multiCtx, deps)
    expect(r.nextState.step).toBe('ask_service')
    expect(r.reply).toContain('Consulta general')
  })

  it('presents a single enabled service and books it after selection', async () => {
    const oneCtx: BookingContext = {
      ...ctx,
      providers: [{ id: 'prov-1', fullName: 'Dra. García', services: [{ id: 's1', name: 'Consulta', durationMinutes: 20 }] }],
    }
    const { result, calendar, deps } = await walkToBooking(oneCtx, '1')
    expect(result.done).toBe(true)
    expect((calendar.createEvent as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
      durationMinutes: 20,
    })
    expect((deps.saveAppointment as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
      serviceId: 's1',
    })
  })

  it('hands off when the selected doctor has no enabled services', async () => {
    const noneCtx: BookingContext = {
      ...ctx,
      providers: [{ id: 'prov-1', fullName: 'Dra. García', services: [] }],
    }
    const deps = makeDeps(makeCalendar())
    const prompted = await advanceBookingFlow(initialBookingState(), 'cita', noneCtx, deps)
    const result = await advanceBookingFlow(prompted.nextState, '1', noneCtx, deps)
    expect(result.done).toBe(true)
    expect(result.handoff).toBe(true)
    expect(result.reply).toContain('no tiene servicios habilitados')
  })

  it('revalidates the doctor and enabled service immediately before confirmation', async () => {
    const calendar = makeCalendar()
    const deps = makeDeps(calendar)
    const state: BookingState = {
      step: 'confirm_details',
      providerId: 'prov-1',
      doctorName: 'Dra. García',
      serviceId: 's1',
      serviceName: 'Consulta general',
      serviceDurationMinutes: 30,
      preferredDate: DATE,
      preferredTime: '10:00',
      confirmedSlot: {
        start: `${DATE}T10:00:00`,
        end: `${DATE}T10:30:00`,
      },
    }
    const disabledCtx: BookingContext = { ...ctx, providers: [] }
    const result = await advanceBookingFlow(state, 'sí', disabledCtx, deps)

    expect(result.done).toBe(false)
    expect(result.nextState.step).toBe('confirm_doctor')
    expect(result.reply).toContain('ya no está disponible')
    expect(calendar.createEvent).not.toHaveBeenCalled()
    expect(deps.saveAppointment).not.toHaveBeenCalled()
  })
})

describe('double-booking protection', () => {
  it('detects a conflict and offers alternative slots', async () => {
    // The requested 10:00 is NOT free; only 09:00 and 11:00 are.
    const calendar = makeCalendar({ listSlots: vi.fn().mockResolvedValue(slotsFor(['09:00', '11:00'])) })
    const deps = makeDeps(calendar)
    const state: BookingState = {
      step: 'ask_time',
      providerId: 'prov-1',
      doctorName: 'Dra. García',
      reason: 'control',
      preferredDate: DATE,
    }
    const r = await advanceBookingFlow(state, '10:00', ctx, deps)
    expect(r.done).toBe(false)
    expect(r.nextState.step).toBe('ask_time')
    expect(r.reply).toMatch(/09:00/)
    expect(r.reply).toMatch(/11:00/)
    expect(calendar.createEvent).not.toHaveBeenCalled()
    expect(deps.saveAppointment).not.toHaveBeenCalled()
  })
})
