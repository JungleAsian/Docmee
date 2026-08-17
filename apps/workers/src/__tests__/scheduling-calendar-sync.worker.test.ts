import { describe, it, expect, vi, beforeEach } from 'vitest'

// The DB-first redesign: booking-flow.ts now catches a Google Calendar failure
// itself and always calls saveAppointment (with googleEventId: null and a
// calendarSyncError) instead of throwing. This verifies the WORKER-level wiring
// that receives that signal and persists it correctly — no human handoff, no
// error_reviews entry, the appointment update carries the right sync fields.
// (The pure flow behavior itself — that booking-flow.ts catches the error and
// still calls saveAppointment — is covered by packages/agents' booking-flow.test.ts.)

const h = vi.hoisted(() => ({
  advanceBookingFlow: vi.fn(),
  advanceRescheduleFlow: vi.fn(),
  advanceCancelFlow: vi.fn(),
  createGoogleCalendarOps: vi.fn(),
  sendWhatsAppText: vi.fn(),
  notificationAdd: vi.fn(),
  findClinic: vi.fn(),
  listAccounts: vi.fn(),
  findPatient: vi.fn(),
  findConversation: vi.fn(),
  updateConversation: vi.fn(),
  listProviders: vi.fn(),
  listByPatient: vi.fn(),
  listDoctors: vi.fn(),
  createAppt: vi.fn(),
  updateAppt: vi.fn(),
  addEvent: vi.fn(),
  createTag: vi.fn(),
  addTag: vi.fn(),
  createError: vi.fn(),
  createMessage: vi.fn(),
  markProviderAccepted: vi.fn(),
  markSendFailed: vi.fn(),
  end: vi.fn(),
}))

vi.mock('@docmee/shared', () => ({
  decryptValue: (v: string) => `dec:${v}`,
  encryptValue: (v: string) => `enc:${v}`,
}))

vi.mock('@docmee/agents', () => ({
  detectLanguage: () => 'es',
  createGoogleCalendarOps: h.createGoogleCalendarOps,
  advanceBookingFlow: h.advanceBookingFlow,
  initialBookingState: () => ({ step: 'start' }),
  advanceRescheduleFlow: h.advanceRescheduleFlow,
  initialRescheduleState: () => ({}),
  advanceCancelFlow: h.advanceCancelFlow,
  initialCancelState: () => ({}),
  buildStatusReply: vi.fn(),
  normalizeAvailability: () => ({}),
}))

vi.mock('@docmee/channels', () => ({ sendWhatsAppText: h.sendWhatsAppText }))

vi.mock('@docmee/queue', () => ({
  notificationQueue: { add: h.notificationAdd },
  schedulingQueue: { add: vi.fn() },
}))

// Out of scope here — stub the producers so only the sync-flag wiring is tested.
vi.mock('../follow-up.js', () => ({
  scheduleAppointmentFollowUps: vi.fn(),
  scheduleNoResponseFollowUp: vi.fn(),
}))

vi.mock('../crm.js', () => ({
  createClinicCrmExporter: () => null,
  patientPhone: (_p: unknown, fallback: string) => fallback,
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: h.end }),
  createClinicsRepository: () => ({ findById: h.findClinic, update: vi.fn() }),
  createPatientsRepository: () => ({ findById: h.findPatient, update: vi.fn() }),
  createConversationsRepository: () => ({
    findById: h.findConversation,
    update: h.updateConversation,
    createTag: h.createTag,
    addTag: h.addTag,
  }),
  createAppointmentsRepository: () => ({
    listProviders: h.listProviders,
    listByPatient: h.listByPatient,
    create: h.createAppt,
    update: h.updateAppt,
    addEvent: h.addEvent,
  }),
  createChannelAccountsRepository: () => ({ listByClinic: h.listAccounts }),
  createMessagesRepository: () => ({
    create: h.createMessage,
    markProviderAccepted: h.markProviderAccepted,
    markSendFailed: h.markSendFailed,
  }),
  createDoctorsRepository: () => ({ listByClinic: h.listDoctors }),
  createErrorReviewsRepository: () => ({ create: h.createError }),
}))

import { processSchedulingJob } from '../scheduling-processor.worker.js'

const CLINIC = '11111111-1111-1111-1111-111111111111'
const CONVO = '33333333-3333-3333-3333-333333333333'
const PATIENT = '44444444-4444-4444-4444-444444444444'
const makeJob = (data: unknown) => ({ data }) as never

const bookJob = {
  clinicId: CLINIC,
  patientWaId: '5215555555555',
  message: 'sí, confirmo',
  waMessageId: 'wamid.ABC',
  patientId: PATIENT,
  conversationId: CONVO,
  action: 'book' as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.findClinic.mockResolvedValue({
    id: CLINIC,
    name: 'Clinica Sol',
    timezone: 'America/Mexico_City',
    settings: { googleCalendar: { accessToken: 'a', refreshToken: 'r' } },
  })
  h.listAccounts.mockResolvedValue([
    { channel: 'whatsapp', status: 'active', accountId: 'PHONE', accessTokenEnc: 'tok' },
  ])
  h.findPatient.mockResolvedValue({ id: PATIENT, fullName: 'Ana', metadata: { source: 'whatsapp' } })
  h.findConversation.mockResolvedValue({ id: CONVO, metadata: {} })
  h.listProviders.mockResolvedValue([{ id: 'p1', fullName: 'Dr. X', specialty: 'General' }])
  h.listByPatient.mockResolvedValue([])
  h.listDoctors.mockResolvedValue([]) // legacy provider mode → clinic calendar
  h.createAppt.mockResolvedValue({ id: 'appt-1' })
  h.createMessage.mockResolvedValue({ id: 'm1' })
  h.markProviderAccepted.mockResolvedValue(undefined)
  h.markSendFailed.mockResolvedValue(undefined)
  h.sendWhatsAppText.mockResolvedValue('wamid.reply')
  h.createTag.mockResolvedValue({ id: 'tag-1' })
  h.createError.mockResolvedValue(undefined)
  h.createGoogleCalendarOps.mockReturnValue({
    listSlots: vi.fn(),
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
  })
})

describe('processSchedulingJob — DB-first booking (Calendar best-effort)', () => {
  it('booking-flow reports a Calendar sync failure → appointment saved pending, no human handoff', async () => {
    // This is exactly what booking-flow.ts now does when calendar.createEvent
    // throws: it still calls saveAppointment, with googleEventId: null and the
    // Calendar error message (see packages/agents booking-flow.test.ts).
    h.advanceBookingFlow.mockImplementation(async (_state, _msg, _ctx, deps) => {
      await deps.saveAppointment({
        providerId: 'p1',
        doctorName: 'Dr. X',
        specialty: 'General',
        startTime: '2026-06-25T09:30:00.000Z',
        endTime: '2026-06-25T10:00:00.000Z',
        reason: 'Consulta general',
        preferredDate: '2026-06-25',
        preferredTime: '09:30',
        googleEventId: null,
        calendarSyncError: 'Calendar API error',
      })
      return { reply: '¡Listo! Su cita quedó agendada.', done: true, handoff: false }
    })

    await processSchedulingJob(makeJob(bookJob))

    expect(h.createAppt).toHaveBeenCalledTimes(1)
    expect(h.updateAppt).toHaveBeenCalledWith(
      CLINIC,
      'appt-1',
      expect.objectContaining({
        status: 'confirmed',
        googleEventId: null,
        calendarSyncPending: true,
        calendarSyncError: 'Calendar API error',
      }),
    )
    // The patient gets the normal booking confirmation, not a handoff notice.
    expect(h.sendWhatsAppText).toHaveBeenCalledTimes(1)
    expect(h.notificationAdd).not.toHaveBeenCalledWith(
      'notify',
      expect.objectContaining({ reason: 'human_handoff' }),
    )
    // No longer treated as a Calendar failure needing operator review.
    expect(h.createError).not.toHaveBeenCalled()
  })

  it('booking-flow reports a successful sync → saved with no sync error, pending cleared', async () => {
    h.advanceBookingFlow.mockImplementation(async (_state, _msg, _ctx, deps) => {
      await deps.saveAppointment({
        providerId: 'p1',
        doctorName: 'Dr. X',
        specialty: 'General',
        startTime: '2026-06-25T09:30:00.000Z',
        endTime: '2026-06-25T10:00:00.000Z',
        reason: 'Consulta general',
        preferredDate: '2026-06-25',
        preferredTime: '09:30',
        googleEventId: 'evt_123',
        calendarSyncError: null,
      })
      return { reply: '¡Listo! Su cita quedó agendada.', done: true, handoff: false }
    })

    await processSchedulingJob(makeJob(bookJob))

    expect(h.updateAppt).toHaveBeenCalledWith(
      CLINIC,
      'appt-1',
      expect.objectContaining({
        status: 'confirmed',
        googleEventId: 'evt_123',
        calendarSyncPending: false,
        calendarSyncError: null,
      }),
    )
    expect(h.createError).not.toHaveBeenCalled()
  })
})
