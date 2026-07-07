import { describe, it, expect, vi, beforeEach } from 'vitest'

// Bilingual bot (Req 22): the worker must persist the patient's language to
// patients.metadata so every later turn answers in the SAME language. We keep the
// real language detector + intent router and stub only the LLM, clinic bot, and DB.

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
  createErrorReviewsRepository: () => ({ create: vi.fn().mockResolvedValue(undefined) }),
  createConversationsRepository: () => ({
    findById: h.findConversation,
    update: h.updateConversation,
    createTag: h.createTag,
    addTag: h.addTag,
  }),
  createMessagesRepository: () => ({ create: vi.fn() }),
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
  message: 'Hello, what are your opening hours?',
  waMessageId: 'wamid.ABC',
  conversationId: CONVO,
  patientId: PATIENT,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.findClinic.mockResolvedValue({ id: CLINIC, name: 'Clinic', settings: {}, timezone: 'America/Mexico_City' })
  h.listAccounts.mockResolvedValue([
    { channel: 'whatsapp', status: 'active', accountId: 'PHONE', accessTokenEnc: 'tok' },
  ])
  h.listEmbeddedChunks.mockResolvedValue([])
  h.listEnabledFlows.mockResolvedValue([])
  h.classifyIntent.mockResolvedValue('general_question')
  h.findConversation.mockResolvedValue({ id: CONVO, status: 'open', metadata: {} })
  h.createTag.mockResolvedValue({ id: 'tag1' })
  // Bot replies in the same language resolveLanguage picks (English here).
  h.runClinicBot.mockResolvedValue({ replied: true, triggeredHandoff: false, language: 'en' })
})

describe('processAgentJob — bilingual language persistence (Req 22)', () => {
  it('persists the detected language for a new English-speaking patient', async () => {
    h.findPatient.mockResolvedValue({ id: PATIENT, fullName: null, metadata: {} })
    await processAgentJob(makeJob({ ...baseJob, isNewPatient: true }))

    // Language is written to patients.metadata so message 2+ stays English.
    expect(h.updatePatient).toHaveBeenCalledWith(
      CLINIC,
      PATIENT,
      expect.objectContaining({ metadata: expect.objectContaining({ language: 'en' }) }),
    )
  })

  it('a returning patient stored as English is answered in English', async () => {
    h.findPatient.mockResolvedValue({ id: PATIENT, fullName: null, metadata: { language: 'en' } })
    await processAgentJob(makeJob({ ...baseJob, isNewPatient: false }))

    // The bot is invoked with the stored language, not the 'es' default.
    expect(h.runClinicBot).toHaveBeenCalledWith(
      expect.objectContaining({ patientLanguage: 'en' }),
      expect.anything(),
    )
  })

  it('does not re-write when the stored language already matches', async () => {
    h.findPatient.mockResolvedValue({ id: PATIENT, fullName: null, metadata: { language: 'en' } })
    await processAgentJob(makeJob({ ...baseJob, isNewPatient: false }))

    // botResult.language === stored 'en' → idempotent, no patient update.
    expect(h.updatePatient).not.toHaveBeenCalled()
  })

  it('persists the bot-resolved language when it changes (Spanish patient switches)', async () => {
    h.findPatient.mockResolvedValue({ id: PATIENT, fullName: null, metadata: { language: 'es' } })
    await processAgentJob(makeJob({ ...baseJob, isNewPatient: false }))

    // Stored 'es' but the bot resolved/replied 'en' → metadata is updated.
    expect(h.updatePatient).toHaveBeenCalledWith(
      CLINIC,
      PATIENT,
      expect.objectContaining({ metadata: expect.objectContaining({ language: 'en' }) }),
    )
  })
})
