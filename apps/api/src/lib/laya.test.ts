import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ read: vi.fn(), sql: {} }))
vi.mock('@docmee/db', () => ({
  createLayaControlsRepository: (sql: unknown) => {
    expect(sql).toBe(state.sql)
    return { readForClinic: state.read }
  },
}))
vi.mock('./db.js', () => ({ withDb: (fn: (sql: unknown) => unknown) => fn(state.sql) }))

const clinicId = '84a7f77f-2f4f-45aa-b057-124f94ae41c4'
const input = { clinicId, task: 'kb_relevance' as const, language: 'es' as const,
  text: 'Horario', candidates: [{ id: 'hours', label: 'Horario aprobado' }] }
const flags = () => [null, clinicId].map(id => ({ name: 'docmee_laya', clinicId: id,
  enabled: true, rolloutPercentage: 100,
  metadata: { schemaVersion: 1, mode: 'live', tasks: ['kb_relevance'] } }))

describe('API-owned optional LAYA connection', () => {
  beforeEach(() => {
    vi.resetModules()
    state.read.mockReset().mockResolvedValue(flags())
    vi.stubEnv('DOCMEE_LAYA_ENDPOINT', '')
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

  it('does not acquire a database client or call inference by default', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const { getLayaAdapter } = await import('./laya.js')
    expect(getLayaAdapter()).toBeUndefined()
    expect(state.read).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('uses a process singleton and server-owned controls, with no live qualification', async () => {
    vi.stubEnv('DOCMEE_LAYA_ENDPOINT', 'http://127.0.0.1:9001')
    const fetcher = vi.fn(async (_url, init) => {
      const request = JSON.parse(String(init?.body))
      expect(Object.keys(request).sort()).toEqual(['candidates', 'language', 'requestId', 'schemaVersion', 'task', 'text'])
      return Response.json({ schemaVersion: 1, requestId: request.requestId,
        modelVersion: 'unconfigured', calibrationVersion: 'unconfigured', choiceId: 'hours', rawScore: 1, abstain: false })
    }); vi.stubGlobal('fetch', fetcher)
    const { getLayaAdapter } = await import('./laya.js')
    const adapter = getLayaAdapter()
    expect(adapter).toBeDefined()
    expect(getLayaAdapter()).toBe(adapter)
    expect(await adapter!.assess(input)).toMatchObject({ apply: false, reason: 'unqualified' })
    expect(state.read.mock.calls).toEqual([[clinicId], [clinicId]])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('fails closed when durable controls cannot be read', async () => {
    vi.stubEnv('DOCMEE_LAYA_ENDPOINT', 'http://127.0.0.1:9001')
    state.read.mockRejectedValue(new Error('private database detail'))
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const { getLayaAdapter } = await import('./laya.js')
    expect(getLayaAdapter()).toBeDefined()
    const result = await getLayaAdapter()!.assess(input)
    expect(result).toMatchObject({ apply: false, reason: 'disabled' })
    expect(JSON.stringify(result)).not.toContain('private database detail')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
