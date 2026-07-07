import { describe, it, expect, vi, beforeEach } from 'vitest'

// Per-doctor FAQs (Req 30): the botbase route scopes the retrievable KB chunks to
// clinic-wide content plus the doctor the patient named. We keep the REAL agents
// helpers (scopeKbToMessage/hasDoctorScopedChunks/routeIntent) and stub only the
// LLM, the clinic bot and searchKb so we can assert WHICH chunks reach retrieval.

const h = vi.hoisted(() => ({
  runClinicBot: vi.fn(),
  searchKb: vi.fn().mockResolvedValue([]),
  classifyIntent: vi.fn(),
  sendWhatsAppText: vi.fn(),
  findClinic: vi.fn(),
  listAccounts: vi.fn(),
  findPatient: vi.fn(),
  listEmbeddedChunks: vi.fn(),
  listDoctors: vi.fn(),
  listEnabledFlows: vi.fn(),
  findConversation: vi.fn(),
  updateConversation: vi.fn(),
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
  schedulingQueue: { add: vi.fn() },
  notificationQueue: { add: vi.fn() },
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: h.end }),
  createClinicsRepository: () => ({ findById: h.findClinic }),
  createChannelAccountsRepository: () => ({ listByClinic: h.listAccounts }),
  createPatientsRepository: () => ({ findById: h.findPatient }),
  createKnowledgeRepository: () => ({ listEmbeddedChunks: h.listEmbeddedChunks }),
  createDoctorsRepository: () => ({ listByClinic: h.listDoctors }),
  createErrorReviewsRepository: () => ({ create: vi.fn().mockResolvedValue(undefined) }),
  createConversationsRepository: () => ({
    findById: h.findConversation,
    update: h.updateConversation,
    createTag: vi.fn().mockResolvedValue({ id: 't' }),
    addTag: vi.fn(),
  }),
  createMessagesRepository: () => ({ create: h.createMessage }),
  createCustomFlowsRepository: () => ({ listEnabled: h.listEnabledFlows }),
}))

import { processAgentJob } from '../agent-processor.worker.js'

const CLINIC = '11111111-1111-1111-1111-111111111111'
const CONVO = '33333333-3333-3333-3333-333333333333'
const makeJob = (data: unknown) => ({ data }) as never

const CLINIC_WIDE = { title: 'Horarios', content: 'L-V 9-18', embedding: [], doctorId: null }
const GARCIA = { title: 'García', content: 'hace videollamadas', embedding: [], doctorId: 'doc-garcia' }
const LOPEZ = { title: 'López', content: 'habla inglés', embedding: [], doctorId: 'doc-lopez' }

const baseJob = {
  clinicId: CLINIC,
  channel: 'whatsapp' as const,
  patientWaId: '5215555555555',
  message: 'Hola',
  waMessageId: 'wamid.ABC',
  conversationId: CONVO,
}

/** Invoke the searchKb closure the worker handed runClinicBot, return its chunk arg. */
async function chunksPassedToRetrieval(): Promise<unknown[]> {
  const deps = h.runClinicBot.mock.calls[0]![1] as { searchKb: (q: string) => Promise<unknown> }
  await deps.searchKb('q')
  return h.searchKb.mock.calls[0]![1] as unknown[]
}

beforeEach(() => {
  vi.clearAllMocks()
  h.findClinic.mockResolvedValue({ id: CLINIC, name: 'Clinica', settings: {}, timezone: 'America/Mexico_City' })
  h.listAccounts.mockResolvedValue([{ channel: 'whatsapp', status: 'active', accountId: 'PHONE', accessTokenEnc: 'tok' }])
  h.findPatient.mockResolvedValue(null)
  h.listEnabledFlows.mockResolvedValue([])
  h.classifyIntent.mockResolvedValue('general_question')
  h.findConversation.mockResolvedValue({ id: CONVO, status: 'open', metadata: {} })
  h.createMessage.mockResolvedValue({ id: 'm1' })
  h.runClinicBot.mockResolvedValue({ replied: true, triggeredHandoff: false, language: 'es' })
  h.listDoctors.mockResolvedValue([
    { id: 'doc-garcia', name: 'Dra. Ana García' },
    { id: 'doc-lopez', name: 'Dr. Luis López' },
  ])
})

describe('processAgentJob — per-doctor FAQ scoping (Req 30)', () => {
  it('surfaces only the named doctor’s FAQ plus clinic-wide content', async () => {
    h.listEmbeddedChunks.mockResolvedValue([CLINIC_WIDE, GARCIA, LOPEZ])
    await processAgentJob(makeJob({ ...baseJob, message: '¿La doctora García hace videollamadas?' }))

    expect(h.listDoctors).toHaveBeenCalledWith(CLINIC)
    expect(await chunksPassedToRetrieval()).toEqual([CLINIC_WIDE, GARCIA])
  })

  it('drops all doctor-specific FAQs for a generic question', async () => {
    h.listEmbeddedChunks.mockResolvedValue([CLINIC_WIDE, GARCIA, LOPEZ])
    await processAgentJob(makeJob({ ...baseJob, message: '¿Tienen estacionamiento?' }))

    expect(await chunksPassedToRetrieval()).toEqual([CLINIC_WIDE])
  })

  it('does not load doctors when no document is doctor-scoped (back-compat)', async () => {
    h.listEmbeddedChunks.mockResolvedValue([CLINIC_WIDE])
    await processAgentJob(makeJob({ ...baseJob, message: '¿Cuál es el horario?' }))

    expect(h.listDoctors).not.toHaveBeenCalled()
    expect(await chunksPassedToRetrieval()).toEqual([CLINIC_WIDE])
  })
})
