import { describe, it, expect, vi, beforeEach } from 'vitest'

// Rev1 #28: custom-flow EXECUTION ENGINE wiring in the agent worker. We keep the
// REAL matcher + engine (matchCustomFlow/startFlow/advanceFlow/toFlowDef) and stub
// only the LLM, channels, queues and DB so we can assert the worker starts a
// multi-step flow on a trigger, persists the cursor, resumes it on the next turn,
// fires the terminal action, and clears the cursor when the flow ends.

const h = vi.hoisted(() => ({
  runClinicBot: vi.fn(),
  classifyIntent: vi.fn(),
  chatComplete: vi.fn(),
  sendWhatsAppText: vi.fn(),
  sendWhatsAppInteractiveButtons: vi.fn(),
  sendWhatsAppInteractiveList: vi.fn(),
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
  markProviderAccepted: vi.fn(),
  markSendFailed: vi.fn(),
  listMessages: vi.fn(),
  end: vi.fn(),
}))

vi.mock('@docmee/llm', () => ({
  classifyIntent: h.classifyIntent,
  chatComplete: h.chatComplete,
  defaultChatModel: vi.fn().mockReturnValue('test-model'),
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
  sendZernioWhatsAppText: h.sendWhatsAppText,
  sendWhatsAppInteractiveButtons: h.sendWhatsAppInteractiveButtons,
  sendWhatsAppInteractiveList: h.sendWhatsAppInteractiveList,
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
  createMessagesRepository: () => ({
    create: h.createMessage,
    markProviderAccepted: h.markProviderAccepted,
    markSendFailed: h.markSendFailed,
    listByConversation: h.listMessages,
  }),
  createWorkflowsRepository: () => ({ listActiveByTrigger: vi.fn().mockResolvedValue([]) }),
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
  h.chatComplete.mockResolvedValue('{"option":"option_0","confidence":0.95}')
  h.createTag.mockResolvedValue({ id: 'tag1' })
  h.createMessage.mockResolvedValue({ id: 'm1' })
  h.markProviderAccepted.mockResolvedValue(undefined)
  h.markSendFailed.mockResolvedValue(undefined)
  h.sendWhatsAppText.mockResolvedValue('wamid.reply')
  h.listMessages.mockResolvedValue([])
  h.runClinicBot.mockResolvedValue({ replied: true, triggeredHandoff: false, language: 'es' })
  h.sendWhatsAppInteractiveButtons.mockResolvedValue('wamid.interactive')
  h.sendWhatsAppInteractiveList.mockResolvedValue('wamid.interactive')
})

// A single_choice menu: two tappable options plus a keyword fallback, matching
// the flow-engine's own fixture (packages/agents/src/__tests__/flow-engine.test.ts).
const choiceFlow = {
  id: 'flow2',
  clinicId: CLINIC,
  name: 'Menú',
  triggerKeywords: ['menu'],
  messages: [] as string[],
  action: null as 'book' | 'handoff' | 'end' | null,
  language: 'both' as const,
  enabled: true,
  startStepId: 'menu',
  steps: [
    {
      id: 'menu',
      type: 'single_choice' as const,
      messages: ['¿Cómo podemos ayudarte?'],
      renderMode: 'buttons' as const,
      options: [
        { optionId: 'book_appt', title: 'Agendar cita', goToNext: 'book' },
        { optionId: 'talk_staff', title: 'Hablar con el equipo', goToNext: 'handoff' },
      ],
      branches: [{ op: 'contains' as const, keywords: ['precio'], next: 'pricing' }],
    },
    { id: 'pricing', messages: ['Nuestros precios...'], next: 'end' },
  ],
}

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

  it('routes replies for an active booking directly back to scheduling', async () => {
    h.findConversation.mockResolvedValue({
      id: CONVO,
      status: 'open',
      metadata: {
        scheduling: {
          action: 'book',
          state: { step: 'ask_date', reason: 'control de rutina' },
        },
      },
    })

    await processAgentJob(makeJob({ ...baseJob, message: '2026-07-27' }))

    expect(h.schedulingAdd).toHaveBeenCalledWith(
      'schedule',
      expect.objectContaining({ action: 'book', message: '2026-07-27' }),
    )
    expect(h.classifyIntent).not.toHaveBeenCalled()
    expect(h.runClinicBot).not.toHaveBeenCalled()
    expect(h.listEnabledFlows).not.toHaveBeenCalled()
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

  it('uses the LLM only to map an off-script reply onto a configured branch', async () => {
    const semanticFlow = {
      ...bookingFlow,
      steps: [
        {
          id: 'ask',
          messages: ['¿Quieres confirmar la cita?'],
          branches: [
            { op: 'yes', next: 'book' },
            { op: 'no', next: 'end' },
            { op: 'any', next: 'handoff' },
          ],
        },
      ],
    }
    h.findConversation.mockResolvedValue({
      id: CONVO,
      status: 'open',
      metadata: { customFlowState: { flowId: 'flow1', stepId: 'ask', variables: {} } },
    })
    h.findFlowById.mockResolvedValue(semanticFlow)
    h.chatComplete.mockResolvedValue('{"option":"option_0","confidence":0.95}')

    await processAgentJob(makeJob({ ...baseJob, message: 'please go ahead with it' }))

    expect(h.chatComplete).toHaveBeenCalledTimes(1)
    expect(h.schedulingAdd).toHaveBeenCalledWith('schedule', expect.objectContaining({ action: 'book' }))
    expect(h.classifyIntent).not.toHaveBeenCalled()
  })

  it('clarifies once and hands off after a second ambiguous reply', async () => {
    const semanticFlow = {
      ...bookingFlow,
      steps: [
        {
          id: 'ask',
          messages: ['¿Quieres confirmar la cita?'],
          branches: [
            { op: 'yes', next: 'book' },
            { op: 'no', next: 'end' },
          ],
        },
      ],
    }
    h.findFlowById.mockResolvedValue(semanticFlow)
    h.chatComplete.mockResolvedValue('{"option":"option_0","confidence":0.4}')
    h.findConversation.mockResolvedValue({
      id: CONVO,
      status: 'open',
      metadata: { customFlowState: { flowId: 'flow1', stepId: 'ask', variables: {} } },
    })

    await processAgentJob(makeJob({ ...baseJob, message: 'maybe later or now' }))

    expect(h.sendWhatsAppText.mock.calls[0]![3]).toContain('sí o no')
    expect(h.updateConversation.mock.calls.at(-1)![2].metadata.customFlowState.clarificationCount).toBe(1)
    expect(h.schedulingAdd).not.toHaveBeenCalled()

    vi.clearAllMocks()
    h.findClinic.mockResolvedValue({ id: CLINIC, name: 'Clinica', settings: {}, timezone: 'America/Mexico_City' })
    h.listAccounts.mockResolvedValue([{ channel: 'whatsapp', status: 'active', accountId: 'PHONE', accessTokenEnc: 'tok' }])
    h.findPatient.mockResolvedValue(null)
    h.findConversation.mockResolvedValue({
      id: CONVO,
      status: 'open',
      metadata: { customFlowState: { flowId: 'flow1', stepId: 'ask', variables: {}, clarificationCount: 1 } },
    })
    h.findFlowById.mockResolvedValue(semanticFlow)
    h.chatComplete.mockResolvedValue('{"option":null,"confidence":0}')
    h.createMessage.mockResolvedValue({ id: 'm2' })

    await processAgentJob(makeJob({ ...baseJob, message: 'still unsure' }))

    expect(h.notificationAdd).toHaveBeenCalledWith('notify', expect.objectContaining({ reason: 'human_handoff' }))
    expect(h.updateConversation).toHaveBeenCalledWith(
      CLINIC,
      CONVO,
      expect.objectContaining({
        status: 'handoff',
        metadata: expect.not.objectContaining({ customFlowState: expect.anything() }),
      }),
    )
    expect(h.schedulingAdd).not.toHaveBeenCalled()
  })
})

describe('processAgentJob — single_choice (Punchlist Aug 3 parity spec)', () => {
  it('starts the menu with a real WhatsApp interactive send, not plain text', async () => {
    h.findConversation.mockResolvedValue({ id: CONVO, status: 'open', metadata: {} })
    h.listEnabledFlows.mockResolvedValue([choiceFlow])

    await processAgentJob(makeJob({ ...baseJob, message: 'menu' }))

    expect(h.sendWhatsAppInteractiveButtons).toHaveBeenCalledTimes(1)
    const prompt = h.sendWhatsAppInteractiveButtons.mock.calls[0]![3]
    expect(prompt.body).toBe('¿Cómo podemos ayudarte?')
    expect(prompt.options).toEqual([
      { id: 'book_appt', title: 'Agendar cita' },
      { id: 'talk_staff', title: 'Hablar con el equipo' },
    ])
    expect(h.sendWhatsAppText).not.toHaveBeenCalled()
  })

  it('routes a tapped option by its stable id and fires the terminal action', async () => {
    h.findConversation.mockResolvedValue({
      id: CONVO,
      status: 'open',
      metadata: { customFlowState: { flowId: 'flow2', stepId: 'menu', variables: {} } },
    })
    h.findFlowById.mockResolvedValue(choiceFlow)

    await processAgentJob(makeJob({ ...baseJob, message: 'Agendar cita', interactiveReplyId: 'book_appt' }))

    expect(h.schedulingAdd).toHaveBeenCalledWith('schedule', expect.objectContaining({ action: 'book' }))
    const meta = h.updateConversation.mock.calls.at(-1)![2].metadata
    expect(meta.customFlowState).toBeUndefined()
  })

  it('falls back to keyword conditions when no interactiveReplyId is given (typed reply)', async () => {
    h.findConversation.mockResolvedValue({
      id: CONVO,
      status: 'open',
      metadata: { customFlowState: { flowId: 'flow2', stepId: 'menu', variables: {} } },
    })
    h.findFlowById.mockResolvedValue(choiceFlow)

    await processAgentJob(makeJob({ ...baseJob, message: 'cuál es el precio' }))

    expect(h.sendWhatsAppText).toHaveBeenCalledTimes(1)
    expect(h.sendWhatsAppText.mock.calls[0]![3]).toBe('Nuestros precios...')
  })

  it('falls back to plain text when the interactive send fails', async () => {
    h.findConversation.mockResolvedValue({ id: CONVO, status: 'open', metadata: {} })
    h.listEnabledFlows.mockResolvedValue([choiceFlow])
    h.sendWhatsAppInteractiveButtons.mockRejectedValueOnce(new Error('Meta transient error'))

    await processAgentJob(makeJob({ ...baseJob, message: 'menu' }))

    expect(h.sendWhatsAppInteractiveButtons).toHaveBeenCalledTimes(1)
    expect(h.sendWhatsAppText).toHaveBeenCalledTimes(2)
    expect(h.sendWhatsAppText.mock.calls[0]![3]).toBe('¿Cómo podemos ayudarte?')
    expect(h.sendWhatsAppText.mock.calls[1]![3]).toBe('1. Agendar cita\n2. Hablar con el equipo')
  })
})
