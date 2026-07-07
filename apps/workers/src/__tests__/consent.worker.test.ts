import { describe, it, expect, vi, beforeEach } from 'vitest'

// Meta Compliance (Req 19): STOP/START opt-out persistence + Meta send-error logs.
// We keep the REAL consent predicates (isOptOutMessage/isOptInMessage) and intent
// router, and stub only the LLM + clinic bot + DB so we can assert the worker
// persists the opt-out decision and records channel send failures.

const h = vi.hoisted(() => ({
  runClinicBot: vi.fn(),
  classifyIntent: vi.fn(),
  sendWhatsAppText: vi.fn(),
  schedulingAdd: vi.fn(),
  notificationAdd: vi.fn(),
  findClinic: vi.fn(),
  listAccounts: vi.fn(),
  findPatient: vi.fn(),
  updatePatient: vi.fn(),
  listEmbeddedChunks: vi.fn(),
  listEnabledFlows: vi.fn(),
  findConversation: vi.fn(),
  updateConversation: vi.fn(),
  createTag: vi.fn(),
  addTag: vi.fn(),
  createMessage: vi.fn(),
  createError: vi.fn(),
  end: vi.fn(),
}))

vi.mock('@docmee/llm', () => ({
  classifyIntent: h.classifyIntent,
  claudeComplete: vi.fn(),
  embedText: vi.fn(),
}))

vi.mock('@docmee/agents', async () => {
  const actual = await vi.importActual<typeof import('@docmee/agents')>('@docmee/agents')
  return {
    ...actual,
    runClinicBot: h.runClinicBot,
    searchKb: vi.fn().mockResolvedValue([]),
    isInsideBusinessHours: vi.fn().mockReturnValue(true),
    matchCustomFlow: vi.fn().mockReturnValue(null),
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
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: h.end }),
  createClinicsRepository: () => ({ findById: h.findClinic }),
  createChannelAccountsRepository: () => ({ listByClinic: h.listAccounts }),
  createPatientsRepository: () => ({ findById: h.findPatient, update: h.updatePatient }),
  createKnowledgeRepository: () => ({ listEmbeddedChunks: h.listEmbeddedChunks }),
  createErrorReviewsRepository: () => ({ create: h.createError }),
  createConversationsRepository: () => ({
    findById: h.findConversation,
    update: h.updateConversation,
    createTag: h.createTag,
    addTag: h.addTag,
  }),
  createMessagesRepository: () => ({ create: h.createMessage }),
  createCustomFlowsRepository: () => ({ listEnabled: h.listEnabledFlows }),
}))

import { processAgentJob } from '../agent-processor.worker.js'

const CLINIC = '11111111-1111-1111-1111-111111111111'
const CONVO = '33333333-3333-3333-3333-333333333333'
const PATIENT = '22222222-2222-2222-2222-222222222222'

const makeJob = (data: unknown) => ({ data }) as never

const baseJob = {
  clinicId: CLINIC,
  channel: 'whatsapp' as const,
  patientWaId: '5215555555555',
  message: 'Hola, ¿cuáles son sus horarios?',
  waMessageId: 'wamid.ABC',
  patientId: PATIENT,
  conversationId: CONVO,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.findClinic.mockResolvedValue({ id: CLINIC, name: 'Clinica', settings: {}, timezone: 'America/Mexico_City' })
  h.listAccounts.mockResolvedValue([
    { channel: 'whatsapp', status: 'active', accountId: 'PHONE', accessTokenEnc: 'tok' },
  ])
  h.findPatient.mockResolvedValue({ id: PATIENT, fullName: 'Ana', metadata: {} })
  h.updatePatient.mockResolvedValue({ id: PATIENT })
  h.listEmbeddedChunks.mockResolvedValue([])
  h.listEnabledFlows.mockResolvedValue([])
  h.classifyIntent.mockResolvedValue('general_question')
  h.createTag.mockResolvedValue({ id: 'tag1' })
  h.createMessage.mockResolvedValue({ id: 'm1' })
  h.createError.mockResolvedValue({ id: 'e1' })
  h.findConversation.mockResolvedValue({ id: CONVO, status: 'open', metadata: {} })
  h.runClinicBot.mockResolvedValue({ replied: true, triggeredHandoff: false, language: 'es' })
})

describe('processAgentJob — STOP opt-out (Req 19)', () => {
  it('persists optedOut, tags the conversation, and stays silent on STOP', async () => {
    await processAgentJob(makeJob({ ...baseJob, message: 'STOP' }))

    // Opt-out persisted to the patient (so it sticks across turns).
    expect(h.updatePatient).toHaveBeenCalledTimes(1)
    const [, patientId, update] = h.updatePatient.mock.calls[0]
    expect(patientId).toBe(PATIENT)
    expect(update.metadata.optedOut).toBe(true)
    expect(typeof update.metadata.optedOutAt).toBe('string')

    // Conversation tagged opted_out.
    expect(h.createTag).toHaveBeenCalledWith(expect.objectContaining({ name: 'opted_out' }))
    expect(h.addTag).toHaveBeenCalledTimes(1)

    // Absolutely silent — no LLM, no classification, no send.
    expect(h.runClinicBot).not.toHaveBeenCalled()
    expect(h.classifyIntent).not.toHaveBeenCalled()
    expect(h.sendWhatsAppText).not.toHaveBeenCalled()
  })

  it('detects the Spanish BAJA opt-out command too', async () => {
    await processAgentJob(makeJob({ ...baseJob, message: 'Dar de baja' }))
    expect(h.updatePatient).toHaveBeenCalledTimes(1)
    expect(h.updatePatient.mock.calls[0][2].metadata.optedOut).toBe(true)
    expect(h.classifyIntent).not.toHaveBeenCalled()
  })
})

describe('processAgentJob — already opted out', () => {
  it('stays silent without re-persisting or invoking the LLM', async () => {
    h.findPatient.mockResolvedValue({ id: PATIENT, fullName: 'Ana', metadata: { optedOut: true } })
    await processAgentJob(makeJob({ ...baseJob, message: 'Hola, ¿cuáles son sus horarios?' }))

    expect(h.updatePatient).not.toHaveBeenCalled()
    expect(h.runClinicBot).not.toHaveBeenCalled()
    expect(h.classifyIntent).not.toHaveBeenCalled()
    expect(h.sendWhatsAppText).not.toHaveBeenCalled()
  })
})

describe('processAgentJob — START re-subscribe (Req 19)', () => {
  it('clears the opt-out and confirms when an opted-out patient sends START', async () => {
    h.findPatient.mockResolvedValue({ id: PATIENT, fullName: 'Ana', metadata: { optedOut: true } })
    await processAgentJob(makeJob({ ...baseJob, message: 'START' }))

    expect(h.updatePatient).toHaveBeenCalledTimes(1)
    expect(h.updatePatient.mock.calls[0][2].metadata.optedOut).toBe(false)

    // A single confirmation goes out; the bot/LLM is not run.
    expect(h.sendWhatsAppText).toHaveBeenCalledTimes(1)
    expect(h.runClinicBot).not.toHaveBeenCalled()
    expect(h.classifyIntent).not.toHaveBeenCalled()
  })

  it('ignores START from a patient who was never opted out (no reply, no write)', async () => {
    await processAgentJob(makeJob({ ...baseJob, message: 'start' }))
    expect(h.updatePatient).not.toHaveBeenCalled()
    expect(h.sendWhatsAppText).not.toHaveBeenCalled()
  })
})

describe('processAgentJob — Meta send-error logging (Req 19/29)', () => {
  it('records a meta_send_failure to error_reviews when the channel send rejects', async () => {
    h.sendWhatsAppText.mockRejectedValueOnce(new Error('WhatsApp send failed 401: token expired'))
    // Emergency path calls the send transport directly with the reassurance.
    await processAgentJob(makeJob({ ...baseJob, patientId: undefined, message: 'no puedo respirar, ayuda' }))

    expect(h.sendWhatsAppText).toHaveBeenCalledTimes(1)
    expect(h.createError).toHaveBeenCalledWith(
      expect.objectContaining({ errorType: 'meta_send_failure', clinicId: CLINIC }),
    )
    // The failed reply is NOT persisted as a delivered message.
    expect(h.createMessage).not.toHaveBeenCalled()
  })
})
