import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Clinic, Sql, WorkflowNode } from '@docmee/db'
const m = vi.hoisted(() => ({ search: vi.fn(), current: vi.fn(), consistency: vi.fn(), complete: vi.fn(), embed: vi.fn() }))
vi.mock('@docmee/db', async importOriginal => ({
  ...await importOriginal<typeof import('@docmee/db')>(),
  createKnowledgeRepository: () => ({ getClinicRetrievalRevision: async () => 4, searchChunks: m.search }),
  createKnowledgeLearningRepository: () => ({ sourcesCurrent: m.current, scopedConsistency: m.consistency }),
}))
vi.mock('@docmee/llm', async importOriginal => ({
  ...await importOriginal<typeof import('@docmee/llm')>(), chatComplete: m.complete, embed: m.embed,
}))
vi.mock('./clinic-ai-key.js', () => ({ resolveClinicAiKey: () => 'test-key' }))
import { previewTeachingAnswer } from './teaching-preview.js'

const clinic = { id: 'clinic', name: 'Test clinic', settings: { aiAssistant: { chatProvider: 'openai' } } } as unknown as Clinic
const node = { id: 'ai', type: 'ai_agent', kind: 'action', x: 0, y: 0,
  config: { scenarios: [{ id: 'faq', description: 'general questions', action: 'reply' }] } } as WorkflowNode
const source = { chunkId: 'chunk', documentId: 'doc', documentVersion: 2, title: 'Hours', content: 'We open at 9 AM.',
  doctorId: 'doctor', language: 'en', retrievalRevision: 4, vectorScore: .95, lexicalScore: .9, updatedAt: '2026-09-01', provenance: { governanceReviewState: 'trusted' } }
const run = (question = 'When do you open?', n = node) => previewTeachingAnswer({} as Sql, clinic, n, { question, doctorId: 'doctor', language: 'en' })
describe('workflow teaching preview without delivery or learning writes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    m.embed.mockResolvedValue([1, 0])
    m.search.mockResolvedValue([source])
    m.current.mockResolvedValue(true)
    m.consistency.mockResolvedValue({ complete: true, sources: [source.content] })
    m.complete.mockResolvedValue('SCENARIO: faq\nCONFIDENCE: 0.9\nREPLY: We open at 9 AM.')
  })
  it('uses the explicit clinic and doctor and returns current, grounded sources without sends', async () => {
    const result = await run()
    expect(result).toMatchObject({ action: 'reply', answer: source.content, sent: false, retrievalRevision: 4 })
    expect(result.sources).toEqual([{ documentId: 'doc', title: 'Hours', documentVersion: 2 }])
    expect(m.search).toHaveBeenCalledWith(expect.any(String), [1, 0], { clinicId: 'clinic', doctorId: 'doctor', language: 'en' }, 40)
    expect(m.complete.mock.calls[0]![0]).toMatchObject({ history: [], apiKey: 'test-key', message: 'When do you open?' })
  })
  it('hands off a knowledge gap without provider calls', async () => {
    m.search.mockResolvedValue([])
    expect(await run()).toMatchObject({ action: 'handoff', reason: 'knowledge_gap', sent: false })
    expect(m.complete).not.toHaveBeenCalled()
  })
  it('reports provider failure instead of returning a usable answer', async () => {
    m.complete.mockRejectedValueOnce(new Error('provider_unavailable'))
    await expect(run()).rejects.toThrow('provider_unavailable')
    expect(m.consistency).not.toHaveBeenCalled()
  })
  it('rejects stale sources before and after generation', async () => {
    m.current.mockResolvedValueOnce(false)
    expect(await run()).toMatchObject({ reason: 'stale_or_missing_sources', answer: '' })
    expect(m.complete).not.toHaveBeenCalled()
    m.current.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    expect(await run()).toMatchObject({ reason: 'stale_or_missing_sources', answer: '' })
  })
  it('does not show ungrounded, low-confidence or conflicting answers as usable replies', async () => {
    m.complete.mockResolvedValueOnce('SCENARIO: faq\nCONFIDENCE: 0.99\nREPLY: We open at 8 AM.')
    expect(await run()).toMatchObject({ action: 'handoff', reason: 'ungrounded_answer', answer: '' })
    m.complete.mockResolvedValueOnce('SCENARIO: faq\nCONFIDENCE: 0.7\nREPLY: We open at 9 AM.')
    expect(await run()).toMatchObject({ reason: 'low_answer_confidence', answer: '' })
    m.consistency.mockResolvedValueOnce({ complete: true, sources: ['We open at 8 AM.'] })
    expect(await run()).toMatchObject({ reason: 'contradiction_unknown', answer: '' })
  })
  it('exposes route decisions without executing the workflow or writing learning events', async () => {
    const routed = { ...node, config: { scenarios: [{ id: 'faq', description: 'Route', action: 'route', targetWorkflowId: 'other' }] } }
    expect(await run(undefined, routed)).toMatchObject({ action: 'route', reason: 'routed', sent: false })
    expect(m.consistency).not.toHaveBeenCalled()
    // Repository mocks deliberately expose no recordAttempt, messaging, approval or run methods.
  })
  it('falls back to lexical retrieval during embedding failure and rechecks fallback answer confidence', async () => {
    m.embed.mockRejectedValueOnce(new Error('offline'))
    m.complete.mockResolvedValueOnce('SCENARIO: faq\nCONFIDENCE: 0.99\nREPLY:')
      .mockResolvedValueOnce('CONFIDENCE: 0.5\nREPLY: We open at 9 AM.')
    expect(await run()).toMatchObject({ reason: 'low_answer_confidence', sent: false })
    expect(m.search.mock.calls[0]![1]).toEqual([])
    expect(m.complete).toHaveBeenCalledTimes(2)
  })
})
