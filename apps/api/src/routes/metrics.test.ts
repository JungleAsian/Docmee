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

// Capture the window the route forwards to the repository so we can assert the
// period filter (Req 17) is whitelisted before it reaches the aggregate queries.
const dashboard = vi.fn(async (_clinicId: string, _tz: string, windowDays?: number) => ({
  conversationsToday: 2,
  windowDays,
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createClinicsRepository: () => ({
    findById: async (id: string) => (id === 'c-1' ? { id: 'c-1', timezone: 'UTC' } : null),
  }),
  createMetricsRepository: () => ({ dashboard }),
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

const secretaryToken = signAccessToken({ userId: 'u-1', clinicId: 'c-1', role: 'secretary', email: 'ana@demo.test' })
const secretaryAuth = { authorization: `Bearer ${secretaryToken}` }
const adminToken = signAccessToken({ userId: 'ca-1', clinicId: 'c-1', role: 'clinic_admin', email: 'ca@demo.test' })
const adminAuth = { authorization: `Bearer ${adminToken}` }
const studioToken = signAccessToken({ userId: 's-1', clinicId: 'c-1', role: 'ia_studio_admin', email: 's@demo.test' })

describe('Metrics dashboard route (Req 17 — period filter)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
  })

  it('serves the dashboard for a clinic_admin and defaults to a 30-day window', async () => {
    dashboard.mockClear()
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/metrics', headers: adminAuth })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.metrics.conversationsToday).toBe(2)
    expect(body.window).toBe(30)
    expect(dashboard).toHaveBeenCalledWith('c-1', 'UTC', 30)
  })

  it('honours a whitelisted window (?window=7)', async () => {
    dashboard.mockClear()
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/metrics?window=7', headers: adminAuth })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).window).toBe(7)
    expect(dashboard).toHaveBeenCalledWith('c-1', 'UTC', 7)
  })

  it('falls back to 30 for a non-whitelisted window (?window=999)', async () => {
    dashboard.mockClear()
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/metrics?window=999', headers: adminAuth })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).window).toBe(30)
    expect(dashboard).toHaveBeenCalledWith('c-1', 'UTC', 30)
  })

  it('GET as a secretary → 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/metrics', headers: secretaryAuth })
    expect(res.statusCode).toBe(403)
  })

  it('GET without auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/metrics' })
    expect(res.statusCode).toBe(401)
  })

  it('unknown clinic → 404 (ia_studio_admin reaches an absent clinic)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/clinics/missing/metrics',
      headers: { authorization: `Bearer ${studioToken}` },
    })
    expect(res.statusCode).toBe(404)
  })
})
