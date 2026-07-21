import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@docmee/queue', () => ({
  whatsappInboundQueue: { add: vi.fn() },
  kbEmbedQueue: { add: vi.fn() },
  createQueue: () => ({ add: vi.fn() }),
}))
vi.mock('@docmee/agents', () => ({
  getOAuth2Client: () => ({}),
  validateWorkflowDefinition: () => [],
}))
vi.mock('@docmee/shared', () => ({
  encryptValue: (value: string) => `enc:${value}`,
  verifyPassword: () => true,
}))

const store = vi.hoisted(() => ({
  workflows: new Map<string, { id: string; clinicId: string; name: string; status: 'draft'; nodes: unknown[]; edges: unknown[] }>(),
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createWorkflowsRepository: () => ({
    listByClinic: async (clinicId: string) => [...store.workflows.values()].filter((workflow) => workflow.clinicId === clinicId),
    findById: async (clinicId: string, id: string) => {
      const workflow = store.workflows.get(id)
      return workflow?.clinicId === clinicId ? workflow : null
    },
    delete: async (clinicId: string, id: string) => {
      const workflow = store.workflows.get(id)
      if (!workflow || workflow.clinicId !== clinicId) return false
      store.workflows.delete(id)
      return true
    },
  }),
  createWorkflowApprovalsRepository: () => ({}),
  createAuditRepository: () => ({ log: vi.fn() }),
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

const adminAuth = {
  authorization: `Bearer ${signAccessToken({ userId: 'admin-c1', clinicId: 'c-1', role: 'clinic_admin', email: 'admin@c1.test' })}`,
}
const secretaryAuth = {
  authorization: `Bearer ${signAccessToken({ userId: 'sec-c1', clinicId: 'c-1', role: 'secretary', email: 'sec@c1.test' })}`,
}

function seed(id: string, clinicId = 'c-1') {
  store.workflows.set(id, { id, clinicId, name: id, status: 'draft', nodes: [], edges: [] })
}

describe('workflow delete contract (CRE-534)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns the documented success result for an existing scoped workflow', async () => {
    seed('wf-existing')
    const response = await app.inject({ method: 'DELETE', url: '/clinics/c-1/workflows/wf-existing', headers: adminAuth })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ deleted: true })
    expect(store.workflows.has('wf-existing')).toBe(false)
  })

  it('returns the same non-leaking 404 for missing, already absent, and malformed ids', async () => {
    for (const id of ['missing', 'not-a-workflow-id']) {
      const response = await app.inject({ method: 'DELETE', url: `/clinics/c-1/workflows/${id}`, headers: adminAuth })
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'Workflow not found' })
    }

    seed('wf-once')
    expect((await app.inject({ method: 'DELETE', url: '/clinics/c-1/workflows/wf-once', headers: adminAuth })).statusCode).toBe(200)
    const absent = await app.inject({ method: 'DELETE', url: '/clinics/c-1/workflows/wf-once', headers: adminAuth })
    expect(absent.statusCode).toBe(404)
    expect(absent.json()).toEqual({ error: 'Workflow not found' })
  })

  it('does not reveal a workflow in another clinic and rejects unprivileged callers', async () => {
    seed('wf-c2', 'c-2')
    const crossClinic = await app.inject({ method: 'DELETE', url: '/clinics/c-1/workflows/wf-c2', headers: adminAuth })
    expect(crossClinic.statusCode).toBe(404)
    expect(crossClinic.json()).toEqual({ error: 'Workflow not found' })

    const foreignScope = await app.inject({ method: 'DELETE', url: '/clinics/c-2/workflows/wf-c2', headers: adminAuth })
    expect(foreignScope.statusCode).toBe(403)
    expect(foreignScope.json()).toEqual({ error: 'Forbidden' })

    const unprivileged = await app.inject({ method: 'DELETE', url: '/clinics/c-1/workflows/missing', headers: secretaryAuth })
    expect(unprivileged.statusCode).toBe(403)
  })

  it('makes concurrent deletes deterministic: exactly one success and one truthful absence', async () => {
    seed('wf-race')
    const [first, second] = await Promise.all([
      app.inject({ method: 'DELETE', url: '/clinics/c-1/workflows/wf-race', headers: adminAuth }),
      app.inject({ method: 'DELETE', url: '/clinics/c-1/workflows/wf-race', headers: adminAuth }),
    ])
    const statuses = [first.statusCode, second.statusCode].sort()
    expect(statuses).toEqual([200, 404])
  })
})
