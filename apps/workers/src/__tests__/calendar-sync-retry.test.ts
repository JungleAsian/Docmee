import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('decideCalendarSyncAction (pure)', () => {
  it('cancelled with a lingering Calendar event → delete', () => {
    expect(decideCalendarSyncAction({ status: 'cancelled', googleEventId: 'evt_1' })).toBe('delete')
  })
  it('cancelled with no Calendar event → nothing to do', () => {
    expect(decideCalendarSyncAction({ status: 'cancelled', googleEventId: null })).toBe('none')
  })
  it('active appointment with no Calendar event yet → create', () => {
    expect(decideCalendarSyncAction({ status: 'confirmed', googleEventId: null })).toBe('create')
  })
  it('active appointment with an existing Calendar event → update', () => {
    expect(decideCalendarSyncAction({ status: 'confirmed', googleEventId: 'evt_1' })).toBe('update')
  })
})

const h = vi.hoisted(() => ({
  listCandidates: vi.fn(),
  updateAppt: vi.fn(),
  findClinic: vi.fn(),
  resolveCalendarConfig: vi.fn(),
}))

vi.mock('@docmee/db', () => ({
  createAppointmentsRepository: () => ({
    listCalendarSyncCandidates: h.listCandidates,
    update: h.updateAppt,
  }),
  createClinicsRepository: () => ({ findById: h.findClinic }),
}))

vi.mock('@docmee/agents', () => ({
  resolveCalendarConfig: h.resolveCalendarConfig,
  calendarOpsFor: (resolved: unknown) => (resolved ? (resolved as { ops: unknown }).ops : null),
  formatCalendarBooking: (details: {
    serviceName?: string | null
    patientName?: string | null
    patientPhone?: string | null
    patientEmail?: string | null
    reason?: string | null
  }) => ({
    title: `${details.serviceName?.trim() || 'Clinic appointment'} - ${details.patientName?.trim() || 'Patient'}`,
    description: `Details:\nPatient phone: ${details.patientPhone?.trim() || 'Not provided'}\nPatient email: ${details.patientEmail?.trim() || 'Not provided'}\nReason for visit: ${
      details.reason?.trim() || 'Not provided'
    }`,
  }),
}))

import { decideCalendarSyncAction, runCalendarSyncRetry } from '../calendar-sync-retry.js'

function candidate(over: Record<string, unknown> = {}) {
  return {
    id: 'appt-1',
    clinicId: 'clinic-1',
    doctorId: null,
    status: 'confirmed',
    googleEventId: null,
    startTime: '2026-07-01T09:00:00',
    endTime: '2026-07-01T09:30:00',
    patientName: 'Ana',
    patientPhone: '+50255550199',
    patientEmail: 'ana@example.com',
    doctorName: null,
    calendarSyncAttempts: 0,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.updateAppt.mockResolvedValue(undefined)
})

describe('runCalendarSyncRetry', () => {
  it.each([null, 'event-existing'])('retries the appointment at its clinic-local time (event %s)', async (googleEventId) => {
    const createEvent = vi.fn().mockResolvedValue('new-event')
    const updateEvent = vi.fn().mockResolvedValue(undefined)
    h.listCandidates.mockResolvedValue([candidate({ googleEventId, startTime: '2026-07-01T15:00:00.000Z', endTime: '2026-07-01T15:30:00.000Z' })])
    h.findClinic.mockResolvedValue({ id: 'clinic-1', settings: {}, timezone: 'America/Guatemala' })
    h.resolveCalendarConfig.mockResolvedValue({ ops: { createEvent, updateEvent, deleteEvent: vi.fn() } })
    await runCalendarSyncRetry({} as never)
    expect(googleEventId ? updateEvent : createEvent).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-07-01', time: '09:00' }))
  })

  it('no calendar connected yet → row stays pending, no error recorded, no crash', async () => {
    h.listCandidates.mockResolvedValue([candidate()])
    h.findClinic.mockResolvedValue({ id: 'clinic-1', settings: {}, timezone: 'America/Guatemala' })
    h.resolveCalendarConfig.mockResolvedValue(null)

    await runCalendarSyncRetry({} as never)

    expect(h.updateAppt).not.toHaveBeenCalled()
  })

  it('calendar connected, create succeeds → googleEventId set, pending cleared', async () => {
    const createEvent = vi.fn().mockResolvedValue('evt_new')
    h.listCandidates.mockResolvedValue([candidate()])
    h.findClinic.mockResolvedValue({ id: 'clinic-1', settings: {}, timezone: 'America/Guatemala' })
    h.resolveCalendarConfig.mockResolvedValue({ ops: { createEvent, updateEvent: vi.fn(), deleteEvent: vi.fn() } })

    await runCalendarSyncRetry({} as never)

    expect(createEvent).toHaveBeenCalledTimes(1)
    expect(h.updateAppt).toHaveBeenCalledWith('clinic-1', 'appt-1', {
      googleEventId: 'evt_new',
      calendarSyncPending: false,
      calendarSyncError: null,
    })
  })

  it('cancelled row with a lingering event → deletes it and clears googleEventId', async () => {
    const deleteEvent = vi.fn().mockResolvedValue(undefined)
    h.listCandidates.mockResolvedValue([candidate({ status: 'cancelled', googleEventId: 'evt_old' })])
    h.findClinic.mockResolvedValue({ id: 'clinic-1', settings: {}, timezone: 'America/Guatemala' })
    h.resolveCalendarConfig.mockResolvedValue({ ops: { createEvent: vi.fn(), updateEvent: vi.fn(), deleteEvent } })

    await runCalendarSyncRetry({} as never)

    expect(deleteEvent).toHaveBeenCalledWith('evt_old')
    expect(h.updateAppt).toHaveBeenCalledWith('clinic-1', 'appt-1', {
      googleEventId: null,
      calendarSyncPending: false,
      calendarSyncError: null,
    })
  })

  it('existing event update refreshes the complete patient contact description', async () => {
    const updateEvent = vi.fn().mockResolvedValue(undefined)
    h.listCandidates.mockResolvedValue([candidate({ googleEventId: 'evt_existing' })])
    h.findClinic.mockResolvedValue({ id: 'clinic-1', settings: {}, timezone: 'America/Guatemala' })
    h.resolveCalendarConfig.mockResolvedValue({ ops: { createEvent: vi.fn(), updateEvent, deleteEvent: vi.fn() } })

    await runCalendarSyncRetry({} as never)

    expect(updateEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'evt_existing',
      description: expect.stringContaining('Patient email: ana@example.com'),
    }))
  })

  it('cancelled row with no event at all → marked synced without touching Calendar', async () => {
    h.listCandidates.mockResolvedValue([candidate({ status: 'cancelled', googleEventId: null })])

    await runCalendarSyncRetry({} as never)

    expect(h.findClinic).not.toHaveBeenCalled()
    expect(h.updateAppt).toHaveBeenCalledWith('clinic-1', 'appt-1', {
      calendarSyncPending: false,
      calendarSyncError: null,
    })
  })

  it('a throwing row records the error and does not abort the rest of the batch', async () => {
    const createEvent = vi.fn().mockRejectedValue(new Error('quota exceeded'))
    const secondCreate = vi.fn().mockResolvedValue('evt_ok')
    h.listCandidates.mockResolvedValue([
      candidate({ id: 'appt-broken' }),
      candidate({ id: 'appt-2', clinicId: 'clinic-2' }),
    ])
    h.findClinic.mockImplementation(async (id: string) => ({ id, settings: {}, timezone: 'America/Guatemala' }))
    h.resolveCalendarConfig
      .mockResolvedValueOnce({ ops: { createEvent, updateEvent: vi.fn(), deleteEvent: vi.fn() } })
      .mockResolvedValueOnce({ ops: { createEvent: secondCreate, updateEvent: vi.fn(), deleteEvent: vi.fn() } })

    await runCalendarSyncRetry({} as never)

    expect(h.updateAppt).toHaveBeenCalledWith('clinic-1', 'appt-broken', {
      calendarSyncError: 'quota exceeded',
      calendarSyncAttempts: 1,
    })
    // The second row still gets processed despite the first one throwing.
    expect(secondCreate).toHaveBeenCalledTimes(1)
    expect(h.updateAppt).toHaveBeenCalledWith('clinic-2', 'appt-2', {
      googleEventId: 'evt_ok',
      calendarSyncPending: false,
      calendarSyncError: null,
    })
  })
})
