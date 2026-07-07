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

const SUMMARY = {
  id: 'r-1',
  type: 'daily',
  periodStart: '2026-06-18T08:00:00.000Z',
  periodEnd: '2026-06-19T08:00:00.000Z',
  subject: 'Demo: daily report',
  recipientEmail: 'admin@demo.test',
  emailed: true,
  createdAt: '2026-06-19T08:00:00.000Z',
}
const FULL = { ...SUMMARY, html: '<h2>Daily</h2>', data: { conversations: 4 } }

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createClinicsRepository: () => ({
    findById: async (id: string) => (id === 'c-1' ? { id: 'c-1', timezone: 'UTC' } : null),
  }),
  createReportsRepository: () => ({
    listByClinic: async (clinicId: string) => (clinicId === 'c-1' ? [SUMMARY] : []),
    findById: async (clinicId: string, id: string) =>
      clinicId === 'c-1' && id === 'r-1' ? FULL : null,
  }),
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

const secretaryToken = signAccessToken({ userId: 'u-1', clinicId: 'c-1', role: 'secretary', email: 'ana@demo.test' })
const secretaryAuth = { authorization: `Bearer ${secretaryToken}` }
const adminToken = signAccessToken({ userId: 'ca-1', clinicId: 'c-1', role: 'clinic_admin', email: 'ca@demo.test' })
const adminAuth = { authorization: `Bearer ${adminToken}` }

describe('Automatic reports routes (Req 37)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
  })

  it('GET lists the clinic reports for a clinic_admin', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/reports', headers: adminAuth })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.reports).toHaveLength(1)
    expect(body.reports[0].subject).toBe('Demo: daily report')
    expect(body.reports[0].html).toBeUndefined() // list omits the html body
  })

  it('GET one report returns the rendered html', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/reports/r-1', headers: adminAuth })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.report.html).toContain('<h2>Daily</h2>')
  })

  it('GET an unknown report → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/reports/missing', headers: adminAuth })
    expect(res.statusCode).toBe(404)
  })

  it('GET as a secretary → 403 (clinic_admin / ia_studio_admin only)', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/reports', headers: secretaryAuth })
    expect(res.statusCode).toBe(403)
  })

  it('GET without auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/reports' })
    expect(res.statusCode).toBe(401)
  })

  it('unknown clinic → 404', async () => {
    const studioToken = signAccessToken({ userId: 's-1', clinicId: 'c-1', role: 'ia_studio_admin', email: 's@demo.test' })
    const res = await app.inject({
      method: 'GET',
      url: '/clinics/missing/reports',
      headers: { authorization: `Bearer ${studioToken}` },
    })
    expect(res.statusCode).toBe(404)
  })
})
