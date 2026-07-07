import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// buildApp wires every route; stub the workspace deps so no real Redis/DB loads.
const kbEmbedAdd = vi.hoisted(() => vi.fn())
vi.mock('@docmee/queue', () => ({
  whatsappInboundQueue: { add: vi.fn() },
  kbEmbedQueue: { add: kbEmbedAdd },
}))
vi.mock('@docmee/agents', () => ({ getOAuth2Client: () => ({}) }))
vi.mock('@docmee/shared', () => ({
  encryptValue: (v: string) => `enc:${v}`,
  verifyPassword: () => true,
}))

let nextId = 1
const store = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>([
    ['kb-1', { id: 'kb-1', clinicId: 'c-1', title: 'Horarios', content: 'L-V', documentType: 'faq', status: 'active', metadata: {} }],
  ]),
  doctors: new Map<string, Record<string, unknown>>([
    ['00000000-0000-0000-0000-0000000000d1', { id: '00000000-0000-0000-0000-0000000000d1', clinicId: 'c-1', name: 'Dra. García' }],
  ]),
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createDoctorsRepository: () => ({
    findById: async (clinicId: string, id: string) => {
      const row = store.doctors.get(id)
      return row && row.clinicId === clinicId ? row : null
    },
  }),
  createKnowledgeRepository: () => ({
    listDocuments: async (clinicId: string) =>
      [...store.docs.values()].filter((d) => d.clinicId === clinicId),
    documentTrainingStats: async (clinicId: string) =>
      [...store.docs.values()]
        .filter((d) => d.clinicId === clinicId)
        .map((d) => ({ documentId: d.id, chunkCount: 2, embeddedCount: 2 })),
    updateDocument: async (clinicId: string, id: string, data: Record<string, unknown>) => {
      const row = store.docs.get(id)!
      if (data.title !== undefined) row.title = data.title
      if (data.content !== undefined) row.content = data.content
      if (data.documentType !== undefined) row.documentType = data.documentType
      return row
    },
    findDocument: async (clinicId: string, id: string) => {
      const row = store.docs.get(id)
      return row && row.clinicId === clinicId ? row : null
    },
    createDocument: async (data: Record<string, unknown>) => {
      const id = `kb-new-${nextId++}`
      const row = {
        id,
        clinicId: data.clinicId,
        title: data.title,
        content: data.content,
        documentType: data.documentType ?? 'faq',
        status: data.status ?? 'active',
        metadata: data.doctorId ? { doctorId: data.doctorId } : {},
      }
      store.docs.set(id, row)
      return row
    },
    updateDocumentStatus: async (clinicId: string, id: string, status: string) => {
      const row = store.docs.get(id)!
      row.status = status
      return row
    },
    setDocumentDoctor: async (clinicId: string, id: string, doctorId: string | null) => {
      const row = store.docs.get(id)!
      const meta = { ...(row.metadata as Record<string, unknown>) }
      if (doctorId) meta.doctorId = doctorId
      else delete meta.doctorId
      row.metadata = meta
      return row
    },
    deleteDocument: async () => {},
  }),
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

const secretaryAuth = { authorization: `Bearer ${signAccessToken({ userId: 'u-1', clinicId: 'c-1', role: 'secretary', email: 'a@d.test' })}` }
const adminAuth = { authorization: `Bearer ${signAccessToken({ userId: 'ca-1', clinicId: 'c-1', role: 'clinic_admin', email: 'ca@d.test' })}` }

describe('KB routes (Req 30 — per-doctor FAQ scope)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
  })

  it('GET lists documents for any clinic user', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/kb', headers: secretaryAuth })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).documents.length).toBeGreaterThanOrEqual(1)
  })

  it('GET attaches per-document training counts (Screen 7)', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/kb', headers: secretaryAuth })
    const doc = JSON.parse(res.body).documents.find((d: { id: string }) => d.id === 'kb-1')
    expect(doc.chunkCount).toBe(2)
    expect(doc.embeddedCount).toBe(2)
  })

  it('GET without auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/kb' })
    expect(res.statusCode).toBe(401)
  })

  it('POST (admin) creates a clinic-wide document and queues embedding', async () => {
    const res = await app.inject({ method: 'POST', url: '/clinics/c-1/kb', headers: adminAuth, payload: { title: 'X', content: 'y' } })
    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).document.metadata).toEqual({})
    expect(kbEmbedAdd).toHaveBeenCalled()
  })

  it('POST (admin) creates a doctor-scoped document', async () => {
    const res = await app.inject({ method: 'POST', url: '/clinics/c-1/kb', headers: adminAuth, payload: { title: 'García FAQ', content: 'video sí', doctorId: '00000000-0000-0000-0000-0000000000d1' } })
    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).document.metadata.doctorId).toBe('00000000-0000-0000-0000-0000000000d1')
  })

  it('POST with an unknown doctorId → 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/clinics/c-1/kb', headers: adminAuth, payload: { title: 'x', content: 'y', doctorId: '11111111-1111-1111-1111-111111111111' } })
    expect(res.statusCode).toBe(404)
  })

  it('POST (secretary) → 403', async () => {
    const res = await app.inject({ method: 'POST', url: '/clinics/c-1/kb', headers: secretaryAuth, payload: { title: 'x', content: 'y' } })
    expect(res.statusCode).toBe(403)
  })

  it('PATCH sets the doctor scope on an existing document', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/clinics/c-1/kb/kb-1', headers: adminAuth, payload: { doctorId: '00000000-0000-0000-0000-0000000000d1' } })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).document.metadata.doctorId).toBe('00000000-0000-0000-0000-0000000000d1')
  })

  it('PATCH clears the doctor scope with null', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/clinics/c-1/kb/kb-1', headers: adminAuth, payload: { doctorId: null } })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).document.metadata.doctorId).toBeUndefined()
  })

  it('PATCH with an unknown doctorId → 404', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/clinics/c-1/kb/kb-1', headers: adminAuth, payload: { doctorId: '22222222-2222-2222-2222-222222222222' } })
    expect(res.statusCode).toBe(404)
  })

  it('PATCH edits the entry title and content (Screen 7 editor)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/clinics/c-1/kb/kb-1',
      headers: adminAuth,
      payload: { title: 'Horarios actualizados', content: 'L-S 9-18', documentType: 'policy' },
    })
    expect(res.statusCode).toBe(200)
    const doc = JSON.parse(res.body).document
    expect(doc.title).toBe('Horarios actualizados')
    expect(doc.content).toBe('L-S 9-18')
    expect(doc.documentType).toBe('policy')
  })

  it('PATCH with no updatable field → 400', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/clinics/c-1/kb/kb-1', headers: adminAuth, payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('PATCH for an unknown document → 404', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/clinics/c-1/kb/missing', headers: adminAuth, payload: { status: 'archived' } })
    expect(res.statusCode).toBe(404)
  })
})
