import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

// buildApp wires every route; stub the workspace deps so no real Redis/DB loads.
vi.mock('@docmee/queue', () => ({
  whatsappInboundQueue: { add: vi.fn() },
  kbEmbedQueue: { add: vi.fn() },
}))
vi.mock('@docmee/agents', async () => ({ SIMULATION_REPLAY_LIMITS: (await import('../../../../packages/agents/src/workflows/workflow-simulator.js')).SIMULATION_REPLAY_LIMITS, getOAuth2Client: () => ({}) }))

const h = vi.hoisted(() => ({ list: vi.fn() }))

vi.mock('@docmee/db', async () => ({
  normalizeWorkflowStatus: (await import('../../../../packages/db/src/workflows/workflow-lifecycle.js')).normalizeWorkflowStatus,
  createServiceDbClient: () => ({ end: async () => {} }),
  createChangeLogRepository: () => ({ log: vi.fn(), list: h.list }),
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

const CLINIC = 'c0000000-0000-0000-0000-000000000001'
const bearer = (role: 'secretary' | 'clinic_admin' | 'ia_studio_admin') => ({
  authorization: `Bearer ${signAccessToken({ userId: 'u-1', clinicId: CLINIC, role, email: `${role}@demo.test` })}`,
})

describe('GET /change-log (superuser only)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    h.list.mockReset().mockResolvedValue([])
  })

  it('rejects anonymous callers', async () => {
    const res = await app.inject({ method: 'GET', url: '/change-log' })
    expect(res.statusCode).toBe(401)
  })

  it.each(['secretary', 'clinic_admin'] as const)('hides the log from %s', async (role) => {
    const res = await app.inject({ method: 'GET', url: '/change-log', headers: bearer(role) })
    expect(res.statusCode).toBe(403)
    expect(h.list).not.toHaveBeenCalled()
  })

  it('lists entries for a superuser with the requested filters', async () => {
    h.list.mockResolvedValue([{ id: 'e1', createdAt: '2026-10-06T00:00:00.000Z', summary: 'Workflow updated' }])
    const res = await app.inject({
      method: 'GET',
      url: `/change-log?clinic_id=${CLINIC}&area=workflow&outcome=succeeded&q=booking&limit=50`,
      headers: bearer('ia_studio_admin'),
    })
    expect(res.statusCode).toBe(200)
    expect(h.list).toHaveBeenCalledWith({ clinicId: CLINIC, area: 'workflow', outcome: 'succeeded', search: 'booking', before: undefined, limit: 50 })
    const body = JSON.parse(res.body)
    expect(body.entries).toHaveLength(1)
    expect(body.areas).toContain('workflow')
    expect(body.nextBefore).toBeNull()
  })

  it('rejects an unknown area', async () => {
    const res = await app.inject({ method: 'GET', url: '/change-log?area=nope', headers: bearer('ia_studio_admin') })
    expect(res.statusCode).toBe(400)
  })
})
