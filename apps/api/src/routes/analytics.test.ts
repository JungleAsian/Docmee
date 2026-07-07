import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

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

const ANALYTICS = {
  totalConversations: 20,
  resolutionRate: 0.6,
  avgConversationLength: 4.3,
  handoffRate: 0.25,
  automationRate: 0.55,
  kbHitRate: 0.4,
  newPatients: 7,
  returningPatients: 13,
  peakHours: [{ dayOfWeek: 1, hour: 9, count: 5 }],
}

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createClinicsRepository: () => ({
    findById: async (id: string) => (id === 'c-1' ? { id: 'c-1', timezone: 'UTC' } : null),
  }),
  createAnalyticsRepository: () => ({
    advanced: async () => ANALYTICS,
  }),
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

const secretaryToken = signAccessToken({ userId: 'u-1', clinicId: 'c-1', role: 'secretary', email: 'ana@demo.test' })
const secretaryAuth = { authorization: `Bearer ${secretaryToken}` }
const adminToken = signAccessToken({ userId: 'ca-1', clinicId: 'c-1', role: 'clinic_admin', email: 'ca@demo.test' })
const adminAuth = { authorization: `Bearer ${adminToken}` }
const studioToken = signAccessToken({ userId: 's-1', clinicId: 'c-1', role: 'ia_studio_admin', email: 's@demo.test' })

describe('Advanced analytics route (Req 40 — FEATURE_ADVANCED_ANALYTICS gated)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
    delete process.env['FEATURE_ADVANCED_ANALYTICS']
  })
  beforeEach(() => {
    process.env['FEATURE_ADVANCED_ANALYTICS'] = 'true'
  })

  it('returns 404 for everyone when the feature flag is off', async () => {
    process.env['FEATURE_ADVANCED_ANALYTICS'] = 'false'
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/analytics', headers: adminAuth })
    expect(res.statusCode).toBe(404)
  })

  it('treats the literal string "false" as off (no z.coerce.boolean footgun)', async () => {
    process.env['FEATURE_ADVANCED_ANALYTICS'] = 'false'
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/analytics', headers: adminAuth })
    expect(res.statusCode).toBe(404)
  })

  it('serves the dashboard for a clinic_admin when enabled', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/analytics', headers: adminAuth })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.analytics.totalConversations).toBe(20)
    expect(body.analytics.automationRate).toBeCloseTo(0.55)
    expect(body.range.from).toBeTruthy()
    expect(body.range.to).toBeTruthy()
  })

  it('GET as a secretary → 403 even when enabled', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/analytics', headers: secretaryAuth })
    expect(res.statusCode).toBe(403)
  })

  it('GET without auth → 401 when enabled', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/analytics' })
    expect(res.statusCode).toBe(401)
  })

  it('unknown clinic → 404 (ia_studio_admin reaches an absent clinic)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/clinics/missing/analytics',
      headers: { authorization: `Bearer ${studioToken}` },
    })
    expect(res.statusCode).toBe(404)
  })
})
