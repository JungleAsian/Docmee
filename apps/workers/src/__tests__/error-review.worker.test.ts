import { describe, it, expect, vi, beforeEach } from 'vitest'

// Req 29 (Error Review): the botbase route logs an `unanswered_question` to
// error_reviews when the bot replied but found NO clinic-KB match for a real
// question — so an operator can review it and Add-to-KB. We keep the real intent
// router + isLikelyQuestion and stub the LLM/clinic-bot. The mocked runClinicBot
// invokes deps.searchKb so the worker's kbHit flag reflects the KB mock.

const h = vi.hoisted(() => ({
  runClinicBot: vi.fn(),
  classifyIntent: vi.fn(),
  searchKb: vi.fn(),
  sendWhatsAppText: vi.fn(),
  notificationAdd: vi.fn(),
  schedulingAdd: vi.fn(),
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
    searchKb: h.searchKb,
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
  createPatientsRepository: () => ({ findById: h.findPatient, update: vi.fn() }),
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
const makeJob = (data: unknown) => ({ data }) as never

const baseJob = {
  clinicId: CLINIC,
  channel: 'whatsapp' as const,
  patientWaId: '5215555555555',
  message: '¿Cuánto cuesta una limpieza dental?',
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
  h.findConversation.mockResolvedValue({ id: CONVO, status: 'open', metadata: {} })
  h.createError.mockResolvedValue(undefined)
  h.searchKb.mockResolvedValue([])
  // The mocked bot invokes deps.searchKb so the worker's kbHit reflects the mock.
  h.runClinicBot.mockImplementation(async (_input: unknown, deps: { searchKb: (q: string) => Promise<unknown[]> }) => {
    await deps.searchKb(baseJob.message)
    return { replied: true, triggeredHandoff: false, language: 'es' }
  })
})

describe('processAgentJob — unanswered question logging (Req 29)', () => {
  it('logs unanswered_question when the bot replied with NO KB match', async () => {
    await processAgentJob(makeJob(baseJob))
    expect(h.createError).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: CLINIC,
        errorType: 'unanswered_question',
        errorMessage: baseJob.message,
      }),
    )
  })

  it('does NOT log when a KB chunk matched', async () => {
    h.searchKb.mockResolvedValue([{ title: 'Precios', content: 'Limpieza $500', score: 0.9 }])
    await processAgentJob(makeJob(baseJob))
    expect(h.createError).not.toHaveBeenCalled()
  })

  it('does NOT log for a non-question message even without a KB match', async () => {
    await processAgentJob(makeJob({ ...baseJob, message: 'ok gracias' }))
    expect(h.createError).not.toHaveBeenCalled()
  })
})
