import { describe, it, expect, vi, beforeEach } from 'vitest'

// Req 29 (Error Review): a Google Calendar failure inside a scheduling flow is
// recorded to error_reviews as `calendar_failure`, the patient is told a human
// will follow up, and the conversation is handed off — instead of the job
// failing and retrying (which risks a double-book or double-send). We mock
// advanceBookingFlow to throw so the worker's catch path is exercised directly.

const h = vi.hoisted(() => ({
  advanceBookingFlow: vi.fn(),
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
  createError: vi.fn(),
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
}))

vi.mock('@docmee/channels', () => ({ sendWhatsAppText: h.sendWhatsAppText }))

vi.mock('@docmee/queue', () => ({ notificationQueue: { add: h.notificationAdd } }))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: h.end }),
  createClinicsRepository: () => ({ findById: h.findClinic, update: vi.fn() }),
  createPatientsRepository: () => ({ findById: h.findPatient, update: vi.fn() }),
  createConversationsRepository: () => ({
    findById: h.findConversation,
    update: h.updateConversation,
    createTag: vi.fn(),
    addTag: vi.fn(),
  }),
  createAppointmentsRepository: () => ({
    listProviders: h.listProviders,
    listByPatient: h.listByPatient,
    create: vi.fn(),
    update: vi.fn(),
    addEvent: vi.fn(),
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
  message: 'quiero agendar una cita',
  waMessageId: 'wamid.ABC',
  patientId: PATIENT,
  conversationId: CONVO,
  action: 'book' as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  // Clinic has an encrypted Google Calendar so a calendar binding is created.
  h.findClinic.mockResolvedValue({
    id: CLINIC,
    name: 'Clinica',
    timezone: 'America/Mexico_City',
    settings: { googleCalendar: { accessToken: 'a', refreshToken: 'r' } },
  })
  h.listAccounts.mockResolvedValue([
    { channel: 'whatsapp', status: 'active', accountId: 'PHONE', accessTokenEnc: 'tok' },
  ])
  h.findPatient.mockResolvedValue({ id: PATIENT, fullName: 'Ana', metadata: {} })
  h.findConversation.mockResolvedValue({ id: CONVO, metadata: {} })
  h.listProviders.mockResolvedValue([{ id: 'p1', fullName: 'Dr. X', specialty: 'General' }])
  h.listByPatient.mockResolvedValue([])
  h.listDoctors.mockResolvedValue([]) // legacy provider mode → uses clinic calendar
  h.createError.mockResolvedValue(undefined)
  h.createGoogleCalendarOps.mockReturnValue({
    listSlots: vi.fn(),
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
  })
})

describe('processSchedulingJob — calendar failure (Req 29)', () => {
  it('logs calendar_failure, replies the fallback, and hands off when a flow throws', async () => {
    h.advanceBookingFlow.mockRejectedValue(new Error('invalid_grant: token expired'))

    await processSchedulingJob(makeJob(job))

    expect(h.createError).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: CLINIC,
        errorType: 'calendar_failure',
        errorMessage: expect.stringContaining('invalid_grant'),
        context: expect.objectContaining({ action: 'book', conversationId: CONVO }),
      }),
    )
    // Patient gets the "human will follow up" fallback.
    expect(h.sendWhatsAppText).toHaveBeenCalledTimes(1)
    // And the conversation is handed off to a human.
    expect(h.notificationAdd).toHaveBeenCalledWith(
      'notify',
      expect.objectContaining({ reason: 'human_handoff' }),
    )
    // The partially-advanced flow state is NOT persisted (we returned early).
    expect(h.updateConversation).not.toHaveBeenCalled()
  })
})
