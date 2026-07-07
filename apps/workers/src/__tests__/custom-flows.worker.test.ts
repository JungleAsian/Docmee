import { describe, it, expect, vi, beforeEach } from 'vitest'

// Rev1 #28: custom-flow EXECUTION ENGINE wiring in the agent worker. We keep the
// REAL matcher + engine (matchCustomFlow/startFlow/advanceFlow/toFlowDef) and stub
// only the LLM, channels, queues and DB so we can assert the worker starts a
// multi-step flow on a trigger, persists the cursor, resumes it on the next turn,
// fires the terminal action, and clears the cursor when the flow ends.

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
  findFlowById: vi.fn(),
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
  createCustomFlowsRepository: () => ({ listEnabled: h.listEnabledFlows, findById: h.findFlowById }),
}))

import { processAgentJob } from '../agent-processor.worker.js'

const CLINIC = '11111111-1111-1111-1111-111111111111'
const CONVO = '33333333-3333-3333-3333-333333333333'

const makeJob = (data: unknown) => ({ data }) as never

// A multi-step booking flow: ask the reason (waiting step), then book.
const bookingFlow = {
  id: 'flow1',
  clinicId: CLINIC,
  name: 'Agendar',
  triggerKeywords: ['agendar'],
  messages: [] as string[],
  action: null as 'book' | 'handoff' | 'end' | null,
  language: 'both' as const,
  enabled: true,
  startStepId: 'ask',
  steps: [
    { id: 'ask', messages: ['¿Cuál es el motivo de tu consulta?'], collect: 'reason', branches: [{ op: 'any', next: 'confirm' }] },
    { id: 'confirm', messages: ['Buscaré horarios para: {{reason}}.'], next: 'book' },
  ],
}

const baseJob = {
  clinicId: CLINIC,
  channel: 'whatsapp' as const,
  patientWaId: '5215555555555',
  message: 'quiero agendar',
  waMessageId: 'wamid.ABC',
  conversationId: CONVO,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.findClinic.mockResolvedValue({ id: CLINIC, name: 'Clinica', settings: {}, timezone: 'America/Mexico_City' })
  h.listAccounts.mockResolvedValue([{ channel: 'whatsapp', status: 'active', accountId: 'PHONE', accessTokenEnc: 'tok' }])
  h.findPatient.mockResolvedValue(null)
  h.listEmbeddedChunks.mockResolvedValue([])
  h.listEnabledFlows.mockResolvedValue([])
  h.classifyIntent.mockResolvedValue('general_question')
  h.createTag.mockResolvedValue({ id: 'tag1' })
  h.createMessage.mockResolvedValue({ id: 'm1' })
  h.runClinicBot.mockResolvedValue({ replied: true, triggeredHandoff: false, language: 'es' })
})

describe('processAgentJob — custom flow engine', () => {
  it('starts a multi-step flow on a trigger and persists the cursor', async () => {
    h.findConversation.mockResolvedValue({ id: CONVO, status: 'open', metadata: {} })
    h.listEnabledFlows.mockResolvedValue([bookingFlow])

    await processAgentJob(makeJob(baseJob))

    expect(h.sendWhatsAppText).toHaveBeenCalledTimes(1)
    expect(h.sendWhatsAppText.mock.calls[0]![3]).toBe('¿Cuál es el motivo de tu consulta?')
    // cursor persisted on the conversation, waiting at the 'ask' step
    const meta = h.updateConversation.mock.calls.at(-1)![2].metadata
    expect(meta.customFlowState).toEqual({ flowId: 'flow1', stepId: 'ask', variables: {} })
    // the LLM is skipped
    expect(h.classifyIntent).not.toHaveBeenCalled()
    expect(h.runClinicBot).not.toHaveBeenCalled()
  })

  it('resumes the flow on the next turn, collects the reply, books and clears the cursor', async () => {
    h.findConversation.mockResolvedValue({
      id: CONVO,
      status: 'open',
      metadata: { customFlowState: { flowId: 'flow1', stepId: 'ask', variables: {} } },
    })
    h.findFlowById.mockResolvedValue(bookingFlow)

    await processAgentJob(makeJob({ ...baseJob, message: 'control de rutina' }))

    expect(h.sendWhatsAppText).toHaveBeenCalledTimes(1)
    expect(h.sendWhatsAppText.mock.calls[0]![3]).toBe('Buscaré horarios para: control de rutina.')
    // booking enqueued
    expect(h.schedulingAdd).toHaveBeenCalledWith('schedule', expect.objectContaining({ action: 'book' }))
    // cursor cleared
    const meta = h.updateConversation.mock.calls.at(-1)![2].metadata
    expect(meta.customFlowState).toBeUndefined()
    expect(h.classifyIntent).not.toHaveBeenCalled()
  })

  it('clears a stale cursor and falls through to the LLM when the flow is disabled', async () => {
    h.findConversation.mockResolvedValue({
      id: CONVO,
      status: 'open',
      metadata: { customFlowState: { flowId: 'flow1', stepId: 'ask', variables: {} } },
    })
    h.findFlowById.mockResolvedValue({ ...bookingFlow, enabled: false })

    await processAgentJob(makeJob({ ...baseJob, message: 'tengo una pregunta general' }))

    // stale cursor removed
    const cleared = h.updateConversation.mock.calls.find(
      (c) => c[2]?.metadata && !('customFlowState' in c[2].metadata),
    )
    expect(cleared).toBeTruthy()
    // normal processing resumed
    expect(h.classifyIntent).toHaveBeenCalled()
    expect(h.runClinicBot).toHaveBeenCalled()
  })
})
