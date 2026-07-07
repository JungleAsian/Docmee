import { describe, it, expect, vi, beforeEach } from 'vitest'

// Req 31 (CRM / Google Sheets): on a confirmed booking the scheduling worker
// appends an appointment row to the clinic's configured Sheet. We mock ./crm.js
// to spy on the exporter and drive advanceBookingFlow so it invokes saveAppointment.

const h = vi.hoisted(() => ({
  advanceBookingFlow: vi.fn(),
  createGoogleCalendarOps: vi.fn(),
  sendWhatsAppText: vi.fn(),
  notificationAdd: vi.fn(),
  schedulingAdd: vi.fn(),
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
  appendRow: vi.fn(),
  createExporter: vi.fn(),
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
  advanceRescheduleFlow: vi.fn(),
  initialRescheduleState: () => ({}),
  advanceCancelFlow: vi.fn(),
  initialCancelState: () => ({}),
  buildStatusReply: vi.fn(),
  normalizeAvailability: () => ({}),
}))

vi.mock('@docmee/channels', () => ({ sendWhatsAppText: h.sendWhatsAppText }))

vi.mock('@docmee/queue', () => ({
  notificationQueue: { add: h.notificationAdd },
  schedulingQueue: { add: h.schedulingAdd },
}))

// Follow-up scheduling is out of scope here — stub the producers.
vi.mock('../follow-up.js', () => ({
  scheduleAppointmentFollowUps: vi.fn(),
  scheduleNoResponseFollowUp: vi.fn(),
}))

vi.mock('../crm.js', () => ({
  createClinicCrmExporter: h.createExporter,
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
  createDoctorsRepository: () => ({ listByClinic: h.listDoctors }),
  createErrorReviewsRepository: () => ({ create: h.createError }),
}))

import { processSchedulingJob } from '../scheduling-processor.worker.js'

const CLINIC = '11111111-1111-1111-1111-111111111111'
const CONVO = '33333333-3333-3333-3333-333333333333'
const PATIENT = '44444444-4444-4444-4444-444444444444'
const makeJob = (data: unknown) => ({ data }) as never

const job = {
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
    settings: {
      googleCalendar: { accessToken: 'a', refreshToken: 'r' },
      googleSheets: { enabled: true, spreadsheetId: 'sheet-1' },
    },
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
  h.createTag.mockResolvedValue({ id: 'tag-1' })
  h.createError.mockResolvedValue(undefined)
  h.createExporter.mockReturnValue({ appendRow: h.appendRow })
  h.createGoogleCalendarOps.mockReturnValue({
    listSlots: vi.fn(),
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
  })
  // Drive the booking flow so it confirms and saves the appointment.
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
      googleEventId: 'gcal-1',
    })
    return { reply: 'Cita confirmada', done: true, handoff: false }
  })
})

describe('processSchedulingJob — CRM export (Req 31)', () => {
  it('appends a confirmed appointment row with source, status and scheduled flag', async () => {
    await processSchedulingJob(makeJob(job))

    expect(h.createExporter).toHaveBeenCalledTimes(1)
    expect(h.appendRow).toHaveBeenCalledTimes(1)
    expect(h.appendRow).toHaveBeenCalledWith(
      expect.objectContaining({
        recordType: 'appointment',
        clinicId: CLINIC,
        clinicName: 'Clinica Sol',
        patientName: 'Ana',
        phone: '5215555555555',
        source: 'whatsapp',
        doctorName: 'Dr. X',
        specialty: 'General',
        reason: 'Consulta general',
        appointmentDate: '2026-06-25',
        appointmentTime: '09:30',
        status: 'confirmed',
        scheduled: true,
      }),
    )
    // The export failure path was not taken.
    expect(h.createError).not.toHaveBeenCalled()
  })

  it('does not export when the clinic has CRM disabled', async () => {
    h.findClinic.mockResolvedValue({
      id: CLINIC,
      name: 'Clinica Sol',
      timezone: 'America/Mexico_City',
      settings: { googleCalendar: { accessToken: 'a', refreshToken: 'r' } },
    })
    h.createExporter.mockReturnValue(null)

    await processSchedulingJob(makeJob(job))

    expect(h.appendRow).not.toHaveBeenCalled()
    expect(h.createError).not.toHaveBeenCalled()
  })

  it('records crm_export_failure when the append throws, without breaking the booking', async () => {
    h.appendRow.mockRejectedValueOnce(new Error('Sheets 403: insufficient scope'))

    await processSchedulingJob(makeJob(job))

    // The patient still got the confirmation reply (booking not broken).
    expect(h.sendWhatsAppText).toHaveBeenCalledTimes(1)
    expect(h.createError).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: CLINIC,
        errorType: 'crm_export_failure',
        errorMessage: expect.stringContaining('insufficient scope'),
        context: expect.objectContaining({ appointmentId: 'appt-1', conversationId: CONVO }),
      }),
    )
  })
})
