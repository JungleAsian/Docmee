import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

// buildApp wires every route; stub the workspace deps so no real Redis/DB/Google loads.
const queue = vi.hoisted(() => ({ add: vi.fn() }))
vi.mock('@docmee/queue', () => ({
  whatsappInboundQueue: { add: vi.fn() },
  kbEmbedQueue: queue,
}))
vi.mock('@docmee/agents', () => ({ getOAuth2Client: () => ({}) }))
vi.mock('@docmee/shared', () => ({
  encryptValue: (v: string) => `enc:${v}`,
  verifyPassword: () => true,
}))

interface ErrorRow {
  id: string
  clinicId: string
  errorType: string
  errorMessage: string
  stackTrace: string | null
  context: Record<string, unknown>
  status: string
  reviewedBy: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

function seed(): Map<string, ErrorRow> {
  const base = (over: Partial<ErrorRow>): ErrorRow => ({
    id: '',
    clinicId: 'c-1',
    errorType: 'bot_failure',
    errorMessage: 'boom',
    stackTrace: null,
    context: {},
    status: 'open',
    reviewedBy: null,
    resolvedAt: null,
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    ...over,
  })
  return new Map<string, ErrorRow>([
    ['e-1', base({ id: 'e-1', createdAt: '2026-06-01T10:00:00.000Z', errorMessage: 'old, has "quote", comma' })],
    ['e-2', base({ id: 'e-2', createdAt: '2026-06-10T10:00:00.000Z', errorType: 'unanswered' })],
    ['e-3', base({ id: 'e-3', createdAt: '2026-06-15T10:00:00.000Z', status: 'resolved', resolvedAt: '2026-06-16T00:00:00.000Z' })],
    ['o-1', base({ id: 'o-1', clinicId: 'c-OTHER' })],
  ])
}

const store = vi.hoisted(() => ({ errors: new Map<string, ErrorRow>() }))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createErrorReviewsRepository: () => ({
    listByClinic: async (clinicId: string, filters: { status?: string; from?: string; to?: string } = {}) =>
      [...store.errors.values()]
        .filter((e) => e.clinicId === clinicId)
        .filter((e) => !filters.status || e.status === filters.status)
        .filter((e) => !filters.from || e.createdAt >= filters.from)
        .filter((e) => !filters.to || e.createdAt <= filters.to)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    findById: async (clinicId: string, id: string) => {
      const e = store.errors.get(id)
      return e && e.clinicId === clinicId ? e : null
    },
    resolve: async (clinicId: string, id: string, reviewedBy: string) => {
      const e = store.errors.get(id)
      if (!e || e.clinicId !== clinicId) return null
      const updated = { ...e, status: 'resolved', reviewedBy }
      store.errors.set(id, updated)
      return updated
    },
    resolveMany: async (clinicId: string, ids: string[], reviewedBy: string) => {
      const out: ErrorRow[] = []
      for (const id of ids) {
        const e = store.errors.get(id)
        if (!e || e.clinicId !== clinicId || e.status === 'resolved') continue
        const updated = { ...e, status: 'resolved', reviewedBy }
        store.errors.set(id, updated)
        out.push(updated)
      }
      return out
    },
  }),
  createKnowledgeRepository: () => ({
    createDocument: async (data: Record<string, unknown>) => ({ id: 'doc-1', ...data }),
  }),
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

const adminToken = signAccessToken({ userId: 'ca-1', clinicId: 'c-1', role: 'clinic_admin', email: 'ca@demo.test' })
const adminAuth = { authorization: `Bearer ${adminToken}` }
const secretaryToken = signAccessToken({ userId: 'u-1', clinicId: 'c-1', role: 'secretary', email: 'ana@demo.test' })
const secretaryAuth = { authorization: `Bearer ${secretaryToken}` }

describe('Error review routes (Req 36)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
  })
  beforeEach(() => {
    store.errors = seed()
    queue.add.mockClear()
  })

  it('GET lists the clinic errors (clinic_admin), excluding other clinics', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/errors', headers: adminAuth })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.errors.map((e: ErrorRow) => e.id).sort()).toEqual(['e-1', 'e-2', 'e-3'])
  })

  it('GET filters by status=open', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/errors?status=open', headers: adminAuth })
    expect(JSON.parse(res.body).errors.map((e: ErrorRow) => e.id).sort()).toEqual(['e-1', 'e-2'])
  })

  it('GET filters by date range (from/to, inclusive end-of-day)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/clinics/c-1/errors?from=2026-06-05&to=2026-06-12',
      headers: adminAuth,
    })
    expect(JSON.parse(res.body).errors.map((e: ErrorRow) => e.id)).toEqual(['e-2'])
  })

  it('GET with a malformed date → 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/errors?from=last-week', headers: adminAuth })
    expect(res.statusCode).toBe(400)
  })

  it('GET (secretary) → 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/errors', headers: secretaryAuth })
    expect(res.statusCode).toBe(403)
  })

  it('GET without auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/errors' })
    expect(res.statusCode).toBe(401)
  })

  it('CSV export returns a downloadable text/csv body with a header + escaped fields', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/errors/export.csv', headers: adminAuth })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['content-disposition']).toContain('attachment')
    const lines = res.body.split('\r\n')
    expect(lines[0]).toBe('id,created_at,status,error_type,error_message,reviewed_by,resolved_at,context')
    expect(lines).toHaveLength(4) // header + 3 rows
    // The e-1 message has a comma and an embedded quote → must be RFC-4180 quoted/escaped.
    expect(res.body).toContain('"old, has ""quote"", comma"')
  })

  it('CSV export honours the status filter', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/clinics/c-1/errors/export.csv?status=resolved',
      headers: adminAuth,
    })
    expect(res.body.split('\r\n')).toHaveLength(2) // header + 1 resolved row
  })

  it('CSV export (secretary) → 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/errors/export.csv', headers: secretaryAuth })
    expect(res.statusCode).toBe(403)
  })

  it('batch-resolve resolves the open selected errors and skips already-resolved', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/errors/batch-resolve',
      headers: adminAuth,
      payload: { ids: ['e-1', 'e-2', 'e-3'] },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.resolved).toBe(2) // e-3 was already resolved
    expect(store.errors.get('e-1')!.status).toBe('resolved')
    expect(store.errors.get('e-1')!.reviewedBy).toBe('ca-1')
  })

  it('batch-resolve cannot touch another clinic’s errors', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/errors/batch-resolve',
      headers: adminAuth,
      payload: { ids: ['o-1'] },
    })
    expect(JSON.parse(res.body).resolved).toBe(0)
    expect(store.errors.get('o-1')!.status).toBe('open')
  })

  it('batch-resolve with empty ids → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/errors/batch-resolve',
      headers: adminAuth,
      payload: { ids: [] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('batch-resolve (secretary) → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/errors/batch-resolve',
      headers: secretaryAuth,
      payload: { ids: ['e-1'] },
    })
    expect(res.statusCode).toBe(403)
  })
})
