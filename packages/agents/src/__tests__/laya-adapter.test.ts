import { describe, expect, it, vi } from 'vitest'
import { createLayaAdapter, type LayaControls, type LayaRequest, type LayaResponse } from '../laya/adapter.js'

const controls = (mode: LayaControls['clinicMode'] = 'shadow'): LayaControls => ({
  enabled: true, maximumMode: 'live', clinicMode: mode, tasks: ['administrative_intent'],
  qualification: { reviewed: true, modelVersion: 'model-sha', calibrationVersion: 'cal-v1',
    thresholds: { 'administrative_intent:es': 0.9 } },
})
const input = {
  clinicId: 'clinic-a', task: 'administrative_intent' as const, language: 'es' as const,
  text: 'Quiero una cita', candidates: [{ id: 'booking', label: 'Book an appointment' }],
}
const reply = (request: LayaRequest, extra: Partial<LayaResponse> = {}): LayaResponse => ({
  schemaVersion: 1, requestId: request.requestId, modelVersion: 'model-sha',
  calibrationVersion: 'cal-v1', choiceId: 'booking', rawScore: 0.95, abstain: false, ...extra,
})

describe('bounded LAYA adapter', () => {
  it('bounds unresolved control reads across timeout waves and recovers after settlement', async () => {
    let release!: (value: LayaControls) => void
    const pending = new Promise<LayaControls>(resolve => { release = resolve })
    let reads = 0
    const adapter = createLayaAdapter({ timeoutMs: 10, maxConcurrent: 1,
      readControls: async () => { reads++; return pending }, transport: async request => reply(request) })
    await Promise.all(Array.from({ length: 10 }, () => adapter.assess(input)))
    await Promise.all(Array.from({ length: 10 }, () => adapter.assess(input)))
    expect(reads).toBe(1)
    release(controls('live'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(await adapter.assess(input)).toMatchObject({ reason: 'qualified', apply: true })
  })
  it('fails closed for null input and does not emit arbitrary diagnostic fields', async () => {
    const record = vi.fn()
    const transport = vi.fn()
    const adapter = createLayaAdapter({ readControls: async () => controls(), transport, record })
    expect(await adapter.assess(null as unknown as typeof input)).toMatchObject({ reason: 'invalid_input', apply: false })
    expect(await adapter.assess({ ...input, task: 'private-input' } as unknown as typeof input))
      .toMatchObject({ reason: 'invalid_input', apply: false })
    expect(transport).not.toHaveBeenCalled()
    expect(JSON.stringify(record.mock.calls)).not.toContain('private-input')
  })

  it.each([NaN, Infinity, -Infinity])('rejects nonfinite resource bounds: %s', value => {
    const dependencies = { readControls: async () => controls(), transport: async (request: LayaRequest) => reply(request) }
    expect(() => createLayaAdapter({ ...dependencies, maxConcurrent: value })).toThrow()
    expect(() => createLayaAdapter({ ...dependencies, timeoutMs: value })).toThrow()
  })

  it('snapshots the authorized input before asynchronous control reads', async () => {
    let release!: () => void
    const wait = new Promise<void>(resolve => { release = resolve })
    const clinics: string[] = []
    const transport = vi.fn(async (request: LayaRequest) => reply(request))
    const adapter = createLayaAdapter({ readControls: async clinicId => {
      clinics.push(clinicId)
      await wait
      return controls('live')
    }, transport })
    const mutable = structuredClone(input)
    const result = adapter.assess(mutable)
    mutable.clinicId = 'another-clinic'
    mutable.text = 'changed text'
    mutable.candidates[0].label = 'changed label'
    release()
    expect(await result).toMatchObject({ apply: true })
    expect(clinics).toEqual(['clinic-a', 'clinic-a'])
    expect(transport.mock.calls[0][0]).toMatchObject({ text: input.text, candidates: input.candidates })
  })

  it('defaults to existing behavior when disabled and never calls transport', async () => {
    const transport = vi.fn()
    const adapter = createLayaAdapter({ readControls: async () => ({ ...controls(), enabled: false }), transport })
    expect(await adapter.assess(input)).toMatchObject({ outcome: 'fallback', reason: 'disabled', apply: false })
    expect(transport).not.toHaveBeenCalled()
  })

  it('fails closed on control-store failure without logging the error', async () => {
    const record = vi.fn()
    const transport = vi.fn()
    const adapter = createLayaAdapter({ readControls: async () => { throw Error('private-credential') }, transport, record })
    expect(await adapter.assess(input)).toMatchObject({ reason: 'controls_unavailable', apply: false })
    expect(transport).not.toHaveBeenCalled()
    expect(JSON.stringify(record.mock.calls)).not.toContain('private-credential')
  })

  it.each(['explicit_button', 'explicit_keyword', 'active_state', 'consent', 'business_hours', 'secretary_override', 'emergency'] as const)(
    'preserves deterministic precedence: %s', async priority => {
      const transport = vi.fn()
      const adapter = createLayaAdapter({ readControls: async () => controls('live'), transport })
      expect(await adapter.assess({ ...input, priority })).toMatchObject({ reason: 'deterministic_route', apply: false })
      expect(transport).not.toHaveBeenCalled()
    })

  it('projects only bounded model input; shadow observes but cannot apply', async () => {
    const transport = vi.fn(async (request: LayaRequest) => reply(request))
    const record = vi.fn()
    const adapter = createLayaAdapter({ readControls: async () => controls(), transport, record })
    const result = await adapter.assess({ ...input, patientPhone: 'secret-phone', history: ['secret-history'] } as typeof input)
    expect(result).toMatchObject({ outcome: 'suggestion', choiceId: 'booking', apply: false, mode: 'shadow', rawScore: 0.95 })
    expect(transport.mock.calls[0][0]).toEqual({ schemaVersion: 1, requestId: expect.any(String),
      task: input.task, language: 'es', text: input.text, candidates: input.candidates })
    const diagnostics = JSON.stringify(record.mock.calls)
    expect(diagnostics).not.toContain(input.text)
    expect(diagnostics).not.toContain('secret-')
    expect(diagnostics).not.toContain('clinic-a')
  })

  it.each([
    { choiceId: 'foreign-clinic-choice' }, { rawScore: Number.NaN }, { rawScore: 1.1 },
    { requestId: 'wrong-request' }, { modelVersion: 'unexpected' }, { calibrationVersion: 'unexpected' },
    { action: 'book_now' }, { rawScore: '0.95' }, { abstain: 'false' },
  ])('rejects invalid or unbound model output %j', async extra => {
    const adapter = createLayaAdapter({ readControls: async () => controls('live'), transport: async request => ({ ...reply(request), ...extra }) })
    expect(await adapter.assess(input)).toMatchObject({ outcome: 'fallback', reason: 'invalid_response', apply: false })
  })

  it('requires task/language qualification before applying a live suggestion', async () => {
    const adapter = createLayaAdapter({ readControls: async () => controls('live'), transport: async request => reply(request) })
    expect(await adapter.assess(input)).toMatchObject({ apply: true, reason: 'qualified' })
    expect(await adapter.assess({ ...input, language: 'mixed' })).toMatchObject({ apply: false, reason: 'unqualified' })
  })

  it('abstains on uncertainty and treats raw scores separately from confidence', async () => {
    const adapter = createLayaAdapter({ readControls: async () => controls('live'), transport: async request => reply(request, { rawScore: 0.5 }) })
    const result = await adapter.assess(input)
    expect(result).toMatchObject({ apply: false, reason: 'uncertain', rawScore: 0.5 })
    expect(result).not.toHaveProperty('confidence')
  })

  it('re-reads runtime controls before a decision can apply', async () => {
    let enabled = true
    const adapter = createLayaAdapter({ readControls: async () => ({ ...controls('live'), enabled }),
      transport: async request => { enabled = false; return reply(request) } })
    expect(await adapter.assess(input)).toMatchObject({ reason: 'controls_changed', apply: false })
  })

  it('keeps workflow output within the currently selected published workflow', async () => {
    const transport = vi.fn()
    const adapter = createLayaAdapter({ readControls: async () => ({ ...controls('live'), tasks: ['workflow_branch'] }), transport })
    expect(await adapter.assess({ ...input, task: 'workflow_branch', workflow: {
      selectedId: 'current', publishedRevision: 'revision-a', candidatesWorkflowId: 'another',
    } })).toMatchObject({ apply: false, reason: 'invalid_scope' })
    expect(transport).not.toHaveBeenCalled()
  })

  it('rejects over-budget input instead of silently truncating intent or negation', async () => {
    const transport = vi.fn()
    const adapter = createLayaAdapter({ readControls: async () => controls(), transport })
    expect(await adapter.assess({ ...input, text: 'x'.repeat(1601) })).toMatchObject({ reason: 'invalid_input' })
    expect(transport).not.toHaveBeenCalled()
  })

  it('timeouts abort transport and retain slots until uncooperative work settles', async () => {
    let settle!: (value: unknown) => void
    let signal: AbortSignal | undefined
    const transport = vi.fn((_request: LayaRequest, abort: AbortSignal) => {
      signal = abort
      return new Promise(resolve => { settle = resolve })
    })
    const adapter = createLayaAdapter({ readControls: async () => controls(), transport, timeoutMs: 10, maxConcurrent: 1 })
    expect(await adapter.assess(input)).toMatchObject({ reason: 'timeout', apply: false })
    expect(signal?.aborted).toBe(true)
    expect(await adapter.assess(input)).toMatchObject({ reason: 'busy', apply: false })
    expect(transport).toHaveBeenCalledTimes(1)
    settle(null)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(adapter.activeRequests()).toBe(0)
  })
})
