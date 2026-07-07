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

const DASHBOARD = {
  upsetPatients: 5,
  upsetUnresolved: 2,
  abandonedConversations: 3,
  avgBotResponseSeconds: 12,
  avgSecretaryResponseSeconds: 126,
  unclosedConversations: 9,
  unclosedAged: 4,
  followUpOpportunities: 7,
  pendingFollowUps: 6,
  staleHours: 24,
  attention: [
    {
      conversationId: 'a',
      patientName: 'Ana',
      status: 'open',
      channel: 'whatsapp',
      reason: 'upset',
      mode: 'bot',
      lastMessageAt: '2026-06-18T10:00:00.000Z',
    },
  ],
}

const lastStaleHours = vi.hoisted(() => ({ value: 0 }))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createClinicsRepository: () => ({
    findById: async (id: string) => (id === 'c-1' ? { id: 'c-1', timezone: 'UTC' } : null),
  }),
  createQosRepository: () => ({
    dashboard: async (_clinicId: string, staleHours: number) => {
      lastStaleHours.value = staleHours
      return { ...DASHBOARD, staleHours }
    },
  }),
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

const secretaryToken = signAccessToken({ userId: 'u-1', clinicId: 'c-1', role: 'secretary', email: 'ana@demo.test' })
const secretaryAuth = { authorization: `Bearer ${secretaryToken}` }
const adminToken = signAccessToken({ userId: 'ca-1', clinicId: 'c-1', role: 'clinic_admin', email: 'ca@demo.test' })
const adminAuth = { authorization: `Bearer ${adminToken}` }

describe('QoS monitoring routes (Req 32)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
  })

  it('GET returns the QoS dashboard for a clinic_admin', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/qos', headers: adminAuth })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.qos.upsetPatients).toBe(5)
    expect(body.qos.avgSecretaryResponseSeconds).toBe(126)
    expect(body.qos.attention).toHaveLength(1)
    expect(body.qos.staleHours).toBe(24) // default when unspecified
  })

  it('honors and clamps the staleHours query param', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/qos?staleHours=999', headers: adminAuth })
    expect(res.statusCode).toBe(200)
    expect(lastStaleHours.value).toBe(168) // clamped to one week
  })

  it('GET as a secretary → 403 (clinic_admin / ia_studio_admin only)', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/qos', headers: secretaryAuth })
    expect(res.statusCode).toBe(403)
  })

  it('GET without auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/qos' })
    expect(res.statusCode).toBe(401)
  })

  it('unknown clinic → 404', async () => {
    // A clinic_admin is scoped to their own clinic, so use an ia_studio_admin to reach an absent clinic.
    const studioToken = signAccessToken({ userId: 's-1', clinicId: 'c-1', role: 'ia_studio_admin', email: 's@demo.test' })
    const res = await app.inject({
      method: 'GET',
      url: '/clinics/missing/qos',
      headers: { authorization: `Bearer ${studioToken}` },
    })
    expect(res.statusCode).toBe(404)
  })
})
