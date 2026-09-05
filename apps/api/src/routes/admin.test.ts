import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// buildApp wires every route; stub the workspace deps so no real Redis/DB/Google loads.
vi.mock('@docmee/queue', () => ({
  whatsappInboundQueue: { add: vi.fn() },
  kbEmbedQueue: { add: vi.fn() },
}))
vi.mock('@docmee/agents', async () => ({ SIMULATION_REPLAY_LIMITS: (await import('../../../../packages/agents/src/workflows/workflow-simulator.js')).SIMULATION_REPLAY_LIMITS, getOAuth2Client: () => ({}) }))
vi.mock('@docmee/shared', () => ({
  encryptValue: (v: string) => `enc:${v}`,
  verifyPassword: () => true,
}))

const store = vi.hoisted(() => ({
  clinics: [
    { id: 'c-1', name: 'Clinic One', slug: 'clinic-one', status: 'active' },
    { id: 'c-2', name: 'Clinic Two', slug: 'clinic-two', status: 'suspended' },
  ] as Record<string, unknown>[],
  members: [
    { id: 'u-1', clinicId: 'c-1', fullName: 'Ana Lopez', email: 'ana@demo.test', status: 'active', passwordHash: 'secret' },
    { id: 'u-2', clinicId: 'c-1', fullName: 'Beto Diaz', email: 'beto@demo.test', status: 'active', passwordHash: 'secret' },
  ] as Record<string, unknown>[],
  errors: new Map<string, Record<string, unknown>>([
    ['e-1', { id: 'e-1', clinicId: 'c-1', errorType: 'llm_failure', errorMessage: 'boom', status: 'open' }],
    ['e-2', { id: 'e-2', clinicId: 'c-1', errorType: 'unanswered_question', errorMessage: '¿Atienden domingos?', status: 'open' }],
  ]),
}))

vi.mock('@docmee/db', async () => ({ normalizeWorkflowStatus: (await import('../../../../packages/db/src/workflows/workflow-lifecycle.js')).normalizeWorkflowStatus,
  createServiceDbClient: () => ({ end: async () => {} }),
  createClinicsRepository: () => ({
    list: async () => store.clinics,
    findById: async (id: string) => store.clinics.find((c) => c.id === id) ?? null,
    findBySlug: async (slug: string) => store.clinics.find((c) => c.slug === slug) ?? null,
    countActive: async () => store.clinics.filter((c) => c.status === 'active').length,
    create: async (data: Record<string, unknown>) => ({ id: 'c-new', status: 'active', ...data }),
  }),
  createUsersRepository: () => ({
    listByClinic: async (clinicId: string) => store.members.filter((m) => m.clinicId === clinicId),
    listWithRoles: async (clinicId: string) => store.members.filter((m) => m.clinicId === clinicId),
  }),
  createErrorReviewsRepository: () => ({
    listByClinic: async (clinicId: string, filters: { status?: string } = {}) =>
      [...store.errors.values()].filter(
        (e) => e.clinicId === clinicId && (!filters.status || e.status === filters.status),
      ),
    findById: async (clinicId: string, id: string) => {
      const e = store.errors.get(id)
      return e && e.clinicId === clinicId ? e : null
    },
    resolve: async (clinicId: string, id: string, reviewedBy: string) => {
      const e = store.errors.get(id)
      if (!e || e.clinicId !== clinicId) return null
      const updated = { ...e, status: 'resolved', reviewedBy, resolvedAt: 'now' }
      store.errors.set(id, updated)
      return updated
    },
  }),
  createConversationsRepository: () => ({ countActive: async () => 0 }),
  createPatientsRepository: () => ({ list: async () => [] }),
  createMessagesRepository: () => ({}),
  createKnowledgeRepository: () => ({
    createDocument: async (data: Record<string, unknown>) => ({ id: 'doc-new', ...data }),
  }),
  createNotificationsRepository: () => ({}),
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

const adminToken = signAccessToken({ userId: 'admin-1', clinicId: 'c-1', role: 'ia_studio_admin', email: 'admin@demo.test' })
const adminAuth = { authorization: `Bearer ${adminToken}` }
const secretaryToken = signAccessToken({ userId: 'u-1', clinicId: 'c-1', role: 'secretary', email: 'ana@demo.test' })
const secretaryAuth = { authorization: `Bearer ${secretaryToken}` }
const clinicAdminToken = signAccessToken({ userId: 'ca-1', clinicId: 'c-1', role: 'clinic_admin', email: 'ca@demo.test' })
const clinicAdminAuth = { authorization: `Bearer ${clinicAdminToken}` }

describe('Admin Studio + AssignPanel routes (P09)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
  })

  it('GET /clinics (admin) lists all clinics', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics', headers: adminAuth })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).clinics).toHaveLength(2)
  })

  it('GET /clinics (non-admin) → 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics', headers: secretaryAuth })
    expect(res.statusCode).toBe(403)
  })

  it('GET /clinics/current returns the caller\'s own clinic (any role)', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/current', headers: secretaryAuth })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).clinic.id).toBe('c-1')
    expect(JSON.parse(res.body).clinic.name).toBe('Clinic One')
  })

  it('GET /clinics/current ignores a foreign X-Clinic-Id header (own clinic only)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/clinics/current',
      headers: { ...secretaryAuth, 'x-clinic-id': 'c-2' },
    })
    expect(res.statusCode).toBe(200)
    // /current reads the JWT clinic, never the active-clinic header.
    expect(JSON.parse(res.body).clinic.id).toBe('c-1')
  })

  it('GET /clinics/:id/team returns members without password hashes', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/team', headers: secretaryAuth })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.members).toHaveLength(2)
    expect(body.members[0]).not.toHaveProperty('passwordHash')
    expect(body.members[0].fullName).toBe('Ana Lopez')
  })

  it('GET /clinics/:id/errors lists open errors', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/errors', headers: clinicAdminAuth })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).errors).toHaveLength(2)
  })

  it('POST /clinics/:id/errors/:errorId/add-to-kb creates a KB doc and resolves', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/errors/e-2/add-to-kb',
      headers: clinicAdminAuth,
      payload: { title: '¿Atienden domingos?', content: 'Sí, atendemos los domingos de 9 a 14h.' },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.document.id).toBe('doc-new')
    expect(body.document.status).toBe('active')
    expect(body.error.status).toBe('resolved')
  })

  it('POST add-to-kb for unknown error → 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/errors/missing/add-to-kb',
      headers: clinicAdminAuth,
      payload: { title: 'x', content: 'y' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('POST add-to-kb without auth → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/errors/e-2/add-to-kb',
      payload: { title: 'x', content: 'y' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('POST /clinics/:id/errors/:errorId/resolve resolves the error', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/errors/e-1/resolve',
      headers: clinicAdminAuth,
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).error.status).toBe('resolved')
  })

  it('POST resolve for unknown error → 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/errors/missing/resolve',
      headers: clinicAdminAuth,
    })
    expect(res.statusCode).toBe(404)
  })
})
