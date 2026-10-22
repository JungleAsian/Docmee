import { describe, expect, it, vi } from 'vitest'
import { createLayaAdapter, type LayaPriority } from '../laya/adapter.js'
import { assessWorkflowBranch, type LayaWorkflowScope } from '../laya/workflow.js'

const scope = (): LayaWorkflowScope => ({ clinicId: 'clinic-a', workflowId: 'published-a',
  publishedRevision: 'v1', nodeId: 'menu', branches: [{ id: 'edge-book', label: 'Book appointment' }] })
const input = () => ({ clinicId: 'clinic-a', workflowId: 'published-a', publishedRevision: 'v1',
  nodeId: 'menu', text: 'Book please', language: 'en' as const })
function fixture(afterInference?: () => void, mode: 'live' | 'shadow' = 'live') {
  const transport = vi.fn(async (request) => {
    afterInference?.()
    return { schemaVersion: 1, requestId: request.requestId, modelVersion: 'm1',
      calibrationVersion: 'c1', choiceId: 'edge-book', rawScore: 0.99, abstain: false }
  })
  const adapter = createLayaAdapter({ transport, readControls: async () => ({ enabled: true,
    maximumMode: mode, clinicMode: mode, tasks: ['workflow_branch'], qualification: {
      reviewed: true, modelVersion: 'm1', calibrationVersion: 'c1', thresholds: { 'workflow_branch:en': 0.9 },
    } }) })
  return { adapter, transport }
}

describe('scope-bound LAYA workflow decisions', () => {
  it('uses only server-resolved eligible edges without sending tenant or workflow identifiers', async () => {
    const { adapter, transport } = fixture()
    const readScope = vi.fn(async () => scope())
    expect(await assessWorkflowBranch(adapter, input(), { readScope })).toMatchObject({ apply: true, choiceId: 'edge-book' })
    expect(readScope).toHaveBeenCalledTimes(2)
    expect(readScope.mock.calls[0]).toEqual(['clinic-a', 'published-a', 'menu'])
    expect(transport.mock.calls[0]![0]).not.toHaveProperty('clinicId')
    expect(transport.mock.calls[0]![0]).not.toHaveProperty('workflow')
  })

  it.each(['clinicId', 'workflowId', 'publishedRevision', 'nodeId'] as const)('rejects mismatched %s before disclosure', async key => {
    const { adapter, transport } = fixture()
    const current = scope(); current[key] = 'other'
    expect(await assessWorkflowBranch(adapter, input(), { readScope: async () => current }))
      .toMatchObject({ apply: false, reason: 'invalid_scope' })
    expect(transport).not.toHaveBeenCalled()
  })

  it.each(['publishedRevision', 'branches'] as const)('rejects in-place %s changes during inference', async key => {
    const current = scope()
    const { adapter } = fixture(() => {
      if (key === 'branches') current.branches[0]!.label = 'Changed route'
      else current.publishedRevision = 'v2'
    })
    expect(await assessWorkflowBranch(adapter, input(), { readScope: async () => current }))
      .toMatchObject({ apply: false, reason: 'invalid_scope' })
  })

  it.each<LayaPriority>(['explicit_button', 'explicit_keyword', 'active_state', 'consent', 'business_hours', 'secretary_override', 'emergency'])
    ('preserves deterministic %s without reading scope or invoking inference', async priority => {
      const { adapter, transport } = fixture(); const readScope = vi.fn(async () => scope())
      expect(await assessWorkflowBranch(adapter, { ...input(), priority }, { readScope }))
        .toMatchObject({ apply: false, reason: 'deterministic_route' })
      expect(readScope).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled()
    })

  it('fails closed on missing scope and a hanging repository', async () => {
    const { adapter, transport } = fixture()
    for (const readScope of [async () => null, () => new Promise<LayaWorkflowScope>(() => {})]) {
      expect(await assessWorkflowBranch(adapter, input(), { readScope, scopeTimeoutMs: 10 }))
        .toMatchObject({ apply: false, reason: 'invalid_scope' })
    }
    expect(transport).not.toHaveBeenCalled()
  })

  it('keeps shadow decisions observational', async () => {
    const { adapter } = fixture(undefined, 'shadow')
    expect(await assessWorkflowBranch(adapter, input(), { readScope: async () => scope() }))
      .toMatchObject({ apply: false, choiceId: 'edge-book', reason: 'observe_only' })
  })

  it('retains the scope slot across timeout waves until the repository settles', async () => {
    const { adapter, transport } = fixture()
    let release!: (value: LayaWorkflowScope) => void
    const pending = new Promise<LayaWorkflowScope>(resolve => { release = resolve })
    const readScope = vi.fn(() => pending)
    for (let wave = 0; wave < 2; wave++) {
      const results = await Promise.all(Array.from({ length: 10 }, () =>
        assessWorkflowBranch(adapter, input(), { readScope, scopeTimeoutMs: 10 })))
      expect(results.every(result => !result.apply)).toBe(true)
    }
    expect(readScope).toHaveBeenCalledTimes(1)
    expect(transport).not.toHaveBeenCalled()
    release(scope())
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(await assessWorkflowBranch(adapter, input(), { readScope }))
      .toMatchObject({ apply: true, choiceId: 'edge-book' })
  })
})
