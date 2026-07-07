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

const store = vi.hoisted(() => ({
  patients: new Map<string, Record<string, unknown>>([
    ['p-1', { id: 'p-1', clinicId: 'c-1', fullName: 'Ana López', status: 'returning' }],
  ]),
  tags: [
    { id: 'tag-1', clinicId: 'c-1', name: 'new_patient', color: '#22c55e' },
    { id: 'tag-2', clinicId: 'c-1', name: 'appointment_scheduled', color: '#6366f1' },
  ],
  notes: [
    {
      id: 'note-1',
      conversationId: 'conv-1',
      clinicId: 'c-1',
      authorId: 'u-1',
      content: 'Prefers mornings',
      createdAt: '2026-06-18T10:00:00.000Z',
      updatedAt: '2026-06-18T10:00:00.000Z',
    },
  ],
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createPatientsRepository: () => ({
    findById: async (clinicId: string, id: string) => {
      const p = store.patients.get(id)
      return p && p.clinicId === clinicId ? p : null
    },
  }),
  createAppointmentsRepository: () => ({
    listByPatient: async () => [],
  }),
  createConversationsRepository: () => ({
    listByPatient: async () => [],
    listTagsForPatient: async (clinicId: string, patientId: string) =>
      clinicId === 'c-1' && patientId === 'p-1' ? store.tags : [],
    listNotesForPatient: async (clinicId: string, patientId: string) =>
      clinicId === 'c-1' && patientId === 'p-1' ? store.notes : [],
  }),
  createMessagesRepository: () => ({}),
  createClinicsRepository: () => ({}),
  createKnowledgeRepository: () => ({}),
  createNotificationsRepository: () => ({}),
  createUsersRepository: () => ({}),
  createErrorReviewsRepository: () => ({}),
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

const token = signAccessToken({ userId: 'u-1', clinicId: 'c-1', role: 'secretary', email: 's@demo.test' })
const auth = { authorization: `Bearer ${token}` }

describe('patient history routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
  })

  it('GET /patients/:id/tags returns the patient\'s tags', async () => {
    const res = await app.inject({ method: 'GET', url: '/patients/p-1/tags', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.tags.map((t: { name: string }) => t.name)).toEqual([
      'new_patient',
      'appointment_scheduled',
    ])
  })

  it('GET /patients/:id/tags for an unknown patient → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/patients/nope/tags', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('GET /patients/:id/tags without auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/patients/p-1/tags' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /patients/:id/notes returns the patient\'s notes', async () => {
    const res = await app.inject({ method: 'GET', url: '/patients/p-1/notes', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.notes).toHaveLength(1)
    expect(body.notes[0].content).toBe('Prefers mornings')
  })

  it('GET /patients/:id/notes for an unknown patient → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/patients/nope/notes', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('GET /patients/:id/notes without auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/patients/p-1/notes' })
    expect(res.statusCode).toBe(401)
  })
})
