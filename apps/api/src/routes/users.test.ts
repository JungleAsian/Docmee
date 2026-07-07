import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// buildApp wires every route; stub the workspace deps so no real Redis/DB loads.
vi.mock('@docmee/queue', () => ({
  whatsappInboundQueue: { add: vi.fn() },
  kbEmbedQueue: { add: vi.fn() },
}))
vi.mock('@docmee/agents', () => ({ getOAuth2Client: () => ({}) }))
vi.mock('@docmee/shared', () => ({
  encryptValue: (v: string) => `enc:${v}`,
  verifyPassword: () => true,
  hashPassword: (v: string) => `hashed:${v}`,
}))

let nextId = 1
const store = vi.hoisted(() => ({
  users: new Map<string, Record<string, unknown>>(),
  roles: new Map<string, string>(), // userId -> role name
}))

function seedUser(u: Record<string, unknown>, role: string) {
  store.users.set(u.id as string, {
    panelLanguage: 'es',
    fullName: null,
    lastSeen: null,
    passwordHash: 'hashed:seed',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    ...u,
  })
  store.roles.set(u.id as string, role)
}

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createUsersRepository: () => ({
    listWithRoles: async (clinicId: string) =>
      [...store.users.values()]
        .filter((u) => u.clinicId === clinicId)
        .map((u) => ({ ...u, role: store.roles.get(u.id as string) ?? 'secretary' })),
    findById: async (clinicId: string, id: string) => {
      const row = store.users.get(id)
      return row && row.clinicId === clinicId ? row : null
    },
    findByEmail: async (clinicId: string, email: string) =>
      [...store.users.values()].find(
        (u) => u.clinicId === clinicId && (u.email as string).toLowerCase() === email.toLowerCase(),
      ) ?? null,
    create: async (input: Record<string, unknown>) => {
      const id = `u-new-${nextId++}`
      const row = {
        id,
        clinicId: input.clinicId,
        email: input.email,
        fullName: input.fullName ?? null,
        status: input.status ?? 'active',
        passwordHash: input.passwordHash ?? null,
        panelLanguage: input.panelLanguage ?? 'es',
        lastSeen: null,
        createdAt: '2026-06-19T00:00:00Z',
        updatedAt: '2026-06-19T00:00:00Z',
      }
      store.users.set(id, row)
      return row
    },
    update: async (clinicId: string, id: string, input: Record<string, unknown>) => {
      const row = store.users.get(id)
      if (!row || row.clinicId !== clinicId) return null
      const updated = { ...row }
      for (const [k, v] of Object.entries(input)) if (v !== undefined) updated[k] = v
      store.users.set(id, updated)
      return updated
    },
    delete: async (clinicId: string, id: string) => {
      const row = store.users.get(id)
      if (!row || row.clinicId !== clinicId) return false
      store.users.delete(id)
      store.roles.delete(id)
      return true
    },
    setRole: async (_clinicId: string, userId: string, role: string) => {
      store.roles.set(userId, role)
    },
  }),
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

const secretaryToken = signAccessToken({ userId: 'sec-tok', clinicId: 'c-1', role: 'secretary', email: 'ana@demo.test' })
const secretaryAuth = { authorization: `Bearer ${secretaryToken}` }
// The clinic admin's own clinic_users id is 'ca-1' (matches a seeded row for self-guard tests).
const clinicAdminToken = signAccessToken({ userId: 'ca-1', clinicId: 'c-1', role: 'clinic_admin', email: 'ca@demo.test' })
const clinicAdminAuth = { authorization: `Bearer ${clinicAdminToken}` }

describe('Clinic user routes (Req 1 — Admin Studio user management)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
    store.users.clear()
    store.roles.clear()
    seedUser({ id: 'ca-1', clinicId: 'c-1', email: 'ca@demo.test', fullName: 'Clinic Admin' }, 'clinic_admin')
    seedUser({ id: 'u-sec', clinicId: 'c-1', email: 'sec@demo.test', fullName: 'Ana Sec' }, 'secretary')
    seedUser({ id: 'u-other', clinicId: 'c-2', email: 'x@other.test' }, 'secretary')
  })
  afterAll(async () => {
    await app.close()
  })

  it('GET lists clinic users with roles, never the password hash', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/users', headers: clinicAdminAuth })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.users.length).toBe(2) // only c-1, not c-2
    expect(body.users[0]).not.toHaveProperty('passwordHash')
    expect(body.users.find((u: { id: string }) => u.id === 'u-sec').role).toBe('secretary')
  })

  it('GET without auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/users' })
    expect(res.statusCode).toBe(401)
  })

  it('GET (secretary) → 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/users', headers: secretaryAuth })
    expect(res.statusCode).toBe(403)
  })

  it('POST (clinic_admin) creates a user with role + hashed password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/users',
      headers: clinicAdminAuth,
      payload: { email: 'new@demo.test', fullName: 'Nuevo', password: 'supersecret', role: 'doctor' },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.user.email).toBe('new@demo.test')
    expect(body.user.role).toBe('doctor')
    expect(body.user).not.toHaveProperty('passwordHash')
    // Stored hash went through hashPassword (mocked).
    expect(store.users.get(body.user.id)?.passwordHash).toBe('hashed:supersecret')
  })

  it('POST with a duplicate email → 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/users',
      headers: clinicAdminAuth,
      payload: { email: 'sec@demo.test', role: 'secretary' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('POST (secretary) → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/users',
      headers: secretaryAuth,
      payload: { email: 'z@demo.test', role: 'secretary' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('POST with an invalid email → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/users',
      headers: clinicAdminAuth,
      payload: { email: 'not-an-email', role: 'secretary' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST with too-short password → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/users',
      headers: clinicAdminAuth,
      payload: { email: 'ok@demo.test', password: 'short', role: 'secretary' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST with ia_studio_admin role → 400 (not assignable per-clinic)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/users',
      headers: clinicAdminAuth,
      payload: { email: 'super@demo.test', role: 'ia_studio_admin' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('PATCH (clinic_admin) updates role + status', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/clinics/c-1/users/u-sec',
      headers: clinicAdminAuth,
      payload: { role: 'clinic_admin', status: 'inactive' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.user.role).toBe('clinic_admin')
    expect(body.user.status).toBe('inactive')
    expect(store.roles.get('u-sec')).toBe('clinic_admin')
  })

  it('PATCH for an unknown user → 404', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/clinics/c-1/users/missing',
      headers: clinicAdminAuth,
      payload: { fullName: 'x' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PATCH cannot cross clinics (c-2 user via c-1 admin) → 404', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/clinics/c-1/users/u-other',
      headers: clinicAdminAuth,
      payload: { fullName: 'x' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PATCH self role change → 400 (no self-demotion)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/clinics/c-1/users/ca-1',
      headers: clinicAdminAuth,
      payload: { role: 'secretary' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('PATCH self deactivate → 400 (no self-lockout)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/clinics/c-1/users/ca-1',
      headers: clinicAdminAuth,
      payload: { status: 'inactive' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('DELETE self → 400', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/clinics/c-1/users/ca-1', headers: clinicAdminAuth })
    expect(res.statusCode).toBe(400)
    expect(store.users.has('ca-1')).toBe(true)
  })

  it('DELETE (clinic_admin) removes a user', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/clinics/c-1/users/u-sec', headers: clinicAdminAuth })
    expect(res.statusCode).toBe(200)
    expect(store.users.has('u-sec')).toBe(false)
  })

  it('DELETE for an unknown user → 404', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/clinics/c-1/users/missing', headers: clinicAdminAuth })
    expect(res.statusCode).toBe(404)
  })
})
