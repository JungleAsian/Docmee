import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { signAccessToken } from '../auth/jwt.js'
const mocks = vi.hoisted(() => ({ list: vi.fn(async () => []), review: vi.fn(), feedback: vi.fn(), add: vi.fn(), failed: vi.fn() }))
vi.mock('../lib/db.js', () => ({ withDb: (fn: (sql: unknown) => unknown) => fn({}) }))
vi.mock('@docmee/db', () => ({ rejectionReasons: ['unsupported', 'outdated', 'unsafe', 'duplicate', 'not_clinic_policy', 'other'], createKnowledgeLearningRepository: () => mocks, createKnowledgeRepository: () => ({ markDocumentIndexFailed: mocks.failed }) }))
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
  it('requires explicit confirmation before a manual publication reaches the repository', async () => {
    const result = await inject('/clinics/clinic-a/kb/learning/candidates/c/review', auth(), { action: 'approve', expectedRevision: 1 })
    expect(result.statusCode).toBe(400)
    expect(mocks.review).not.toHaveBeenCalled()
  })
  it('requires and forwards a structured rejection reason', async () => {
    expect((await inject('/clinics/clinic-a/kb/learning/candidates/c/review', auth(), { action: 'reject', expectedRevision: 1 })).statusCode).toBe(400)
    mocks.review.mockResolvedValueOnce({ candidate: { id: 'c' }, write: null })
    const result = await inject('/clinics/clinic-a/kb/learning/candidates/c/review', auth(), { action: 'reject', expectedRevision: 1, rejectionReason: 'outdated' })
    expect(result.statusCode).toBe(200)
    expect(mocks.review).toHaveBeenCalledWith('clinic-a', 'c', expect.objectContaining({ actorId: 'reviewer', rejectionReason: 'outdated' }))
  })
  it('returns stale review conflict without enqueue', async () => {
    mocks.review.mockRejectedValueOnce(new Error('stale_candidate'))
    expect((await inject('/clinics/clinic-a/kb/learning/candidates/c/review', auth(), { action: 'approve', expectedRevision: 1, staffConfirmed: true })).statusCode).toBe(409)
    expect(mocks.add).not.toHaveBeenCalled()
  })
  it('returns a review-required error for an unconfirmed generalized fact', async () => {
    mocks.review.mockRejectedValueOnce(new Error('generalized_fact_review_required'))
    const result = await inject('/clinics/clinic-a/kb/learning/candidates/c/review', auth(), { action: 'approve', expectedRevision: 1, staffConfirmed: true })
    expect(result.statusCode).toBe(400)
    expect(result.json().error).toBe('generalized_fact_review_required')
    expect(mocks.add).not.toHaveBeenCalled()
  })
  it('queues only the committed document version and reports enqueue failure', async () => {
    mocks.review.mockResolvedValue({ candidate: { id: 'c', publishedDocumentId: 'doc', publishedDocumentVersion: 4 }, write: { document: { id: 'doc', version: 4 } } })
    mocks.add.mockRejectedValueOnce(new Error('offline'))
    const result = await inject('/clinics/clinic-a/kb/learning/candidates/c/review', auth(), { action: 'approve', expectedRevision: 1, staffConfirmed: true })
    expect(result.statusCode).toBe(200); expect(result.json().indexing).toBe('failed')
    expect(mocks.add).toHaveBeenCalledWith('embed-document', { clinicId: 'clinic-a', documentId: 'doc', documentVersion: 4 })
    expect(mocks.failed).toHaveBeenCalledWith('clinic-a','doc',4,'queue_unavailable')
    expect(mocks.review).toHaveBeenCalledWith('clinic-a','c', expect.objectContaining({ actorId: 'reviewer' }))
  })
  it('returns the independent draft identity after editing approved knowledge without reindexing', async () => {
    mocks.review.mockResolvedValueOnce({ candidate: { id: 'draft', previousVersionId: 'approved', status: 'pending_review', expiresAt: '2099-01-01' }, write: null })
    const result = await inject('/clinics/clinic-a/kb/learning/candidates/approved/review', auth(), { action: 'edit', expectedRevision: 2, content: 'We open at ten.' })
    expect(result.statusCode).toBe(200)
    expect(result.json().candidate).toMatchObject({ id: 'draft', previousVersionId: 'approved', status: 'pending_review' })
    expect(mocks.add).not.toHaveBeenCalled()
  })
  it('rolls an ancestor history snapshot into the current candidate and enqueues only the committed version', async () => {
    const historyId = '00000000-0000-4000-8000-000000000001'
    mocks.review.mockResolvedValueOnce({ candidate: { id: 'current', publishedDocumentId: 'doc', publishedDocumentVersion: 3 }, write: { document: { id: 'doc', version: 3 } } })
    const result = await inject('/clinics/clinic-a/kb/learning/candidates/current/review', auth(), { action: 'rollback', expectedRevision: 2, historyId, staffConfirmed: true })
    expect(result.statusCode).toBe(200)
    expect(mocks.review).toHaveBeenCalledWith('clinic-a', 'current', { action: 'rollback', expectedRevision: 2, historyId, staffConfirmed: true, actorId: 'reviewer' })
    expect(mocks.add).toHaveBeenCalledWith('embed-document', { clinicId: 'clinic-a', documentId: 'doc', documentVersion: 3 })
  })
  it('denies unrelated history and cross-tenant rollback without enqueueing', async () => {
    const payload = { action: 'rollback', expectedRevision: 2, historyId: '00000000-0000-4000-8000-000000000001', staffConfirmed: true }
    mocks.review.mockRejectedValueOnce(new Error('not_found'))
    expect((await inject('/clinics/clinic-a/kb/learning/candidates/current/review', auth(), payload)).statusCode).toBe(404)
    expect((await inject('/clinics/foreign/kb/learning/candidates/current/review', auth(), payload)).statusCode).toBe(403)
    expect(mocks.review).toHaveBeenCalledTimes(1)
    expect(mocks.add).not.toHaveBeenCalled()
  })
})
