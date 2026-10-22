import { describe, expect, it, vi } from 'vitest'
import { createServerLayaAdapter } from '../laya/server.js'
import type { LayaControls } from '../laya/adapter.js'

const qualification: LayaControls['qualification'] = {
  reviewed: true, modelVersion: 'model-v1', calibrationVersion: 'heldout-v1',
  thresholds: { 'kb_relevance:es': 0.9 },
}
const flags = () => [null, 'clinic-a'].map(clinicId => ({
  name: 'docmee_laya', clinicId, enabled: true, rolloutPercentage: 100,
  metadata: { schemaVersion: 1, mode: 'live', tasks: ['kb_relevance'] },
}))
const input = { clinicId: 'clinic-a', task: 'kb_relevance' as const, language: 'es' as const,
  text: '¿A qué hora abren?', candidates: [{ id: 'hours', label: 'Horario de la clínica' }] }
const response = (requestId: string) => Response.json({ schemaVersion: 1, requestId,
  modelVersion: 'model-v1', calibrationVersion: 'heldout-v1', choiceId: 'hours', rawScore: 0.99, abstain: false })

describe('shared server LAYA connection', () => {
  it.each([undefined, '', 'https://external.example', 'http://localhost:9001', 'http://127.0.0.1:99999'])
  ('leaves the existing path untouched for absent or invalid endpoint %s', endpoint => {
    const readRows = vi.fn(), fetcher = vi.fn()
    expect(createServerLayaAdapter({ endpoint, readRows, fetcher })).toBeUndefined()
    expect(readRows).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('composes private HTTP and fresh controls without disclosing tenant or provider settings', async () => {
    const readRows = vi.fn(async () => flags())
    const fetcher = vi.fn(async (url, init) => {
      expect(url).toBe('http://127.0.0.1:9001/v1/decision')
      expect(init?.redirect).toBe('error')
      const payload = JSON.parse(String(init?.body))
      expect(Object.keys(payload).sort()).toEqual(['candidates', 'language', 'requestId', 'schemaVersion', 'task', 'text'])
      expect(payload).toMatchObject({ task: 'kb_relevance', text: input.text })
      return response(payload.requestId)
    }) as unknown as typeof fetch
    const adapter = createServerLayaAdapter({ endpoint: 'http://127.0.0.1:9001', readRows, qualification, fetcher })
    expect(adapter).toBeDefined()
    expect(await adapter!.assess(input)).toMatchObject({ reason: 'qualified', apply: true, choiceId: 'hours' })
    expect(readRows.mock.calls).toEqual([['clinic-a'], ['clinic-a']])
  })

  it('does not call inference when clinic opt-in is missing', async () => {
    const fetcher = vi.fn()
    const adapter = createServerLayaAdapter({ endpoint: 'http://127.0.0.1:9001', readRows: async () => [], fetcher })
    expect(adapter).toBeDefined()
    expect(await adapter!.assess(input)).toMatchObject({ reason: 'disabled', apply: false })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('cannot apply a model choice without server-owned reviewed qualification', async () => {
    const fetcher = vi.fn(async (_url, init) => {
      const payload = JSON.parse(String(init?.body))
      return Response.json({ schemaVersion: 1, requestId: payload.requestId,
        modelVersion: 'unconfigured', calibrationVersion: 'unconfigured', choiceId: 'hours', rawScore: 1, abstain: false })
    }) as unknown as typeof fetch
    const adapter = createServerLayaAdapter({ endpoint: 'http://127.0.0.1:9001', readRows: async () => flags(), fetcher })
    expect(adapter).toBeDefined()
    expect(await adapter!.assess(input)).toMatchObject({ reason: 'unqualified', apply: false })
  })

  it('honors a durable kill switch changed while inference is running', async () => {
    let rows = flags()
    const fetcher = vi.fn(async (_url, init) => {
      const payload = JSON.parse(String(init?.body))
      rows = rows.map(row => ({ ...row, enabled: false }))
      return response(payload.requestId)
    }) as unknown as typeof fetch
    const adapter = createServerLayaAdapter({ endpoint: 'http://127.0.0.1:9001', readRows: async () => rows, qualification, fetcher })
    expect(adapter).toBeDefined()
    expect(await adapter!.assess(input)).toMatchObject({ reason: 'controls_changed', apply: false })
    expect(await adapter!.assess(input)).toMatchObject({ reason: 'disabled', apply: false })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('shares one inference slot across clinic requests', async () => {
    let finish!: (value: Response) => void
    let requestId = ''
    const fetcher = vi.fn(async (_url, init) => {
      requestId = JSON.parse(String(init?.body)).requestId
      return new Promise<Response>(resolve => { finish = resolve })
    }) as unknown as typeof fetch
    const adapter = createServerLayaAdapter({ endpoint: 'http://127.0.0.1:9001', readRows: async () => flags(), qualification, fetcher })
    expect(adapter).toBeDefined()
    const pending = adapter!.assess(input)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect(await adapter!.assess(input)).toMatchObject({ reason: 'busy', apply: false })
    finish(response(requestId))
    expect(await pending).toMatchObject({ reason: 'qualified', apply: true })
  })
})
