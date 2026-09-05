import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest'

// Item 1 of the 25-item batch — DELETE /clinics/:id (soft-delete behind a
// password re-check). buildApp wires every route, so stub the workspace deps
// the same way clinics-overview.test.ts does.
vi.mock('@docmee/queue', () => ({
  whatsappInboundQueue: { add: vi.fn() },
  kbEmbedQueue: { add: vi.fn() },
}))
vi.mock('@docmee/agents', async () => ({ SIMULATION_REPLAY_LIMITS: (await import('../../../../packages/agents/src/workflows/workflow-simulator.js')).SIMULATION_REPLAY_LIMITS, getOAuth2Client: () => ({}) }))

const verifyPassword = vi.fn((plaintext: string, _hash: string) => plaintext === 'correct-password')
vi.mock('@docmee/shared', () => ({
  encryptValue: (v: string) => `enc:${v}`,
  decryptValue: (v: string) => v,
  verifyPassword: (plaintext: string, hash: string) => verifyPassword(plaintext, hash),
}))

const findAuthByEmail = vi.fn(async (email: string) =>
  email === 's@demo.test' ? { id: 's-1', passwordHash: 'hash', status: 'active' } : null,
)
const findById = vi.fn(async (id: string) =>
  id === 'c-1' ? { id: 'c-1', status: 'active', settings: {} } : null,
)
const update = vi.fn(async (id: string, data: { status?: string }) => ({
  id,
  status: data.status ?? 'active',
  settings: {},
}))
const auditLog = vi.fn(async () => {})

vi.mock('@docmee/db', async () => ({ normalizeWorkflowStatus: (await import('../../../../packages/db/src/workflows/workflow-lifecycle.js')).normalizeWorkflowStatus,
  createServiceDbClient: () => ({ end: async () => {} }),
  toJson: (v: unknown) => v,
  createClinicsRepository: () => ({ findById, update, list: async () => [] }),
  createUsersRepository: () => ({ findAuthByEmail }),
  createAuditRepository: () => ({ log: auditLog }),
  createConversationsRepository: () => ({}),
  createPatientsRepository: () => ({}),
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

const studioToken = signAccessToken({ userId: 's-1', clinicId: 'c-1', role: 'ia_studio_admin', email: 's@demo.test' })
const studioAuth = { authorization: `Bearer ${studioToken}` }
const secretaryToken = signAccessToken({ userId: 'u-1', clinicId: 'c-1', role: 'secretary', email: 'ana@demo.test' })

describe('DELETE /clinics/:id (soft-delete behind a password check)', () => {
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
    findAuthByEmail.mockClear()
    findById.mockClear()
    update.mockClear()
    auditLog.mockClear()
  })

  it('soft-deletes (status -> cancelled) when the password is correct', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/clinics/c-1',
      headers: studioAuth,
      payload: { password: 'correct-password' },
    })
    expect(res.statusCode).toBe(200)
    expect(update).toHaveBeenCalledWith('c-1', { status: 'cancelled' })
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'clinic.deleted', resourceId: 'c-1' }))
  })

  it('rejects an incorrect password without touching the clinic', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/clinics/c-1',
      headers: studioAuth,
      payload: { password: 'wrong-password' },
    })
    expect(res.statusCode).toBe(401)
    expect(update).not.toHaveBeenCalled()
  })

  it('404s for an unknown clinic', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/clinics/missing',
      headers: studioAuth,
      payload: { password: 'correct-password' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('is admin-only — a secretary is forbidden', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/clinics/c-1',
      headers: { authorization: `Bearer ${secretaryToken}` },
      payload: { password: 'correct-password' },
    })
    expect(res.statusCode).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/clinics/c-1', payload: { password: 'x' } })
    expect(res.statusCode).toBe(401)
  })

  it('rejects a missing password body', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/clinics/c-1', headers: studioAuth, payload: {} })
    expect(res.statusCode).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })
})
