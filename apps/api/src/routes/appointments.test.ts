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
        availableDays: { mon: [{ start: '09:00', end: '11:00' }] },
        isActive: true,
        calendarConnected: false,
      },
    ],
  ]),
  patients: new Map<string, Record<string, unknown>>([
    ['pat-1', { id: 'pat-1', clinicId: 'c-1', fullName: 'Juan Pérez' }],
  ]),
  services: [{ id: 'svc-1', clinicId: 'c-1', name: 'Limpieza', durationMinutes: 60 }] as Record<string, unknown>[],
  appts: new Map<string, Record<string, unknown>>(),
  events: [] as Record<string, unknown>[],
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createDoctorsRepository: () => ({
    findById: async (clinicId: string, id: string) => {
      const row = store.doctors.get(id)
      return row && row.clinicId === clinicId ? row : null
    },
  }),
  createPatientsRepository: () => ({
    list: async (clinicId: string) => [...store.patients.values()].filter((p) => p.clinicId === clinicId),
    findById: async (clinicId: string, id: string) => {
      const row = store.patients.get(id)
      return row && row.clinicId === clinicId ? row : null
    },
  }),
  createAppointmentsRepository: () => ({
    listServices: async (clinicId: string) => store.services.filter((s) => s.clinicId === clinicId),
    listInRange: async (clinicId: string, { from, to, doctorId }: { from: string; to: string; doctorId?: string }) =>
      [...store.appts.values()].filter(
        (a) =>
          a.clinicId === clinicId &&
          (a.startTime as string) >= from &&
          (a.startTime as string) < to &&
          (!doctorId || a.doctorId === doctorId),
      ),
    findById: async (clinicId: string, id: string) => {
      const row = store.appts.get(id)
      return row && row.clinicId === clinicId ? row : null
    },
    create: async (data: Record<string, unknown>) => {
      const id = `appt-${nextId++}`
      const row = { id, status: 'pending', ...data }
      store.appts.set(id, row)
      return row
    },
    update: async (clinicId: string, id: string, data: Record<string, unknown>) => {
      const row = store.appts.get(id)
      if (!row || row.clinicId !== clinicId) throw new Error('not found')
      for (const [k, v] of Object.entries(data)) if (v !== undefined) row[k] = v
      store.appts.set(id, row)
      return row
    },
    addEvent: async (clinicId: string, appointmentId: string, eventType: string, actorId?: string) => {
      const ev = { clinicId, appointmentId, eventType, actorId, createdAt: `2026-06-22T08:${String(store.events.length).padStart(2, '0')}:00` }
      store.events.push(ev)
      return ev
    },
    listEventsInRange: async (
      clinicId: string,
      { from, to, doctorId }: { from: string; to: string; doctorId?: string },
    ) =>
      store.events
        .filter((e) => e.clinicId === clinicId)
        .map((e) => {
          const a = store.appts.get(e.appointmentId as string)
          if (!a) return null
          const p = store.patients.get(a.patientId as string)
          return {
            id: `${e.appointmentId}-${e.eventType}`,
            appointmentId: e.appointmentId,
            eventType: e.eventType,
            createdAt: e.createdAt,
            patientName: (p?.fullName as string) ?? null,
            startTime: a.startTime,
            aiSourced: Boolean(a.conversationId),
          }
        })
        .filter(
          (it): it is NonNullable<typeof it> =>
            it !== null &&
            (it.startTime as string) >= from &&
            (it.startTime as string) < to &&
            (!doctorId || store.appts.get(it.appointmentId as string)?.doctorId === doctorId),
        )
        .reverse(),
  }),
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

const secretaryToken = signAccessToken({ userId: 'u-1', clinicId: 'c-1', role: 'secretary', email: 'ana@demo.test' })
const auth = { authorization: `Bearer ${secretaryToken}` }
const otherClinicToken = signAccessToken({ userId: 'u-2', clinicId: 'c-2', role: 'secretary', email: 'b@demo.test' })

describe('Appointment routes (Screen 2 — Req 9/30)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
  })

  it('GET /slots returns service-duration slots for a worked day, none on a day off', async () => {
    // 2026-06-22 is a Monday → doctor works 09:00–11:00; svc-1 is 60 min → 2 slots.
    const mon = await app.inject({
      method: 'GET',
      url: '/clinics/c-1/appointments/slots?doctorId=doc-1&date=2026-06-22&serviceId=svc-1',
      headers: auth,
    })
    expect(mon.statusCode).toBe(200)
    const body = JSON.parse(mon.body)
    expect(body.working).toBe(true)
    expect(body.durationMinutes).toBe(60)
    expect(body.calendarConnected).toBe(false)
    expect(body.slots.map((s: { start: string }) => s.start)).toEqual(['09:00', '10:00'])

    // 2026-06-23 is a Tuesday → doctor has no hours → day off, no slots.
    const tue = await app.inject({
      method: 'GET',
      url: '/clinics/c-1/appointments/slots?doctorId=doc-1&date=2026-06-23',
      headers: auth,
    })
    expect(JSON.parse(tue.body).working).toBe(false)
    expect(JSON.parse(tue.body).slots).toEqual([])
  })

  it('GET /slots for an unknown doctor → 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/clinics/c-1/appointments/slots?doctorId=00000000-0000-0000-0000-000000000000&date=2026-06-22',
      headers: auth,
    })
    expect(res.statusCode).toBe(404)
  })

  it('POST books an appointment and computes the end from the service duration', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/appointments',
      headers: auth,
      payload: { patientId: 'pat-1', doctorId: 'doc-1', serviceId: 'svc-1', date: '2026-06-22', start: '09:00' },
    })
    expect(res.statusCode).toBe(201)
    const { appointment } = JSON.parse(res.body)
    expect(appointment.startTime).toBe('2026-06-22T09:00:00')
    expect(appointment.endTime).toBe('2026-06-22T10:00:00')
    expect(appointment.status).toBe('pending')
  })

  it('GET /slots now hides the just-booked 09:00 slot', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/clinics/c-1/appointments/slots?doctorId=doc-1&date=2026-06-22&serviceId=svc-1',
      headers: auth,
    })
    expect(JSON.parse(res.body).slots.map((s: { start: string }) => s.start)).toEqual(['10:00'])
  })

  it('POST onto a taken slot → 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/appointments',
      headers: auth,
      payload: { patientId: 'pat-1', doctorId: 'doc-1', serviceId: 'svc-1', date: '2026-06-22', start: '09:30' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('POST for an unknown patient → 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/appointments',
      headers: auth,
      payload: { patientId: '00000000-0000-0000-0000-000000000000', doctorId: 'doc-1', date: '2026-06-22', start: '10:30' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PATCH cancels an appointment and records the event', async () => {
    const booked = [...store.appts.values()][0]!
    const res = await app.inject({
      method: 'PATCH',
      url: `/clinics/c-1/appointments/${booked.id}`,
      headers: auth,
      payload: { status: 'cancelled' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).appointment.status).toBe('cancelled')
    expect(store.events.some((e) => e.eventType === 'cancelled')).toBe(true)
  })

  it('PATCH reschedule preserves the duration and records a rescheduled event', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/appointments',
      headers: auth,
      payload: { patientId: 'pat-1', doctorId: 'doc-1', serviceId: 'svc-1', date: '2026-06-22', start: '10:00' },
    })
    const id = JSON.parse(created.body).appointment.id
    const res = await app.inject({
      method: 'PATCH',
      url: `/clinics/c-1/appointments/${id}`,
      headers: auth,
      payload: { date: '2026-06-29', start: '09:00' },
    })
    expect(res.statusCode).toBe(200)
    const appt = JSON.parse(res.body).appointment
    expect(appt.startTime).toBe('2026-06-29T09:00:00')
    expect(appt.endTime).toBe('2026-06-29T10:00:00') // 60-min duration preserved
    expect(store.events.some((e) => e.eventType === 'rescheduled')).toBe(true)
  })

  it('PATCH with neither status nor a full reschedule → 400', async () => {
    const booked = [...store.appts.values()][0]!
    const res = await app.inject({
      method: 'PATCH',
      url: `/clinics/c-1/appointments/${booked.id}`,
      headers: auth,
      payload: { date: '2026-06-29' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST with urgent:true stores the flag on metadata', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/appointments',
      headers: auth,
      payload: { patientId: 'pat-1', doctorId: 'doc-1', date: '2026-07-06', start: '09:00', urgent: true },
    })
    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).appointment.metadata).toEqual({ urgent: true })
  })

  it('PATCH advances through arrived → in_progress and records each event', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/appointments',
      headers: auth,
      payload: { patientId: 'pat-1', doctorId: 'doc-1', date: '2026-07-13', start: '09:00' },
    })
    const id = JSON.parse(created.body).appointment.id

    const arrived = await app.inject({
      method: 'PATCH',
      url: `/clinics/c-1/appointments/${id}`,
      headers: auth,
      payload: { status: 'arrived' },
    })
    expect(JSON.parse(arrived.body).appointment.status).toBe('arrived')

    const inProgress = await app.inject({
      method: 'PATCH',
      url: `/clinics/c-1/appointments/${id}`,
      headers: auth,
      payload: { status: 'in_progress' },
    })
    expect(JSON.parse(inProgress.body).appointment.status).toBe('in_progress')
    expect(store.events.some((e) => e.eventType === 'arrived')).toBe(true)
    expect(store.events.some((e) => e.eventType === 'in_progress')).toBe(true)
  })

  it('PATCH urgent-only toggles the flag without changing status', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/appointments',
      headers: auth,
      payload: { patientId: 'pat-1', doctorId: 'doc-1', date: '2026-07-20', start: '09:00' },
    })
    const id = JSON.parse(created.body).appointment.id
    const res = await app.inject({
      method: 'PATCH',
      url: `/clinics/c-1/appointments/${id}`,
      headers: auth,
      payload: { urgent: true },
    })
    expect(res.statusCode).toBe(200)
    const appt = JSON.parse(res.body).appointment
    expect(appt.status).toBe('pending')
    expect(appt.metadata).toEqual({ urgent: true })
  })

  it('GET /events returns the day activity feed (newest first, staff-sourced)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/clinics/c-1/appointments/events?from=2026-07-13T00:00:00&to=2026-07-14T00:00:00&doctorId=doc-1',
      headers: auth,
    })
    expect(res.statusCode).toBe(200)
    const { events } = JSON.parse(res.body)
    // The 2026-07-13 appointment recorded arrived + in_progress lifecycle events.
    const types = events.map((e: { eventType: string }) => e.eventType)
    expect(types).toContain('arrived')
    expect(types).toContain('in_progress')
    expect(events[0].patientName).toBe('Juan Pérez')
    // A panel booking has no conversation → staff-sourced.
    expect(events.every((e: { aiSourced: boolean }) => e.aiSourced === false)).toBe(true)
  })

  it('GET /events cross-clinic → 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/clinics/c-1/appointments/events?from=2026-07-13T00:00:00&to=2026-07-14T00:00:00',
      headers: { authorization: `Bearer ${otherClinicToken}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('GET without auth → 401, cross-clinic → 403', async () => {
    const noAuth = await app.inject({
      method: 'GET',
      url: '/clinics/c-1/appointments?from=2026-06-22T00:00:00&to=2026-06-23T00:00:00',
    })
    expect(noAuth.statusCode).toBe(401)

    const cross = await app.inject({
      method: 'GET',
      url: '/clinics/c-1/appointments?from=2026-06-22T00:00:00&to=2026-06-23T00:00:00',
      headers: { authorization: `Bearer ${otherClinicToken}` },
    })
    expect(cross.statusCode).toBe(403)
  })
})
