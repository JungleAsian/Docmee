import { describe, expect, it } from 'vitest'
import type { Sql } from '../client.js'
import { createKnowledgeLearningRepository } from '../repositories/knowledge-learning.repository.js'

function fake(respond: (query: string, values: unknown[]) => unknown[] = () => []) {
  const queries: string[] = []; const values: unknown[][] = []
  const sql = Object.assign((s: TemplateStringsArray, ...v: unknown[]) => {
    const q = s.join('?'); queries.push(q); values.push(v)
    const rows = respond(q, v)
    return Promise.resolve(q.includes('SELECT revision') && !rows.length ? [{ revision: 7 }] : rows)
  }, { json: (v: unknown) => v, begin: (fn: (tx: unknown) => unknown) => fn(sql) }) as unknown as Sql
  return { sql, queries, values }
}
const input = { actorId: 'admin', title: 'Hours', content: 'We open at 9 AM.', doctorId: null, language: 'en' as const }
const candidate = { id: 'draft', clinicId: 'clinic', revision: 1, status: 'pending_review', candidateContent: input.content,
  humanEdit: input.content, staffConfirmed: false, supportingChunks: [], originalSource: { source: 'jzel_teaching', title: 'Hours', targetType: 'faq' },
  evidence: { doctorId: null, language: 'en', retrievalRevision: 7 }, publishedDocumentId: null, publishedDocumentVersion: null }
describe('explicit staff teaching drafts', () => {
  it('creates only a pending candidate and audit with exact content and explicit scope', async () => {
    const f = fake(q => q.includes('INSERT INTO knowledge_candidates') ? [candidate] : [])
    const result = await createKnowledgeLearningRepository(f.sql).teachingDraft('clinic', input)
    expect(result).toMatchObject({ status: 'pending_review', candidateContent: input.content })
    const insert = f.queries.findIndex(q => q.includes('INSERT INTO knowledge_candidates'))
    expect(f.queries[insert]).toContain('confidence_score, grounding_score')
    expect(f.values[insert]).toContainEqual(expect.objectContaining({ doctorId: null, language: 'en', retrievalRevision: 7 }))
    expect(f.values[insert]).toContain(input.content)
    expect(f.queries.join('\n')).toContain('teaching_draft')
    expect(f.queries.join('\n')).not.toContain('INSERT INTO knowledge_documents')
    expect(f.queries.join('\n')).not.toContain('INSERT INTO knowledge_chunks')
  })
  it('rejects a doctor from another clinic and private patient details', async () => {
    const f = fake()
    await expect(createKnowledgeLearningRepository(f.sql).teachingDraft('clinic', { ...input, doctorId: 'foreign' })).rejects.toThrow('not_found')
    await expect(createKnowledgeLearningRepository(f.sql).teachingDraft('clinic', { ...input, content: 'My name is Patient One.' })).rejects.toThrow('remove_private_information')
    expect(f.queries.join('\n')).not.toContain('INSERT INTO knowledge_candidates')
  })
  it('blocks exact duplicates while holding the clinic mutation lock', async () => {
    const f = fake(q => q.includes('regexp_replace') ? [{ id: 'duplicate' }] : [])
    await expect(createKnowledgeLearningRepository(f.sql).teachingDraft('clinic', input)).rejects.toThrow('duplicate_knowledge')
    expect(f.queries.findIndex(q => q.includes('FROM clinics') && q.includes('FOR UPDATE')))
      .toBeLessThan(f.queries.findIndex(q => q.includes('regexp_replace')))
    expect(f.queries.join('\n')).not.toContain('INSERT INTO knowledge_candidates')
  })
  it('rejects stale and scope-changing updates', async () => {
    for (const doc of [
      { version: 3, metadata: { language: 'en' } }, { version: 2, metadata: { language: 'es' } },
    ]) {
      const f = fake(q => q.includes('FROM knowledge_documents') ? [{ id: 'doc', title: 'Hours', status: 'active', approvedAt: 'now', ...doc }] : [])
      await expect(createKnowledgeLearningRepository(f.sql).teachingDraft('clinic', { ...input, targetDocumentId: 'doc', targetVersion: 2 }))
        .rejects.toThrow(doc.version === 3 ? 'stale_candidate' : 'mixed_source_scope')
    }
  })
  it('captures the first approved document as a restorable ancestor without rewriting it', async () => {
    const f = fake((q, v) => q.includes('SELECT * FROM knowledge_documents') ? [{ id: 'doc', title: 'Hours', content: 'We open at 8 AM.', version: 2, status: 'active', approvedAt: 'now', metadata: { language: 'en' }, documentType: 'policy' }]
      : q.includes('INSERT INTO knowledge_candidates') ? [{ ...candidate, id: v.includes('We open at 8 AM.') ? 'baseline' : 'draft' }] : [])
    await createKnowledgeLearningRepository(f.sql).teachingDraft('clinic', { ...input, targetDocumentId: 'doc', targetVersion: 2 })
    const inserts = f.queries.flatMap((q, i) => q.includes('INSERT INTO knowledge_candidates') ? [f.values[i]] : [])
    expect(inserts).toHaveLength(2)
    expect(inserts[1]).toContain('baseline')
    expect(inserts[1]).toContainEqual(expect.objectContaining({ targetType: 'policy' }))
    expect(f.queries.join('\n')).not.toContain('UPDATE knowledge_documents')
  })
  it('requires current KB revision and exact reviewed text when approving', async () => {
    const f = fake(q => q.includes('SELECT * FROM knowledge_candidates') ? [candidate] : q.includes('SELECT revision') ? [{ revision: 8 }] : [])
    await expect(createKnowledgeLearningRepository(f.sql).review('clinic', 'draft', { action: 'approve', expectedRevision: 1, actorId: 'admin', staffConfirmed: true })).rejects.toThrow('stale_sources')
    await expect(createKnowledgeLearningRepository(f.sql).review('clinic', 'draft', { action: 'approve', expectedRevision: 1, actorId: 'admin', staffConfirmed: true, content: 'Different content.' })).rejects.toThrow('stale_candidate')
    expect(f.queries.join('\n')).not.toContain('INSERT INTO knowledge_documents')
  })
  it('publishes approved teaching through the existing atomic writer with exact title and scope', async () => {
    const f = fake(q => q.includes('SELECT * FROM knowledge_candidates') ? [candidate]
      : q.includes('INSERT INTO knowledge_documents') ? [{ id: 'doc', version: 1 }]
      : q.includes('INSERT INTO knowledge_chunks') ? [{ id: 'chunk' }]
      : q.includes('UPDATE knowledge_candidates') ? [{ ...candidate, status: 'approved', revision: 2 }] : [])
    const result = await createKnowledgeLearningRepository(f.sql).review('clinic', 'draft', { action: 'approve', expectedRevision: 1, actorId: 'admin', staffConfirmed: true })
    expect(result.write?.document.id).toBe('doc')
    const values = f.values[f.queries.findIndex(q => q.includes('INSERT INTO knowledge_documents'))]!
    expect(values).toContain('Hours')
    expect(values).toContainEqual(expect.objectContaining({ language: 'en', approver: 'admin', source: 'governed_learning' }))
  })
})
