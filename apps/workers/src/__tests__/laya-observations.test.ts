import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLayaAdapter, type LayaControls, type LayaRequest } from '@docmee/agents'

const h = vi.hoisted(() => ({
  capture: true,
  repo: {
    isCaptureEnabled: vi.fn(),
    create: vi.fn(),
    attachAssessment: vi.fn(),
    labelById: vi.fn(),
    labelOpenForMenu: vi.fn(),
  },
  adapter: undefined as unknown,
  pending: [] as Promise<unknown>[],
}))

vi.mock('../laya.js', () => ({
  getLayaAdapter: () => h.adapter,
  getLayaDb: () => ({}),
  runLayaBackground: (task: () => Promise<unknown>) => { h.pending.push(Promise.resolve().then(task).catch(() => undefined)) },
}))
vi.mock('@docmee/db', async () => ({
  ...(await vi.importActual<object>('@docmee/db')),
  createLayaObservationsRepository: () => h.repo,
}))

const { labelMenuTap, liveMenuChoice, observeAiAgentText, observeMenuText } = await import('../laya-observations.js')

const scope = {
  clinicId: '84a7f77f-2f4f-45aa-b057-124f94ae41c4',
  workflowId: '4632c7fa-ae3c-4f86-ab05-8c6272f254d7',
  workflowRevisionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  conversationId: '11111111-2222-4333-8444-555555555555',
  nodeId: 'main_menu',
}
const options = [
  { optionId: 'book_appointment', title: 'Book an appointment', description: 'See available dates and times.' },
  { optionId: 'prices', title: 'Prices & insurance' },
]
const versions = { modelVersion: 'laya-multilingual-e4e9ddf21a7b', calibrationVersion: 'upstream-unqualified-v1' }

function adapterFor(mode: LayaControls['clinicMode'], reviewed: boolean, choiceId = 'book_appointment') {
  const transport = vi.fn(async (request: LayaRequest) => ({ schemaVersion: 1, requestId: request.requestId, ...versions,
    choiceId, rawScore: 0.95, abstain: false }))
  const adapter = createLayaAdapter({
    readControls: async () => ({ enabled: true, maximumMode: 'live', clinicMode: mode,
      tasks: ['workflow_branch', 'administrative_intent'],
      qualification: { reviewed, ...versions, thresholds: reviewed ? { 'workflow_branch:es': 0.9, 'workflow_branch:en': 0.9 } : {} } }),
    transport,
  })
  return { adapter, transport }
}

const settle = async () => { while (h.pending.length) await h.pending.shift() }

beforeEach(() => {
  vi.clearAllMocks()
  h.pending = []
  h.adapter = undefined
  h.repo.isCaptureEnabled.mockImplementation(async () => h.capture)
  h.repo.create.mockResolvedValue('99999999-8888-4777-8666-555555555555')
  h.capture = true
})

describe('LAYA menu observations', () => {
  it('records nothing when the clinic has not opted in to capture', async () => {
    h.capture = false
    observeMenuText(scope, 'quiero una cita', 'menu_unmatched', options)
    await settle()
    expect(h.repo.create).not.toHaveBeenCalled()
  })

  it('stores redacted text and the watch-only pick, which is never applied', async () => {
    const { adapter, transport } = adapterFor('shadow', false)
    h.adapter = adapter
    observeMenuText(scope, 'quiero una cita, mi cel 5555-1234', 'menu_unmatched', options)
    await settle()
    expect(h.repo.create).toHaveBeenCalledWith(expect.objectContaining({
      redactedText: 'quiero una cita, mi cel [phone]', language: 'es', task: 'workflow_branch',
      candidateIds: ['book_appointment', 'prices'],
    }))
    expect(transport.mock.calls[0]![0].text).toBe('quiero una cita, mi cel [phone]')
    expect(h.repo.attachAssessment).toHaveBeenCalledWith(scope.clinicId, expect.any(String),
      expect.objectContaining({ mode: 'shadow', reason: 'unqualified', choiceId: 'book_appointment' }))
  })

  it('ignores footer shortcuts and bare option numbers', async () => {
    observeMenuText(scope, '1', 'menu_unmatched', options)
    observeMenuText(scope, '3', 'menu_unmatched', options)
    await settle()
    expect(h.repo.create).not.toHaveBeenCalled()
  })

  it('labels open observations when the patient taps an option', async () => {
    labelMenuTap(scope, 'book_appointment')
    await settle()
    expect(h.repo.labelOpenForMenu).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'main_menu', choiceId: 'book_appointment' }))
  })

  it('never routes without a reviewed sign-off, even in live mode', async () => {
    h.adapter = adapterFor('live', false).adapter
    expect(await liveMenuChoice(scope, 'I want to book an appointment', options)).toBeNull()
  })

  it('never routes in shadow mode and does not wait for LAYA', async () => {
    const { adapter, transport } = adapterFor('shadow', true)
    h.adapter = adapter
    expect(await liveMenuChoice(scope, 'I want to book an appointment', options)).toBeNull()
    expect(transport).not.toHaveBeenCalled() // scoring happens later, in the background
    await settle()
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('routes only when live AND reviewed AND the pick is one of the menu options', async () => {
    h.adapter = adapterFor('live', true).adapter
    expect(await liveMenuChoice(scope, 'I want to book an appointment', options)).toBe('book_appointment')
    h.adapter = adapterFor('live', true, 'not_an_option').adapter
    expect(await liveMenuChoice(scope, 'I want to book an appointment', options)).toBeNull()
  })

  it('swallows every failure so the patient path is unaffected', async () => {
    h.repo.isCaptureEnabled.mockRejectedValue(new Error('db down'))
    h.adapter = { taskMode: () => { throw new Error('boom') } }
    expect(() => observeMenuText(scope, 'quiero una cita', 'menu_unmatched', options)).not.toThrow()
    await expect(liveMenuChoice(scope, 'quiero una cita', options)).resolves.toBeNull()
    await settle()
  })
})

describe('LAYA AI-step observations', () => {
  it('stores the agent scenario as the baseline label next to the LAYA intent', async () => {
    h.adapter = adapterFor('shadow', false, 'booking').adapter
    observeAiAgentText({ ...scope, nodeId: 'ai_agent' }, 'Quiero cambiar mi cita', 'back_to_menu')
    await settle()
    expect(h.repo.create).toHaveBeenCalledWith(expect.objectContaining({ task: 'administrative_intent', source: 'ai_agent' }))
    expect(h.repo.labelById).toHaveBeenCalledWith(scope.clinicId, expect.any(String), 'back_to_menu', 'ai_scenario')
    expect(h.repo.attachAssessment).toHaveBeenCalledWith(scope.clinicId, expect.any(String),
      expect.objectContaining({ reason: 'unqualified', choiceId: 'booking' }))
  })
})
