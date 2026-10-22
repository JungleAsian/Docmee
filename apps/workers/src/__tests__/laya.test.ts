import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ read: vi.fn(), end: vi.fn(), create: vi.fn(), sql: {} }))
vi.mock('@docmee/db', () => ({
  createServiceDbClient: state.create,
  createLayaControlsRepository: (sql: unknown) => {
    expect(sql).toBe(state.sql)
    return { readForClinic: state.read }
  },
}))
const clinicId = '84a7f77f-2f4f-45aa-b057-124f94ae41c4'
const input = { clinicId, task: 'kb_relevance' as const, language: 'es' as const,
  text: 'Horario', candidates: [{ id: 'hours', label: 'Horario aprobado' }] }
const flags = () => [null, clinicId].map(id => ({ name: 'docmee_laya', clinicId: id,
  enabled: true, rolloutPercentage: 100,
  metadata: { schemaVersion: 1, mode: 'live', tasks: ['kb_relevance'] } }))

describe('worker-owned optional LAYA connection', () => {
  beforeEach(() => {
    vi.resetModules()
    state.read.mockReset().mockResolvedValue(flags())
    state.end.mockReset().mockResolvedValue(undefined)
    state.sql = { end: state.end }
    state.create.mockReset().mockReturnValue(state.sql)
    vi.stubEnv('DOCMEE_LAYA_ENDPOINT', '')
    vi.stubEnv('DATABASE_URL', 'postgres://not-disclosed.example/test')
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

  it('does not open any new database connection or inference by default', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const { getLayaAdapter, closeLaya } = await import('../laya.js')
    expect(getLayaAdapter()).toBeUndefined()
    await closeLaya()
    expect(state.create).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('reuses one adapter and controls pool across jobs and closes it on shutdown', async () => {
    vi.stubEnv('DOCMEE_LAYA_ENDPOINT', 'http://127.0.0.1:9001')
    state.read.mockResolvedValue([])
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const { getLayaAdapter, closeLaya } = await import('../laya.js')
    const adapter = getLayaAdapter()
    expect(adapter).toBeDefined()
    expect(state.create).not.toHaveBeenCalled()
    expect(await adapter!.assess(input)).toMatchObject({ apply: false, reason: 'disabled' })
    expect(getLayaAdapter()).toBe(adapter)
    expect(await getLayaAdapter()!.assess(input)).toMatchObject({ reason: 'disabled' })
    expect(state.create).toHaveBeenCalledTimes(1)
    expect(state.read.mock.calls).toEqual([[clinicId], [clinicId]])
    expect(fetcher).not.toHaveBeenCalled()
    await closeLaya()
    expect(state.end).toHaveBeenCalledTimes(1)
    await closeLaya()
    expect(state.end).toHaveBeenCalledTimes(1)
  })

  it('retains a process-wide concurrency limit across jobs', async () => {
    vi.stubEnv('DOCMEE_LAYA_ENDPOINT', 'http://127.0.0.1:9001')
    let finish!: (value: Response) => void
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve }))
    vi.stubGlobal('fetch', fetcher)
    const { getLayaAdapter, closeLaya } = await import('../laya.js')
    const adapter = getLayaAdapter()
    expect(adapter).toBeDefined()
    const pending = adapter!.assess(input)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect(await getLayaAdapter()!.assess(input)).toMatchObject({ apply: false, reason: 'busy' })
    finish(Response.json({}))
    expect(await pending).toMatchObject({ apply: false, reason: 'invalid_response' })
    await closeLaya()
  })
})
