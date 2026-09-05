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

const clinicId = '11111111-1111-4111-8111-111111111111'
let nextId = 1
const store = vi.hoisted(() => ({
  flows: new Map<string, Record<string, unknown>>([
    [
      'f-1',
      {
        id: 'f-1',
        clinicId: '11111111-1111-4111-8111-111111111111',
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

vi.mock('@docmee/db', async () => ({ normalizeWorkflowStatus: (await import('../../../../packages/db/src/workflows/workflow-lifecycle.js')).normalizeWorkflowStatus,
  createServiceDbClient: () => ({ end: async () => {} }),
  withClinicContext: async (_sql: unknown, _clinicId: string, fn: (sql: unknown) => Promise<unknown>) => fn({}),
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

const secretaryToken = signAccessToken({ userId: 'u-1', clinicId, role: 'secretary', email: 'ana@demo.test' })
const secretaryAuth = { authorization: `Bearer ${secretaryToken}` }
const clinicAdminToken = signAccessToken({ userId: 'ca-1', clinicId, role: 'clinic_admin', email: 'ca@demo.test' })
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
    const res = await app.inject({ method: 'GET', url: `/clinics/${clinicId}/custom-flows/templates`, headers: secretaryAuth })
    expect(res.statusCode).toBe(200)
    const keys = JSON.parse(res.body).templates.map((t: { key: string }) => t.key).sort()
    expect(keys).toEqual(['price', 'reschedule', 'review', 'schedule', 'surgery'])
  })

  it('GET /templates without auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: `/clinics/${clinicId}/custom-flows/templates` })
    expect(res.statusCode).toBe(401)
  })

  it('GET lists the clinic flows', async () => {
    const res = await app.inject({ method: 'GET', url: `/clinics/${clinicId}/custom-flows`, headers: secretaryAuth })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).flows.length).toBeGreaterThanOrEqual(1)
  })

  it('POST (clinic_admin) creates a multi-step flow', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/clinics/${clinicId}/custom-flows`,
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
      url: `/clinics/${clinicId}/custom-flows`,
      headers: clinicAdminAuth,
      payload: { name: 'Vacío', triggerKeywords: ['x'] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST (secretary) → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/clinics/${clinicId}/custom-flows`,
      headers: secretaryAuth,
      payload: { name: 'x', triggerKeywords: ['x'], messages: ['y'] },
    })
    expect(res.statusCode).toBe(403)
  })

  it('PATCH (clinic_admin) updates a flow', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/clinics/${clinicId}/custom-flows/f-1`,
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
      url: `/clinics/${clinicId}/custom-flows/missing`,
      headers: clinicAdminAuth,
      payload: { name: 'x' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('POST creates a single_choice node and round-trips its options', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/clinics/${clinicId}/custom-flows`,
      headers: clinicAdminAuth,
      payload: {
        name: 'Menú',
        triggerKeywords: ['menu'],
        startStepId: 'menu',
        steps: [
          {
            id: 'menu',
            type: 'single_choice',
            messages: ['¿Cómo podemos ayudarte?'],
            header: 'Menú',
            renderMode: 'buttons',
            options: [
              { optionId: 'book_appt', title: 'Agendar cita', goToNext: 'book' },
              { optionId: 'talk_staff', title: 'Hablar con el equipo', goToNext: 'handoff' },
            ],
          },
        ],
      },
    })
    expect(res.statusCode).toBe(201)
    const flow = JSON.parse(res.body).flow
    expect(flow.steps[0].options).toHaveLength(2)
    expect(flow.steps[0].options[0].optionId).toBe('book_appt')
  })

  it('POST defaults listButtonLabel to "Select" for renderMode: list when omitted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/clinics/${clinicId}/custom-flows`,
      headers: clinicAdminAuth,
      payload: {
        name: 'Menú lista',
        triggerKeywords: ['menu2'],
        startStepId: 'menu',
        steps: [
          {
            id: 'menu',
            type: 'single_choice',
            messages: ['Elige una opción'],
            renderMode: 'list',
            options: [{ optionId: 'a', title: 'A', goToNext: 'end' }],
          },
        ],
      },
    })
    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).flow.steps[0].listButtonLabel).toBe('Select')
  })

  it('POST rejects a single_choice step with no options', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/clinics/${clinicId}/custom-flows`,
      headers: clinicAdminAuth,
      payload: {
        name: 'x',
        triggerKeywords: ['x1'],
        startStepId: 'menu',
        steps: [{ id: 'menu', type: 'single_choice', messages: ['?'], options: [] }],
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST rejects more options than the renderMode limit (3 for buttons)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/clinics/${clinicId}/custom-flows`,
      headers: clinicAdminAuth,
      payload: {
        name: 'x',
        triggerKeywords: ['x2'],
        startStepId: 'menu',
        steps: [
          {
            id: 'menu',
            type: 'single_choice',
            messages: ['?'],
            renderMode: 'buttons',
            options: [
              { optionId: 'a', title: 'A', goToNext: 'end' },
              { optionId: 'b', title: 'B', goToNext: 'end' },
              { optionId: 'c', title: 'C', goToNext: 'end' },
              { optionId: 'd', title: 'D', goToNext: 'end' },
            ],
          },
        ],
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST rejects a duplicate optionId within a node', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/clinics/${clinicId}/custom-flows`,
      headers: clinicAdminAuth,
      payload: {
        name: 'x',
        triggerKeywords: ['x3'],
        startStepId: 'menu',
        steps: [
          {
            id: 'menu',
            type: 'single_choice',
            messages: ['?'],
            options: [
              { optionId: 'a', title: 'A', goToNext: 'end' },
              { optionId: 'a', title: 'A2', goToNext: 'handoff' },
            ],
          },
        ],
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST rejects a goToNext that references an unknown step', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/clinics/${clinicId}/custom-flows`,
      headers: clinicAdminAuth,
      payload: {
        name: 'x',
        triggerKeywords: ['x4'],
        startStepId: 'menu',
        steps: [
          { id: 'menu', type: 'single_choice', messages: ['?'], options: [{ optionId: 'a', title: 'A', goToNext: 'nonexistent_step' }] },
        ],
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST rejects an onFailNext that references an unknown step', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/clinics/${clinicId}/custom-flows`,
      headers: clinicAdminAuth,
      payload: {
        name: 'x',
        triggerKeywords: ['x5'],
        startStepId: 'menu',
        steps: [
          {
            id: 'menu',
            type: 'single_choice',
            messages: ['?'],
            onFailNext: 'nonexistent_step',
            options: [{ optionId: 'a', title: 'A', goToNext: 'end' }],
          },
        ],
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('DELETE (clinic_admin) removes a flow', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/clinics/${clinicId}/custom-flows`,
      headers: clinicAdminAuth,
      payload: { name: 'temp', triggerKeywords: ['t'], messages: ['m'] },
    })
    const id = JSON.parse(created.body).flow.id
    const del = await app.inject({ method: 'DELETE', url: `/clinics/${clinicId}/custom-flows/${id}`, headers: clinicAdminAuth })
    expect(del.statusCode).toBe(200)
    expect(JSON.parse(del.body).deleted).toBe(true)
  })
})
