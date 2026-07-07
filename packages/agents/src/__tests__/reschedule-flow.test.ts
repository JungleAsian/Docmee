import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  advanceRescheduleFlow,
  initialRescheduleState,
  type RescheduleContext,
  type RescheduleDeps,
  type RescheduleState,
} from '../calbot/reschedule-flow.js'
import type { CalendarOps, TimeSlot } from '../calbot/google-calendar-client.js'
import type { UpcomingAppointment } from '../calbot/shared.js'

const DATE = '2026-07-01' // a Wednesday

function slotsFor(times: string[]): TimeSlot[] {
  return times.map((t) => ({ start: `${DATE}T${t}:00`, end: `${DATE}T${t}:30` }))
}

function makeCalendar(over: Partial<CalendarOps> = {}): CalendarOps {
  return {
    listSlots: vi.fn().mockResolvedValue(slotsFor(['09:00', '10:00', '11:00', '14:00'])),
    createEvent: vi.fn().mockResolvedValue('evt_new'),
    updateEvent: vi.fn().mockResolvedValue(undefined),
    deleteEvent: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}

function makeDeps(calendar: CalendarOps): RescheduleDeps {
  return { calendar, applyReschedule: vi.fn().mockResolvedValue(undefined) }
}

const appointment: UpcomingAppointment = {
  id: 'appt-1',
  providerId: 'doc-1',
  providerName: 'Dra. García',
  date: '2026-06-25',
  time: '10:00',
  googleEventId: 'evt_old',
}

function baseCtx(over: Partial<RescheduleContext> = {}): RescheduleContext {
  return {
    language: 'es',
    clinic: { name: 'Clínica Demo', timezone: 'America/Guatemala' },
    appointment,
    ...over,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('advanceRescheduleFlow — base flow', () => {
  it('confirms the appointment, takes a new date+time and moves the event', async () => {
    const calendar = makeCalendar()
    const deps = makeDeps(calendar)
    const ctx = baseCtx()
    let state: RescheduleState = initialRescheduleState()

    let r = await advanceRescheduleFlow(state, 'sí', ctx, deps)
    expect(r.nextState.step).toBe('ask_date')
    state = r.nextState

    r = await advanceRescheduleFlow(state, `el ${DATE}`, ctx, deps)
    expect(r.nextState.step).toBe('ask_time')
    state = r.nextState

    r = await advanceRescheduleFlow(state, '11:00', ctx, deps)
    expect(r.nextState.step).toBe('confirm_details')
    state = r.nextState

    r = await advanceRescheduleFlow(state, 'sí, confirmo', ctx, deps)
    expect(r.done).toBe(true)
    expect(calendar.updateEvent).toHaveBeenCalledTimes(1)
    expect(deps.applyReschedule).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: 'appt-1', startTime: `${DATE}T11:00:00` }),
    )
  })
})

describe('advanceRescheduleFlow — per-doctor working hours (Req 30)', () => {
  // Doctor works Wednesday 09:00–12:00 only.
  const availability = { wed: [{ start: '09:00', end: '12:00' }] }

  it('rejects a time outside the doctor hours and offers only in-hours alternatives', async () => {
    const calendar = makeCalendar() // free: 09:00, 10:00, 11:00, 14:00
    const deps = makeDeps(calendar)
    const ctx = baseCtx({ availability })
    const state: RescheduleState = { step: 'ask_time', appointmentId: 'appt-1', preferredDate: DATE }

    const r = await advanceRescheduleFlow(state, '14:00', ctx, deps)
    expect(r.done).toBe(false)
    expect(r.nextState.step).toBe('ask_time')
    expect(r.reply).toMatch(/09:00/)
    expect(r.reply).toMatch(/11:00/)
    expect(r.reply).not.toMatch(/14:00/) // outside the doctor's hours
    expect(deps.applyReschedule).not.toHaveBeenCalled()
  })

  it('accepts a time inside the doctor hours', async () => {
    const calendar = makeCalendar()
    const deps = makeDeps(calendar)
    const ctx = baseCtx({ availability })
    const state: RescheduleState = { step: 'ask_time', appointmentId: 'appt-1', preferredDate: DATE }

    const r = await advanceRescheduleFlow(state, '11:00', ctx, deps)
    expect(r.nextState.step).toBe('confirm_details')
    expect(r.nextState.confirmedSlot?.start).toBe(`${DATE}T11:00:00`)
  })

  it('sends the patient back to pick another day when the doctor is off that day', async () => {
    const calendar = makeCalendar()
    const deps = makeDeps(calendar)
    const ctx = baseCtx({ availability })
    // 2026-07-04 is a Saturday; the doctor only works Wednesday.
    const state: RescheduleState = { step: 'ask_time', appointmentId: 'appt-1', preferredDate: '2026-07-04' }

    const r = await advanceRescheduleFlow(state, '10:00', ctx, deps)
    expect(r.done).toBe(false)
    expect(r.nextState.step).toBe('ask_date')
    expect(r.nextState.preferredDate).toBeUndefined()
    expect(calendar.listSlots).not.toHaveBeenCalled() // no point checking the calendar
    expect(deps.applyReschedule).not.toHaveBeenCalled()
  })

  it('imposes no restriction when the doctor has no hours configured (back-compat)', async () => {
    const calendar = makeCalendar()
    const deps = makeDeps(calendar)
    const ctx = baseCtx() // no availability
    const state: RescheduleState = { step: 'ask_time', appointmentId: 'appt-1', preferredDate: DATE }

    // 14:00 is free and accepted because no per-doctor hours apply.
    const r = await advanceRescheduleFlow(state, '14:00', ctx, deps)
    expect(r.nextState.step).toBe('confirm_details')
    expect(r.nextState.confirmedSlot?.start).toBe(`${DATE}T14:00:00`)
  })
})

describe('advanceRescheduleFlow — service duration (Req 30)', () => {
  it('preserves the service length for the moved appointment instead of the 30-min grid', async () => {
    const calendar = makeCalendar()
    const deps = makeDeps(calendar)
    const ctx = baseCtx({ serviceDurationMinutes: 45 })
    const state: RescheduleState = {
      step: 'confirm_details',
      appointmentId: 'appt-1',
      preferredDate: DATE,
      preferredTime: '11:00',
      confirmedSlot: { start: `${DATE}T11:00:00`, end: `${DATE}T11:30:00` },
    }

    const r = await advanceRescheduleFlow(state, 'sí', ctx, deps)
    expect(r.done).toBe(true)
    // The calendar event is moved with the 45-min duration...
    expect((calendar.updateEvent as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
      durationMinutes: 45,
    })
    // ...and the appointment row's end time reflects 45 minutes, not the grid's 30.
    expect(deps.applyReschedule).toHaveBeenCalledWith(
      expect.objectContaining({ startTime: `${DATE}T11:00:00`, endTime: `${DATE}T11:45:00` }),
    )
  })
})
