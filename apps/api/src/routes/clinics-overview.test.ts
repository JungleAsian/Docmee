import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// buildApp wires every route; stub the workspace deps so no real Redis/DB/Google loads.
vi.mock('@docmee/queue', () => ({
  whatsappInboundQueue: { add: vi.fn() },
  kbEmbedQueue: { add: vi.fn() },
}))
vi.mock('@docmee/agents', () => ({ getOAuth2Client: () => ({}) }))
vi.mock('@docmee/shared', () => ({
  encryptValue: (v: string) => `enc:${v}`,
  verifyPassword: () => true,
}))

const directoryStats = vi.fn(async () => [
  { clinicId: 'c-1', users: 8, openChats: 6, handoff: 1, urgent: 0 },
  { clinicId: 'c-2', users: 12, openChats: 14, handoff: 3, urgent: 2 },
])

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createClinicsRepository: () => ({ directoryStats }),
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

const studioToken = signAccessToken({ userId: 's-1', clinicId: 'c-1', role: 'ia_studio_admin', email: 's@demo.test' })
const studioAuth = { authorization: `Bearer ${studioToken}` }
const secretaryToken = signAccessToken({ userId: 'u-1', clinicId: 'c-1', role: 'secretary', email: 'ana@demo.test' })

describe('GET /clinics/overview (Screen 6 — clinic directory stats)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
  })

  it('returns per-clinic operational counts for an ia_studio_admin', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/overview', headers: studioAuth })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.stats).toHaveLength(2)
    expect(body.stats[1]).toMatchObject({ clinicId: 'c-2', users: 12, openChats: 14, handoff: 3, urgent: 2 })
  })

  it('is admin-only — a secretary is forbidden', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/clinics/overview',
      headers: { authorization: `Bearer ${secretaryToken}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/overview' })
    expect(res.statusCode).toBe(401)
  })

  it('does not collide with /:id (static route wins)', async () => {
    // /overview must reach the directory handler, not the GET /:id clinic handler.
    const res = await app.inject({ method: 'GET', url: '/clinics/overview', headers: studioAuth })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(JSON.parse(res.body).stats)).toBe(true)
  })
})
