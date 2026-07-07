import { describe, it, expect, vi, beforeEach } from 'vitest'

// Bot Interruption Rule (Rev1 #6) + explicit human-request handoff (#5).
// We keep the REAL handoff predicates (isBotPaused/detectHumanRequest/...) and
// the real intent router, and stub only the LLM + clinic bot so we can assert the
// worker's routing decisions without a live model or database.

const h = vi.hoisted(() => ({
  runClinicBot: vi.fn(),
  classifyIntent: vi.fn(),
  sendWhatsAppText: vi.fn(),
  schedulingAdd: vi.fn(),
  notificationAdd: vi.fn(),
  findClinic: vi.fn(),
  listAccounts: vi.fn(),
  findPatient: vi.fn(),
  listEmbeddedChunks: vi.fn(),
  listEnabledFlows: vi.fn(),
  findConversation: vi.fn(),
  updateConversation: vi.fn(),
  createTag: vi.fn(),
  addTag: vi.fn(),
  createMessage: vi.fn(),
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
  createPatientsRepository: () => ({ findById: h.findPatient }),
  createKnowledgeRepository: () => ({ listEmbeddedChunks: h.listEmbeddedChunks }),
  createErrorReviewsRepository: () => ({ create: vi.fn().mockResolvedValue(undefined) }),
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

const makeJob = (data: unknown) => ({ data }) as never

const baseJob = {
  clinicId: CLINIC,
  channel: 'whatsapp' as const,
  patientWaId: '5215555555555',
  message: 'Hola, ¿cuáles son sus horarios?',
  waMessageId: 'wamid.ABC',
  conversationId: CONVO,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.findClinic.mockResolvedValue({ id: CLINIC, name: 'Clinica', settings: {}, timezone: 'America/Mexico_City' })
  h.listAccounts.mockResolvedValue([
    { channel: 'whatsapp', status: 'active', accountId: 'PHONE', accessTokenEnc: 'tok' },
  ])
  h.findPatient.mockResolvedValue(null)
  h.listEmbeddedChunks.mockResolvedValue([])
  h.listEnabledFlows.mockResolvedValue([])
  h.classifyIntent.mockResolvedValue('general_question')
  h.createTag.mockResolvedValue({ id: 'tag1' })
  h.createMessage.mockResolvedValue({ id: 'm1' })
  // runClinicBot always resolves a ClinicBotResult; the worker reads .language.
  h.runClinicBot.mockResolvedValue({ replied: true, triggeredHandoff: false, language: 'es' })
})

describe('processAgentJob — bot interruption rule', () => {
  it('stays silent when a human owns the conversation (status handoff)', async () => {
    h.findConversation.mockResolvedValue({ id: CONVO, status: 'handoff', metadata: {} })
    await processAgentJob(makeJob(baseJob))
    expect(h.runClinicBot).not.toHaveBeenCalled()
    expect(h.sendWhatsAppText).not.toHaveBeenCalled()
    expect(h.classifyIntent).not.toHaveBeenCalled()
  })

  it('stays silent for an assigned conversation', async () => {
    h.findConversation.mockResolvedValue({ id: CONVO, status: 'assigned', metadata: {} })
    await processAgentJob(makeJob(baseJob))
    expect(h.runClinicBot).not.toHaveBeenCalled()
    expect(h.sendWhatsAppText).not.toHaveBeenCalled()
  })

  it('runs the bot when the conversation is open', async () => {
    h.findConversation.mockResolvedValue({ id: CONVO, status: 'open', metadata: {} })
    await processAgentJob(makeJob(baseJob))
    expect(h.runClinicBot).toHaveBeenCalledTimes(1)
  })
})

describe('processAgentJob — medical emergency (Req 20)', () => {
  it('keyword emergency: reassures, pauses the bot, tags, alerts — no LLM', async () => {
    h.findConversation.mockResolvedValue({ id: CONVO, status: 'open', metadata: {} })
    await processAgentJob(makeJob({ ...baseJob, message: 'no puedo respirar, ayuda' }))

    // Patient gets the emergency reassurance; the bot/LLM is never invoked.
    expect(h.sendWhatsAppText).toHaveBeenCalledTimes(1)
    expect(h.runClinicBot).not.toHaveBeenCalled()
    expect(h.classifyIntent).not.toHaveBeenCalled()

    // Conversation paused (handoff) with the emergency reason + tagged.
    expect(h.updateConversation).toHaveBeenCalledWith(
      CLINIC,
      CONVO,
      expect.objectContaining({ status: 'handoff' }),
    )
    const [, , update] = h.updateConversation.mock.calls[0]
    expect(update.metadata.handoffReason).toBe('emergency')
    expect(h.createTag).toHaveBeenCalledWith(expect.objectContaining({ name: 'emergency' }))
    expect(h.addTag).toHaveBeenCalledTimes(1)

    // Highest-priority emergency alert is queued.
    expect(h.notificationAdd).toHaveBeenCalledWith(
      'notify',
      expect.objectContaining({ reason: 'emergency', conversationId: CONVO }),
    )
  })

  it('emergency outside business hours is NOT silenced by the hours rule', async () => {
    const { isInsideBusinessHours } = await import('@docmee/agents')
    const hoursMock = isInsideBusinessHours as ReturnType<typeof vi.fn>
    hoursMock.mockReturnValue(false)
    try {
      h.findConversation.mockResolvedValue({ id: CONVO, status: 'open', metadata: {} })
      await processAgentJob(makeJob({ ...baseJob, message: 'tengo dolor de pecho' }))

      // Keyword emergency fires before the hours gate is even consulted, so a
      // closed clinic still reassures the patient and raises the alert.
      expect(h.sendWhatsAppText).toHaveBeenCalledTimes(1)
      expect(h.runClinicBot).not.toHaveBeenCalled()
      expect(h.notificationAdd).toHaveBeenCalledWith(
        'notify',
        expect.objectContaining({ reason: 'emergency' }),
      )
    } finally {
      hoursMock.mockReturnValue(true)
    }
  })

  it('classifier-detected emergency (no keyword) still reassures and pauses', async () => {
    h.findConversation.mockResolvedValue({ id: CONVO, status: 'open', metadata: {} })
    h.classifyIntent.mockResolvedValueOnce('emergency')
    await processAgentJob(makeJob({ ...baseJob, message: 'me siento muy mal y mareado' }))

    expect(h.sendWhatsAppText).toHaveBeenCalledTimes(1)
    expect(h.runClinicBot).not.toHaveBeenCalled()
    expect(h.updateConversation).toHaveBeenCalledWith(
      CLINIC,
      CONVO,
      expect.objectContaining({ status: 'handoff' }),
    )
    expect(h.notificationAdd).toHaveBeenCalledWith(
      'notify',
      expect.objectContaining({ reason: 'emergency' }),
    )
  })
})

describe('processAgentJob — outbound reply persistence (Req 4)', () => {
  it('persists an outbound reply as an assistant message on the threaded conversation', async () => {
    h.findConversation.mockResolvedValue({ id: CONVO, status: 'open', metadata: {} })
    await processAgentJob(makeJob({ ...baseJob, message: 'no puedo respirar, ayuda' }))

    // The emergency reassurance went out (sendWhatsAppText) AND was recorded.
    expect(h.sendWhatsAppText).toHaveBeenCalledTimes(1)
    expect(h.createMessage).toHaveBeenCalledTimes(1)
    const [msgInput] = h.createMessage.mock.calls[0]
    expect(msgInput).toMatchObject({ conversationId: CONVO, clinicId: CLINIC, role: 'assistant' })
    expect(typeof msgInput.content).toBe('string')
  })

  it('does not persist a reply when the job carries no conversation id', async () => {
    h.findConversation.mockResolvedValue(null)
    await processAgentJob(
      makeJob({
        clinicId: CLINIC,
        channel: 'whatsapp' as const,
        patientWaId: '5215555555555',
        message: 'no puedo respirar, ayuda',
        waMessageId: 'wamid.ABC',
      }),
    )

    expect(h.sendWhatsAppText).toHaveBeenCalledTimes(1)
    expect(h.createMessage).not.toHaveBeenCalled()
  })
})

describe('processAgentJob — medical-safety handoff (Req 20)', () => {
  it('bot reply tripped the safety screen → pauses the bot, tags, alerts a human', async () => {
    h.findConversation.mockResolvedValue({ id: CONVO, status: 'open', metadata: {} })
    // The bot suppressed the unsafe reply itself and signals a handoff.
    h.runClinicBot.mockResolvedValue({ replied: true, triggeredHandoff: true, language: 'es' })

    await processAgentJob(makeJob(baseJob))

    // The bot ran (deferral already sent inside runClinicBot via sendText).
    expect(h.runClinicBot).toHaveBeenCalledTimes(1)

    // Conversation paused (handoff) with the medical_safety reason + tagged.
    const handoffUpdate = h.updateConversation.mock.calls.find(
      ([, , u]) => u?.status === 'handoff',
    )
    expect(handoffUpdate).toBeDefined()
    expect(handoffUpdate![2].metadata.handoffReason).toBe('medical_safety')
    expect(h.createTag).toHaveBeenCalledWith(expect.objectContaining({ name: 'medical_safety' }))

    // A human handoff alert is queued.
    expect(h.notificationAdd).toHaveBeenCalledWith(
      'notify',
      expect.objectContaining({ reason: 'human_handoff', conversationId: CONVO }),
    )
  })

  it('a clean bot reply does NOT pause the bot or alert a human', async () => {
    h.findConversation.mockResolvedValue({ id: CONVO, status: 'open', metadata: {} })
    h.runClinicBot.mockResolvedValue({ replied: true, triggeredHandoff: false, language: 'es' })

    await processAgentJob(makeJob(baseJob))

    expect(h.runClinicBot).toHaveBeenCalledTimes(1)
    const handoffUpdate = h.updateConversation.mock.calls.find(
      ([, , u]) => u?.status === 'handoff',
    )
    expect(handoffUpdate).toBeUndefined()
    expect(h.notificationAdd).not.toHaveBeenCalledWith(
      'notify',
      expect.objectContaining({ reason: 'human_handoff' }),
    )
  })
})

describe('processAgentJob — explicit human request (#5)', () => {
  it('acks the patient, pauses the bot, and alerts a human', async () => {
    h.findConversation.mockResolvedValue({ id: CONVO, status: 'open', metadata: {} })
    await processAgentJob(makeJob({ ...baseJob, message: 'Quiero hablar con una persona' }))

    // Patient gets the handoff ack; the LLM/bot is never invoked.
    expect(h.sendWhatsAppText).toHaveBeenCalledTimes(1)
    expect(h.runClinicBot).not.toHaveBeenCalled()
    expect(h.classifyIntent).not.toHaveBeenCalled()

    // Conversation flipped to handoff with the pause metadata.
    expect(h.updateConversation).toHaveBeenCalledWith(
      CLINIC,
      CONVO,
      expect.objectContaining({ status: 'handoff' }),
    )
    const [, , update] = h.updateConversation.mock.calls[0]
    expect(update.metadata.handoffReason).toBe('patient_request')
    expect(typeof update.metadata.botPausedAt).toBe('string')

    // And a human handoff notification is queued.
    expect(h.notificationAdd).toHaveBeenCalledWith(
      'notify',
      expect.objectContaining({ reason: 'human_handoff', conversationId: CONVO }),
    )
  })
})
