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
// The isolated worktree shares installed dependencies with the parent checkout.
// Overlay the worktree's policy module so this test exercises the code under review.
vi.mock('@docmee/agents', async importOriginal => {
  const original = await importOriginal<typeof import('@docmee/agents')>()
  const policy = await import('../../../../packages/agents/src/workflows/ai-agent-answer.js')
  return { ...original, ...policy }
})
vi.mock('./clinic-ai-key.js', () => ({ resolveClinicAiKey: () => 'test-key' }))
import { previewTeachingAnswer } from './teaching-preview.js'

const clinic = { id: 'clinic', name: 'Test clinic', settings: { aiAssistant: { chatProvider: 'openai' } } } as unknown as Clinic
const node = { id: 'ai', type: 'action.ai_agent', kind: 'action', x: 0, y: 0,
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
    expect(result).toMatchObject({ action: 'reply', answer: source.content, sent: false, retrievalRevision: 4,
      kbMatches: 1, retrievalMode: 'embedded' })
    expect(result.sources).toEqual([{ documentId: 'doc', title: 'Hours', documentVersion: 2 }])
    expect(m.search).toHaveBeenCalledWith(expect.any(String), [1, 0], { clinicId: 'clinic', doctorId: 'doctor', language: 'en' }, 40)
    expect(m.complete.mock.calls[0]![0]).toMatchObject({ history: [], apiKey: 'test-key', message: 'When do you open?' })
  })
  it('hands off a knowledge gap without provider calls', async () => {
    m.search.mockResolvedValue([])
    expect(await run()).toMatchObject({ action: 'handoff', reason: 'knowledge_gap', sent: false, kbMatches: 0, retrievalMode: 'none' })
    expect(m.complete).not.toHaveBeenCalled()
  })
  it('uses the saved general-education policy for a safe definition question', async () => {
    m.search.mockResolvedValue([])
    m.complete.mockResolvedValue('SCENARIO: faq\nCONFIDENCE: 0.92\nREPLY: Alopecia is the medical term for hair loss.')
    const educationNode = { ...node, config: { ...node.config, knowledgePolicy: 'clinic_kb_and_general_education' } } as WorkflowNode
    expect(await run('What is alopecia?', educationNode)).toMatchObject({
      action: 'reply', reason: null, answer: 'Alopecia is the medical term for hair loss.', kbMatches: 0, retrievalMode: 'none',
    })
    expect(m.complete.mock.calls[0]![0].system).toContain('general educational question')
  })
  it('still hands off clinic facts and personalized medical requests under the education policy', async () => {
    m.search.mockResolvedValue([])
    const educationNode = { ...node, config: { ...node.config, knowledgePolicy: 'clinic_kb_and_general_education' } } as WorkflowNode
    expect(await run('What are your clinic hours?', educationNode)).toMatchObject({ action: 'handoff', reason: 'knowledge_gap' })
    expect(await run('I am losing my hair. What treatment should I use?', educationNode))
      .toMatchObject({ action: 'handoff', reason: 'knowledge_gap' })
    expect(m.complete).not.toHaveBeenCalled()
  })
  it('hands emergencies off before retrieval or provider use', async () => {
    const educationNode = { ...node, config: { ...node.config, knowledgePolicy: 'clinic_kb_and_general_education' } } as WorkflowNode
    expect(await run('I cannot breathe', educationNode)).toMatchObject({ action: 'handoff', reason: 'emergency' })
    expect(m.search).not.toHaveBeenCalled()
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
      .mockResolvedValueOnce('CONFIDENCE: 0.99\nREPLY: We close at 8 PM.')
    expect(await run('Tell me about parking validation')).toMatchObject({ action: 'handoff', reason: 'ungrounded_answer', answer: '' })
    m.complete.mockResolvedValueOnce('SCENARIO: faq\nCONFIDENCE: 0.7\nREPLY: We open at 9 AM.')
    expect(await run('Tell me about the clinic')).toMatchObject({ reason: 'low_answer_confidence', answer: '' })
    m.consistency.mockResolvedValueOnce({ complete: true, sources: ['We open at 8 AM.'] })
    expect(await run()).toMatchObject({ reason: 'contradiction_unknown', answer: '' })
  })
  it('repairs a paraphrased clinic fact once with an exact grounded source answer', async () => {
    m.complete.mockResolvedValueOnce('SCENARIO: faq\nCONFIDENCE: 0.99\nREPLY: The clinic starts seeing patients at nine.')
      .mockResolvedValueOnce('CONFIDENCE: 0.99\nREPLY: We open at 9 AM.')

    expect(await run()).toMatchObject({ action: 'reply', reason: null, answer: source.content })
    expect(m.complete).toHaveBeenCalledTimes(2)
    expect(m.complete.mock.calls[1]![0].system).toContain('complete, unchanged KB sentences')
  })
  it('deterministically extracts a retrieved phone fact when both model answers paraphrase it', async () => {
    const clinicSource = { ...source, title: 'Clinic information', content: [
      'Clinic: Derma Paz',
      'Address: 20 Avenida 1-16 Zona 3',
      'Phone: 46082715',
      'Doctor: Dra. Mónica Paz, dermatóloga.',
    ].join('\n') }
    m.search.mockResolvedValue([clinicSource])
    m.consistency.mockResolvedValue({ complete: true, sources: [clinicSource.content] })
    m.complete.mockResolvedValueOnce('SCENARIO: faq\nCONFIDENCE: 0.35\nREPLY: Call us at 4608-2715.')
      .mockResolvedValueOnce('CONFIDENCE: 0.35\nREPLY: The clinic phone number is 46082715.')

    expect(await run('What is the Derma Paz contact phone?')).toMatchObject({
      action: 'reply', reason: null, answer: 'Phone: 46082715', kbMatches: 1,
    })
    expect(m.complete).toHaveBeenCalledTimes(2)
  })
  it('exposes route decisions without executing the workflow or writing learning events', async () => {
    const routed = { ...node, config: { scenarios: [{ id: 'faq', description: 'Route', action: 'route', targetWorkflowId: 'other' }] } }
    expect(await run(undefined, routed)).toMatchObject({ action: 'route', reason: 'routed', sent: false })
    expect(m.consistency).not.toHaveBeenCalled()
    // Repository mocks deliberately expose no recordAttempt, messaging, approval or run methods.
  })
  it('falls back to lexical retrieval and delivers an exact recognized fact independently of model confidence', async () => {
    m.embed.mockRejectedValueOnce(new Error('offline'))
    m.complete.mockResolvedValueOnce('SCENARIO: faq\nCONFIDENCE: 0.99\nREPLY:')
      .mockResolvedValueOnce('CONFIDENCE: 0.5\nREPLY: We open at 9 AM.')
    expect(await run()).toMatchObject({ action: 'reply', reason: null, answer: source.content, sent: false })
    expect(m.search.mock.calls[0]![1]).toEqual([])
    expect(m.complete).toHaveBeenCalledTimes(2)
  })
})
