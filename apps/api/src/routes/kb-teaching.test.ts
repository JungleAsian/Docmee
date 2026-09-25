import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { signAccessToken } from '../auth/jwt.js'
const m = vi.hoisted(() => ({ clinic: vi.fn(), doctor: vi.fn(), draft: vi.fn(), search: vi.fn(async () => []),
  document: vi.fn(), workflow: vi.fn(), preview: vi.fn(), candidate: vi.fn(), history: vi.fn(async () => []) }))
vi.mock('../lib/db.js', () => ({ withDb: (fn: (sql: unknown) => unknown) => fn({}) }))
vi.mock('@docmee/db', () => ({
  createClinicsRepository: () => ({ findById: m.clinic }),
  createDoctorsRepository: () => ({ findById: m.doctor }),
  createKnowledgeRepository: () => ({ findDocument: m.document, searchChunks: m.search }),
  createKnowledgeLearningRepository: () => ({ teachingDraft: m.draft, findCandidate: m.candidate, history: m.history }),
  createWorkflowsRepository: () => ({ findById: m.workflow }),
}))
vi.mock('../lib/teaching-preview.js', () => ({ previewTeachingAnswer: m.preview }))
import route, { teachingAvailability } from './kb-teaching.js'
const id = '00000000-0000-4000-8000-000000000001'
const auth = (role: 'secretary'|'clinic_admin'|'ia_studio_admin' = 'clinic_admin') =>
  ({ authorization: `Bearer ${signAccessToken({ userId: 'reviewer', email: 'reviewer@example.test', clinicId: 'clinic-a', role })}` })
async function inject(path: string, payload?: object, headers: Record<string, string> = auth()) {
  const app = Fastify(); await app.register(route)
  try { return await app.inject({ method: payload ? 'POST' : 'GET', url: path, headers, ...(payload ? { payload } : {}) }) }
  finally { await app.close() }
}
const draft = { title: 'Opening hours', content: 'We open at 9 AM.', doctorId: null, language: 'en' }
describe('J.zel teaching authorization and exact drafts', () => {
  beforeEach(() => { vi.clearAllMocks(); m.draft.mockResolvedValue({ id: 'draft', status: 'pending_review' }) })
  it('rejects anonymous, secretary and foreign-clinic writes before repository access', async () => {
    const url = '/clinics/clinic-a/kb/teaching/drafts'
    expect((await inject(url, draft, {})).statusCode).toBe(401)
    expect((await inject(url, draft, auth('secretary'))).statusCode).toBe(403)
    expect((await inject('/clinics/clinic-b/kb/teaching/drafts', draft)).statusCode).toBe(403)
    expect(m.draft).not.toHaveBeenCalled()
  })
  it('uses the explicit selected clinic for superusers and the authenticated actor', async () => {
    const response = await inject('/clinics/clinic-b/kb/teaching/drafts', draft, auth('ia_studio_admin'))
    expect(response.statusCode).toBe(200)
    expect(m.draft).toHaveBeenCalledWith('clinic-b', { ...draft, actorId: 'reviewer' })
    expect(response.json().candidate.status).toBe('pending_review')
  })
  it('rejects unversioned updates, automatic approval, forged actor and missing scope', async () => {
    for (const payload of [{ ...draft, targetDocumentId: id }, { ...draft, automatic: true }, { ...draft, actorId: 'other' }, { title: 'a', content: 'b' }]) {
      expect((await inject('/clinics/clinic-a/kb/teaching/drafts', payload)).statusCode).toBe(400)
    }
    expect(m.draft).not.toHaveBeenCalled()
  })
  it('reports duplicate and stale conflicts without publishing', async () => {
    for (const reason of ['duplicate_knowledge', 'stale_candidate', 'stale_sources']) {
      m.draft.mockRejectedValueOnce(new Error(reason))
      const result = await inject('/clinics/clinic-a/kb/teaching/drafts', draft)
      expect(result.statusCode).toBe(409); expect(result.json().error).toBe(reason)
    }
  })
  it('does not expose another clinic candidate through status or history', async () => {
    m.candidate.mockResolvedValue(null)
    expect((await inject('/clinics/clinic-a/kb/teaching/drafts/missing')).statusCode).toBe(404)
    expect(m.candidate).toHaveBeenCalledWith('clinic-a', 'missing')
    expect(m.history).not.toHaveBeenCalled()
  })
  it('rejects foreign doctors and workflows before preview provider calls', async () => {
    m.clinic.mockResolvedValue({ id: 'clinic-a' }); m.doctor.mockResolvedValue(null)
    const body = { question: 'Opening hours?', doctorId: id, language: null, workflowId: id, nodeId: 'ai' }
    expect((await inject('/clinics/clinic-a/kb/teaching/preview', body)).statusCode).toBe(404)
    m.workflow.mockResolvedValue(null)
    expect((await inject('/clinics/clinic-a/kb/teaching/preview', { ...body, doctorId: null })).statusCode).toBe(404)
    expect(m.preview).not.toHaveBeenCalled()
  })
  it('previews only a server-loaded AI node and reports its saved version', async () => {
    const node = { id: 'ai', type: 'ai_agent', config: { personality: 'saved' } }
    m.clinic.mockResolvedValue({ id: 'clinic-a' }); m.workflow.mockResolvedValue({ nodes: [node], documentVersion: 8, status: 'active' })
    m.preview.mockResolvedValue({ action: 'handoff', reason: 'knowledge_gap', sent: false })
    const result = await inject('/clinics/clinic-a/kb/teaching/preview', { question: 'Opening hours?', doctorId: null, language: null, workflowId: id, nodeId: 'ai' })
    expect(result.statusCode).toBe(200); expect(result.json()).toMatchObject({ sent: false, workflowVersion: 8 })
    expect(m.preview.mock.calls[0]![2]).toEqual(node)
  })
})
describe('teaching completion truthfulness', () => {
  const candidate = { status: 'approved', publishedDocumentVersion: 2 }
  const document = { version: 2, status: 'active', approvedAt: '2026-01-01', metadata: {}, indexingStatus: 'ready' } as never
  it('separates pending approval, indexing and ready', () => {
    expect(teachingAvailability({ ...candidate, status: 'pending_review' }, null)).toBe('draft')
    expect(teachingAvailability(candidate, document)).toBe('ready')
    expect(teachingAvailability(candidate, { ...(document as object), indexingStatus: 'pending' } as never)).toBe('approved')
    expect(teachingAvailability(candidate, { ...(document as object), indexingStatus: 'failed' } as never)).toBe('indexing_failed')
  })
  it('never calls an old, excluded or future version ready', () => {
    for (const override of [{ version: 3 }, { status: 'inactive' }, { metadata: { governanceReviewState: 'excluded' } }, { effectiveFrom: '2099-01-01' }]) {
      expect(teachingAvailability(candidate, { ...(document as object), ...override } as never)).toBe('superseded')
    }
  })
})
