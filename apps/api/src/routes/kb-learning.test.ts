import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { signAccessToken } from '../auth/jwt.js'
const mocks = vi.hoisted(() => ({ list: vi.fn(async () => []), review: vi.fn(), feedback: vi.fn(), add: vi.fn(), failed: vi.fn() }))
vi.mock('../lib/db.js', () => ({ withDb: (fn: (sql: unknown) => unknown) => fn({}) }))
vi.mock('@docmee/db', () => ({ createKnowledgeLearningRepository: () => mocks, createKnowledgeRepository: () => ({ markDocumentIndexFailed: mocks.failed }) }))
vi.mock('@docmee/queue', () => ({ kbEmbedQueue: { add: mocks.add } }))
import route from './kb-learning.js'
const auth = (role: 'secretary'|'clinic_admin' = 'clinic_admin', clinicId = 'clinic-a') => ({ authorization: `Bearer ${signAccessToken({ userId: 'reviewer', email: 'reviewer@example.test', clinicId, role })}` })
async function inject(url: string, headers: Record<string, string> = auth(), payload?: unknown) {
  const app = Fastify(); await app.register(route)
  try { return await app.inject({ method: payload ? 'POST' : 'GET', url, headers, ...(payload ? { payload: payload as object } : {}) }) } finally { await app.close() }
}
describe('learning review authorization and publication', () => {
  beforeEach(() => vi.clearAllMocks())
  it('denies anonymous, secretary and foreign-clinic reads before repository access', async () => {
    expect((await inject('/clinics/clinic-a/kb/learning/candidates', {})).statusCode).toBe(401)
    expect((await inject('/clinics/clinic-a/kb/learning/candidates', auth('secretary'))).statusCode).toBe(403)
    expect((await inject('/clinics/clinic-b/kb/learning/candidates')).statusCode).toBe(403)
    expect(mocks.list).not.toHaveBeenCalled()
  })
  it('does not allow a caller to request automatic approval or forge the actor', async () => {
    expect((await inject('/clinics/clinic-a/kb/learning/candidates/c/review', auth(), { action: 'approve', expectedRevision: 1, automatic: true, actorId: 'other' })).statusCode).toBe(400)
    expect(mocks.review).not.toHaveBeenCalled()
  })
  it('returns stale review conflict without enqueue', async () => {
    mocks.review.mockRejectedValueOnce(new Error('stale_candidate'))
    expect((await inject('/clinics/clinic-a/kb/learning/candidates/c/review', auth(), { action: 'approve', expectedRevision: 1 })).statusCode).toBe(409)
    expect(mocks.add).not.toHaveBeenCalled()
  })
  it('queues only the committed document version and reports enqueue failure', async () => {
    mocks.review.mockResolvedValue({ candidate: { id: 'c', publishedDocumentId: 'doc', publishedDocumentVersion: 4 }, write: { document: { id: 'doc', version: 4 } } })
    mocks.add.mockRejectedValueOnce(new Error('offline'))
    const result = await inject('/clinics/clinic-a/kb/learning/candidates/c/review', auth(), { action: 'approve', expectedRevision: 1 })
    expect(result.statusCode).toBe(200); expect(result.json().indexing).toBe('failed')
    expect(mocks.add).toHaveBeenCalledWith('embed-document', { clinicId: 'clinic-a', documentId: 'doc', documentVersion: 4 })
    expect(mocks.failed).toHaveBeenCalledWith('clinic-a','doc',4,'queue_unavailable')
    expect(mocks.review).toHaveBeenCalledWith('clinic-a','c', expect.objectContaining({ actorId: 'reviewer' }))
  })
})
