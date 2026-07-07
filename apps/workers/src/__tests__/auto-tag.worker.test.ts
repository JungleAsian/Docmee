import { describe, it, expect, vi, beforeEach } from 'vitest'

// Req 11 (Tags & Conversation Statuses): the workers auto-tag conversations.
//   • agent-processor      → `new_patient` on a patient's first contact
//   • scheduling-processor  → `appointment_scheduled` when a booking confirms
// We keep the real agent helpers and stub only the LLM / DB / channels so we can
// assert the tag calls without a live model or database.

const h = vi.hoisted(() => ({
  // shared
  end: vi.fn(),
  createTag: vi.fn(),
  addTag: vi.fn(),
  findConversation: vi.fn(),
  updateConversation: vi.fn(),
  notificationAdd: vi.fn(),
  sendWhatsAppText: vi.fn(),
  // agent worker
  classifyIntent: vi.fn(),
  runClinicBot: vi.fn(),
  findClinic: vi.fn(),
  listAccounts: vi.fn(),
  findPatient: vi.fn(),
  updatePatient: vi.fn(),
  listEmbeddedChunks: vi.fn(),
  listEnabledFlows: vi.fn(),
  // scheduling worker
  advanceBookingFlow: vi.fn(),
  createGoogleCalendarOps: vi.fn(),
  listProviders: vi.fn(),
  listByPatient: vi.fn(),
  apptCreate: vi.fn(),
  apptUpdate: vi.fn(),
  apptAddEvent: vi.fn(),
  listDoctors: vi.fn(),
  schedulingAdd: vi.fn(),
}))

vi.mock('@docmee/llm', () => ({
  classifyIntent: h.classifyIntent,
  claudeComplete: vi.fn(),
  embedText: vi.fn(),
}))

vi.mock('@docmee/shared', () => ({
  decryptValue: (v: string) => v,
}))

vi.mock('@docmee/agents', async () => {
  const actual = await vi.importActual<typeof import('@docmee/agents')>('@docmee/agents')
  return {
    ...actual,
    runClinicBot: h.runClinicBot,
    searchKb: vi.fn().mockResolvedValue([]),
    isInsideBusinessHours: vi.fn().mockReturnValue(true),
    matchCustomFlow: vi.fn().mockReturnValue(null),
    advanceBookingFlow: h.advanceBookingFlow,
    createGoogleCalendarOps: h.createGoogleCalendarOps,
  }
})

vi.mock('@docmee/channels', () => ({
  sendWhatsAppText: h.sendWhatsAppText,
  sendMessengerText: vi.fn(),
  sendInstagramText: vi.fn(),
}))

vi.mock('@docmee/queue', () => ({
  schedulingQueue: { add: h.schedulingAdd },
  notificationQueue: { add: h.notificationAdd },
  agentQueue: { add: vi.fn() },
  transcriptionQueue: { add: vi.fn() },
  followUpQueue: { add: vi.fn() },
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: h.end }),
  createClinicsRepository: () => ({ findById: h.findClinic }),
  createChannelAccountsRepository: () => ({ listByClinic: h.listAccounts }),
  createPatientsRepository: () => ({ findById: h.findPatient, update: h.updatePatient }),
  createKnowledgeRepository: () => ({ listEmbeddedChunks: h.listEmbeddedChunks }),
  createErrorReviewsRepository: () => ({ create: vi.fn().mockResolvedValue(undefined) }),
  createConversationsRepository: () => ({
    findById: h.findConversation,
    update: h.updateConversation,
    createTag: h.createTag,
    addTag: h.addTag,
  }),
  createMessagesRepository: () => ({ create: vi.fn() }),
  createCustomFlowsRepository: () => ({ listEnabled: h.listEnabledFlows }),
  createAppointmentsRepository: () => ({
    listProviders: h.listProviders,
    listByPatient: h.listByPatient,
    create: h.apptCreate,
    update: h.apptUpdate,
    addEvent: h.apptAddEvent,
  }),
  createDoctorsRepository: () => ({ listByClinic: h.listDoctors }),
}))

import { processAgentJob } from '../agent-processor.worker.js'
import { processSchedulingJob } from '../scheduling-processor.worker.js'

const CLINIC = '11111111-1111-1111-1111-111111111111'
const CONVO = '33333333-3333-3333-3333-333333333333'
const PATIENT = '44444444-4444-4444-4444-444444444444'

const makeJob = (data: unknown) => ({ data }) as never

beforeEach(() => {
  vi.clearAllMocks()
  h.createTag.mockResolvedValue({ id: 'tag1' })
  h.addTag.mockResolvedValue(undefined)
  h.updateConversation.mockResolvedValue({})
})

describe('agent worker — new_patient auto-tag (Req 11)', () => {
  const baseJob = {
    clinicId: CLINIC,
    channel: 'whatsapp' as const,
    patientWaId: '5215555555555',
    message: 'Hola, ¿cuáles son sus horarios?',
    waMessageId: 'wamid.ABC',
    conversationId: CONVO,
  }

  beforeEach(() => {
    h.findClinic.mockResolvedValue({ id: CLINIC, name: 'Clinica', settings: {}, timezone: 'America/Mexico_City' })
    h.listAccounts.mockResolvedValue([
      { channel: 'whatsapp', status: 'active', accountId: 'PHONE', accessTokenEnc: 'tok' },
    ])
    h.findPatient.mockResolvedValue(null)
    h.listEmbeddedChunks.mockResolvedValue([])
    h.listEnabledFlows.mockResolvedValue([])
    h.classifyIntent.mockResolvedValue('general_question')
    h.runClinicBot.mockResolvedValue({ replied: true, triggeredHandoff: false, language: 'es' })
    h.findConversation.mockResolvedValue({ id: CONVO, status: 'open', metadata: {} })
  })

  it('tags new_patient on a first-contact (isNewPatient) conversation', async () => {
    await processAgentJob(makeJob({ ...baseJob, isNewPatient: true }))
    expect(h.createTag).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: CLINIC, name: 'new_patient' }),
    )
    expect(h.addTag).toHaveBeenCalledWith(CLINIC, CONVO, 'tag1')
  })

  it('does NOT tag new_patient for a returning patient', async () => {
    await processAgentJob(makeJob({ ...baseJob, isNewPatient: false }))
    expect(h.createTag).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'new_patient' }),
    )
  })

  it('does NOT tag when the job carries no conversationId', async () => {
    const noConvo = {
      clinicId: CLINIC,
      channel: 'whatsapp' as const,
      patientWaId: '5215555555555',
      message: 'Hola',
      waMessageId: 'wamid.NOCONVO',
      isNewPatient: true,
    }
    await processAgentJob(makeJob(noConvo))
    expect(h.createTag).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'new_patient' }),
    )
  })
})

describe('scheduling worker — appointment_scheduled auto-tag (Req 11)', () => {
  const bookJob = {
    clinicId: CLINIC,
    patientWaId: '5215555555555',
    message: 'mañana a las 10',
    waMessageId: 'wamid.BOOK',
    patientId: PATIENT,
    conversationId: CONVO,
    action: 'book' as const,
  }

  beforeEach(() => {
    h.findClinic.mockResolvedValue({
      id: CLINIC,
      name: 'Clinica',
      timezone: 'America/Mexico_City',
      settings: { googleCalendar: { accessToken: 'a', refreshToken: 'r', calendarId: 'primary' } },
    })
    h.listAccounts.mockResolvedValue([
      { channel: 'whatsapp', status: 'active', accountId: 'PHONE', accessTokenEnc: 'tok' },
    ])
    h.findPatient.mockResolvedValue({ id: PATIENT, fullName: 'Ana', metadata: { language: 'es' } })
    h.findConversation.mockResolvedValue({ id: CONVO, status: 'open', metadata: {} })
    h.listProviders.mockResolvedValue([])
    h.listByPatient.mockResolvedValue([])
    h.listDoctors.mockResolvedValue([])
    h.apptCreate.mockResolvedValue({ id: 'appt1' })
    h.apptUpdate.mockResolvedValue({})
    h.apptAddEvent.mockResolvedValue(undefined)
    h.createGoogleCalendarOps.mockReturnValue({
      listSlots: vi.fn(),
      createEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
    })
    // Drive the booking flow straight to a confirmed save.
    h.advanceBookingFlow.mockImplementation(async (_state, _msg, _ctx, deps) => {
      await deps.saveAppointment({
        providerId: 'prov1',
        startTime: '2026-06-20T10:00:00Z',
        endTime: '2026-06-20T10:30:00Z',
        reason: 'consulta',
        googleEventId: 'evt1',
      })
      return { reply: 'Confirmada', done: true, handoff: false, nextState: {} }
    })
  })

  it('tags appointment_scheduled when a booking is saved', async () => {
    await processSchedulingJob(makeJob(bookJob))
    expect(h.apptCreate).toHaveBeenCalledTimes(1)
    expect(h.createTag).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: CLINIC, name: 'appointment_scheduled' }),
    )
    expect(h.addTag).toHaveBeenCalledWith(CLINIC, CONVO, 'tag1')
  })
})
