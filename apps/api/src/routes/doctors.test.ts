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

let nextId = 1
const store = vi.hoisted(() => ({
  doctors: new Map<string, Record<string, unknown>>([
    [
      'doc-1',
      {
        id: 'doc-1',
        clinicId: 'c-1',
        name: 'Dra. García',
        specialty: 'Pediatría',
        googleCalendarId: null,
        googleCalendarAccessTokenEncrypted: null,
        googleCalendarRefreshTokenEncrypted: null,
        availableDays: {},
        isActive: true,
        createdAt: '2026-06-01T00:00:00Z',
        updatedAt: '2026-06-01T00:00:00Z',
      },
    ],
  ]),
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createDoctorsRepository: () => ({
    listByClinic: async (clinicId: string) =>
      [...store.doctors.values()].filter((d) => d.clinicId === clinicId),
    findById: async (clinicId: string, id: string) => {
      const row = store.doctors.get(id)
      return row && row.clinicId === clinicId ? row : null
    },
    create: async (data: Record<string, unknown>) => {
      const id = `doc-new-${nextId++}`
      const row = {
        id,
        googleCalendarId: null,
        googleCalendarAccessTokenEncrypted: null,
        googleCalendarRefreshTokenEncrypted: null,
        availableDays: {},
        isActive: true,
        createdAt: '2026-06-19T00:00:00Z',
        updatedAt: '2026-06-19T00:00:00Z',
        ...data,
      }
      store.doctors.set(id, row)
      return row
    },
    update: async (clinicId: string, id: string, data: Record<string, unknown>) => {
      const row = store.doctors.get(id)
      if (!row || row.clinicId !== clinicId) throw new Error('not found')
      const updated = { ...row }
      for (const [k, v] of Object.entries(data)) if (v !== undefined) updated[k] = v
      store.doctors.set(id, updated)
      return updated
    },
    delete: async (clinicId: string, id: string) => {
      const row = store.doctors.get(id)
      if (row && row.clinicId === clinicId) store.doctors.delete(id)
    },
  }),
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

const secretaryToken = signAccessToken({ userId: 'u-1', clinicId: 'c-1', role: 'secretary', email: 'ana@demo.test' })
const secretaryAuth = { authorization: `Bearer ${secretaryToken}` }
const clinicAdminToken = signAccessToken({ userId: 'ca-1', clinicId: 'c-1', role: 'clinic_admin', email: 'ca@demo.test' })
const clinicAdminAuth = { authorization: `Bearer ${clinicAdminToken}` }

describe('Doctor routes (Req 30 — multi-doctor + per-doctor hours)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
  })

  it('GET lists clinic doctors for any clinic user (redacted, no tokens)', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/doctors', headers: secretaryAuth })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.doctors.length).toBeGreaterThanOrEqual(1)
    expect(body.doctors[0]).not.toHaveProperty('googleCalendarAccessTokenEncrypted')
    expect(body.doctors[0]).toHaveProperty('calendarConnected')
  })

  it('GET without auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/doctors' })
    expect(res.statusCode).toBe(401)
  })

  it('POST (clinic_admin) creates a doctor with valid working hours', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/doctors',
      headers: clinicAdminAuth,
      payload: {
        name: 'Dr. López',
        specialty: 'Cardiología',
        availableDays: {
          mon: [{ start: '09:00', end: '13:00' }, { start: '15:00', end: '18:00' }],
          wed: [{ start: '09:00', end: '14:00' }],
        },
      },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.doctor.name).toBe('Dr. López')
    expect(body.doctor.availableDays.mon).toHaveLength(2)
  })

  it('POST (secretary) → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/doctors',
      headers: secretaryAuth,
      payload: { name: 'x' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('POST with a malformed time → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/doctors',
      headers: clinicAdminAuth,
      payload: { name: 'Dr. Bad', availableDays: { mon: [{ start: '9am', end: '5pm' }] } },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST with a reversed range (start ≥ end) → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/doctors',
      headers: clinicAdminAuth,
      payload: { name: 'Dr. Rev', availableDays: { mon: [{ start: '17:00', end: '09:00' }] } },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST with an unknown weekday key → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/doctors',
      headers: clinicAdminAuth,
      payload: { name: 'Dr. X', availableDays: { funday: [{ start: '09:00', end: '10:00' }] } },
    })
    expect(res.statusCode).toBe(400)
  })

  it('PATCH (clinic_admin) updates working hours + isActive', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/clinics/c-1/doctors/doc-1',
      headers: clinicAdminAuth,
      payload: { availableDays: { fri: [{ start: '08:00', end: '12:00' }] }, isActive: false },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.doctor.availableDays.fri).toHaveLength(1)
    expect(body.doctor.isActive).toBe(false)
  })

  it('PATCH for unknown doctor → 404', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/clinics/c-1/doctors/missing',
      headers: clinicAdminAuth,
      payload: { name: 'x' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PATCH (secretary) → 403', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/clinics/c-1/doctors/doc-1',
      headers: secretaryAuth,
      payload: { name: 'x' },
    })
    expect(res.statusCode).toBe(403)
  })
})
