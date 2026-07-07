import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// buildApp wires every route; stub the workspace deps so no real Redis/DB loads.
// @docmee/agents is loaded for real so the route serves the actual FLOW_TEMPLATES.
vi.mock('@docmee/queue', () => ({
  whatsappInboundQueue: { add: vi.fn() },
  kbEmbedQueue: { add: vi.fn() },
}))
vi.mock('@docmee/shared', () => ({
  encryptValue: (v: string) => `enc:${v}`,
  verifyPassword: () => true,
}))

let nextId = 1
const store = vi.hoisted(() => ({
  flows: new Map<string, Record<string, unknown>>([
    [
      'f-1',
      {
        id: 'f-1',
        clinicId: 'c-1',
        name: 'Precios',
        triggerKeywords: ['precio'],
        messages: ['Nuestros precios...'],
        action: 'end',
        language: 'both',
        enabled: true,
        steps: [],
        startStepId: null,
      },
    ],
  ]),
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createCustomFlowsRepository: () => ({
    listByClinic: async (clinicId: string) =>
      [...store.flows.values()].filter((f) => f.clinicId === clinicId),
    findById: async (clinicId: string, id: string) => {
      const row = store.flows.get(id)
      return row && row.clinicId === clinicId ? row : null
    },
    create: async (data: Record<string, unknown>) => {
      const id = `f-new-${nextId++}`
      const row = { id, ...data }
      store.flows.set(id, row)
      return row
    },
    update: async (clinicId: string, id: string, data: Record<string, unknown>) => {
      const row = store.flows.get(id)
      if (!row || row.clinicId !== clinicId) throw new Error('not found')
      const updated = { ...row, ...data }
      store.flows.set(id, updated)
      return updated
    },
    delete: async (clinicId: string, id: string) => {
      store.flows.delete(id)
    },
  }),
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

const secretaryToken = signAccessToken({ userId: 'u-1', clinicId: 'c-1', role: 'secretary', email: 'ana@demo.test' })
const secretaryAuth = { authorization: `Bearer ${secretaryToken}` }
const clinicAdminToken = signAccessToken({ userId: 'ca-1', clinicId: 'c-1', role: 'clinic_admin', email: 'ca@demo.test' })
const clinicAdminAuth = { authorization: `Bearer ${clinicAdminToken}` }

describe('Custom flow routes (Rev1 #28)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
  })

  it('GET /templates serves the five prebuilt flows', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/custom-flows/templates', headers: secretaryAuth })
    expect(res.statusCode).toBe(200)
    const keys = JSON.parse(res.body).templates.map((t: { key: string }) => t.key).sort()
    expect(keys).toEqual(['price', 'reschedule', 'review', 'schedule', 'surgery'])
  })

  it('GET /templates without auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/custom-flows/templates' })
    expect(res.statusCode).toBe(401)
  })

  it('GET lists the clinic flows', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/custom-flows', headers: secretaryAuth })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).flows.length).toBeGreaterThanOrEqual(1)
  })

  it('POST (clinic_admin) creates a multi-step flow', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/custom-flows',
      headers: clinicAdminAuth,
      payload: {
        name: 'Agendar',
        triggerKeywords: ['agendar'],
        startStepId: 'ask',
        steps: [
          { id: 'ask', messages: ['¿Motivo?'], collect: 'reason', branches: [{ op: 'any', next: 'confirm' }] },
          { id: 'confirm', messages: ['Listo: {{reason}}'], next: 'book' },
        ],
      },
    })
    expect(res.statusCode).toBe(201)
    const flow = JSON.parse(res.body).flow
    expect(flow.steps).toHaveLength(2)
    expect(flow.startStepId).toBe('ask')
  })

  it('POST with neither messages nor steps → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/custom-flows',
      headers: clinicAdminAuth,
      payload: { name: 'Vacío', triggerKeywords: ['x'] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST (secretary) → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/custom-flows',
      headers: secretaryAuth,
      payload: { name: 'x', triggerKeywords: ['x'], messages: ['y'] },
    })
    expect(res.statusCode).toBe(403)
  })

  it('PATCH (clinic_admin) updates a flow', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/clinics/c-1/custom-flows/f-1',
      headers: clinicAdminAuth,
      payload: { name: 'Precios editado', enabled: false },
    })
    expect(res.statusCode).toBe(200)
    const flow = JSON.parse(res.body).flow
    expect(flow.name).toBe('Precios editado')
    expect(flow.enabled).toBe(false)
  })

  it('PATCH for unknown flow → 404', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/clinics/c-1/custom-flows/missing',
      headers: clinicAdminAuth,
      payload: { name: 'x' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('DELETE (clinic_admin) removes a flow', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/custom-flows',
      headers: clinicAdminAuth,
      payload: { name: 'temp', triggerKeywords: ['t'], messages: ['m'] },
    })
    const id = JSON.parse(created.body).flow.id
    const del = await app.inject({ method: 'DELETE', url: `/clinics/c-1/custom-flows/${id}`, headers: clinicAdminAuth })
    expect(del.statusCode).toBe(200)
    expect(JSON.parse(del.body).deleted).toBe(true)
  })
})
