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

const SVC_1 = '11111111-1111-1111-1111-111111111111'
const SVC_2 = '22222222-2222-2222-2222-222222222222'
const SVC_OTHER_CLINIC = '99999999-9999-9999-9999-999999999999'

let nextId = 1
const store = vi.hoisted(() => ({
  services: new Map<string, Record<string, unknown>>([
    ['11111111-1111-1111-1111-111111111111', { id: '11111111-1111-1111-1111-111111111111', clinicId: 'c-1', name: 'Consulta general', durationMinutes: 30, isActive: true }],
    ['22222222-2222-2222-2222-222222222222', { id: '22222222-2222-2222-2222-222222222222', clinicId: 'c-1', name: 'Limpieza dental', durationMinutes: 45, isActive: true }],
  ]),
  doctors: new Map<string, Record<string, unknown>>([
    ['doc-1', { id: 'doc-1', clinicId: 'c-1', name: 'Dra. García' }],
  ]),
  // key: `${doctorId}:${serviceId}`
  assignments: new Set<string>(),
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createAppointmentsRepository: () => ({
    listServices: async (clinicId: string) =>
      [...store.services.values()].filter((s) => s.clinicId === clinicId),
    createService: async (data: Record<string, unknown>) => {
      const id = `svc-new-${nextId++}`
      const row = { id, durationMinutes: 30, currency: 'GTQ', isActive: true, ...data }
      store.services.set(id, row)
      return row
    },
  }),
  createDoctorsRepository: () => ({
    findById: async (clinicId: string, id: string) => {
      const row = store.doctors.get(id)
      return row && row.clinicId === clinicId ? row : null
    },
  }),
  createDoctorServicesRepository: () => ({
    listServicesForDoctor: async (_clinicId: string, doctorId: string) =>
      [...store.services.values()].filter((s) => store.assignments.has(`${doctorId}:${s.id}`)),
    assign: async (_clinicId: string, doctorId: string, serviceId: string) => {
      store.assignments.add(`${doctorId}:${serviceId}`)
    },
    remove: async (_clinicId: string, doctorId: string, serviceId: string) => {
      store.assignments.delete(`${doctorId}:${serviceId}`)
    },
  }),
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

const secretaryToken = signAccessToken({ userId: 'u-1', clinicId: 'c-1', role: 'secretary', email: 'ana@demo.test' })
const secretaryAuth = { authorization: `Bearer ${secretaryToken}` }
const clinicAdminToken = signAccessToken({ userId: 'ca-1', clinicId: 'c-1', role: 'clinic_admin', email: 'ca@demo.test' })
const clinicAdminAuth = { authorization: `Bearer ${clinicAdminToken}` }

describe('Service + per-doctor assignment routes (Req 30)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
  })

  it('GET /clinics/:id/services lists the clinic services', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/services', headers: secretaryAuth })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).services.length).toBe(2)
  })

  it('GET services without auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/services' })
    expect(res.statusCode).toBe(401)
  })

  it('POST /clinics/:id/services (clinic_admin) creates a service', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/services',
      headers: clinicAdminAuth,
      payload: { name: 'Ortodoncia', durationMinutes: 60 },
    })
    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).service.name).toBe('Ortodoncia')
  })

  it('POST services (secretary) → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/services',
      headers: secretaryAuth,
      payload: { name: 'x' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('POST assign (clinic_admin) attaches a clinic service to a doctor', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/doctors/doc-1/services',
      headers: clinicAdminAuth,
      payload: { serviceId: SVC_2 },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.services.map((s: { id: string }) => s.id)).toContain(SVC_2)
  })

  it('GET /clinics/:id/doctors/:doctorId/services lists assigned services', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/doctors/doc-1/services', headers: secretaryAuth })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).services.map((s: { id: string }) => s.id)).toEqual([SVC_2])
  })

  it('GET assigned for an unknown doctor → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/doctors/missing/services', headers: secretaryAuth })
    expect(res.statusCode).toBe(404)
  })

  it('POST assign an unknown doctor → 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/doctors/missing/services',
      headers: clinicAdminAuth,
      payload: { serviceId: SVC_1 },
    })
    expect(res.statusCode).toBe(404)
  })

  it('POST assign a service from another clinic → 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/doctors/doc-1/services',
      headers: clinicAdminAuth,
      payload: { serviceId: SVC_OTHER_CLINIC },
    })
    expect(res.statusCode).toBe(404)
  })

  it('POST assign (secretary) → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/doctors/doc-1/services',
      headers: secretaryAuth,
      payload: { serviceId: SVC_1 },
    })
    expect(res.statusCode).toBe(403)
  })

  it('DELETE unassigns a service from a doctor', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/clinics/c-1/doctors/doc-1/services/${SVC_2}`,
      headers: clinicAdminAuth,
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).deleted).toBe(true)
    const after = await app.inject({ method: 'GET', url: '/clinics/c-1/doctors/doc-1/services', headers: secretaryAuth })
    expect(JSON.parse(after.body).services).toEqual([])
  })
})
