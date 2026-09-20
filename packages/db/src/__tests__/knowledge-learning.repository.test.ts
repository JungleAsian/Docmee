import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Sql } from '../client.js'
import { createKnowledgeLearningRepository, learningFingerprint, sanitizeLearningText, automaticPublicationReasons, type GovernedCandidate } from '../repositories/knowledge-learning.repository.js'

function fake(respond: (query: string, values: unknown[]) => unknown[] = () => []) {
  const queries: string[] = []
  const values: unknown[][] = []
  const sql = Object.assign((s: TemplateStringsArray, ...v: unknown[]) => {
    const q = s.join('?'); queries.push(q); values.push(v)
    const rows = respond(q, v)
    return Promise.resolve(q.includes('SELECT revision') && !rows.length ? [{ revision: 7 }] : rows)
  }, { json: (v: unknown) => v, begin: (fn: (tx: unknown) => unknown) => fn(sql) }) as unknown as Sql
  return { sql, queries, values }
}

describe('governed learning boundary', () => {
  const citation = { chunkId: 'chunk', documentId: 'source', documentVersion: 2, doctorId: 'doctor', language: 'es', governanceReviewState: 'trusted', retrievalRevision: 7 }
  const sourceRow = { id: 'chunk', documentVersion: 2, doctorId: 'doctor', language: 'es', governanceReviewState: 'trusted' }
  const candidate = { id: 'candidate', revision: 1, status: 'pending_review', candidateContent: 'We open at 9 AM.', supportingChunks: [citation], confidenceScore: .9, groundingScore: 1, consistencyCount: 2, contradictionFree: true, medicalSafetyOk: true, promptSafetyOk: true, patientFeedback: 'unknown', humanEdit: null, staffConfirmed: false, originalSource: {}, evidence: { relevance: .7, confidence: .9, grounding: 1, contradiction: 'clear', risks: [], retrievalRevision: 7, doctorId: 'doctor', language: 'es', safeContentClass: 'office_hours' } } as unknown as GovernedCandidate
  it('reports every automatic gate and rejects malformed, partial or restricted evidence', () => {
    const config = { autoApprove: true, groundingThreshold: .8, evidenceRetentionHours: 24 }
    expect(automaticPublicationReasons(candidate, config, true)).toEqual([])
    expect(automaticPublicationReasons({ ...candidate, groundingScore: .9 }, config, true)).toContain('not_fully_grounded')
    expect(automaticPublicationReasons({ ...candidate, confidenceScore: Number.NaN }, config, true)).toContain('confidence_below_80_percent')
    expect(automaticPublicationReasons({ ...candidate, evidence: { ...candidate.evidence, risks: ['medical'] } }, config, true)).toContain('medical')
    expect(automaticPublicationReasons({ ...candidate, patientFeedback: 'corrected' }, config, true)).toContain('patient_corrected')
    expect(automaticPublicationReasons(candidate, { ...config, autoApprove: false }, true)).toContain('automatic_publication_disabled')
    expect(automaticPublicationReasons(candidate, config, false)).toContain('stale_or_missing_sources')
  })
  it('publishes the document, chunks, revision and audit inside the single review transaction', async () => {
    let begins = 0
    const f = fake(q => q.includes('SELECT * FROM knowledge_candidates') ? [candidate]
      : q.includes('SELECT c.id') ? [sourceRow]
      : q.includes('SELECT metadata') ? [{ metadata: { doctorId: 'doctor', language: 'es' } }]
      : q.includes('INSERT INTO knowledge_documents') ? [{ id: 'published', version: 1 }]
      : q.includes('INSERT INTO knowledge_chunks') ? [{ id: 'new-chunk' }]
      : q.includes('UPDATE knowledge_candidates') ? [{ ...candidate, status: 'approved', revision: 2 }]
      : [])
    f.sql.begin = (async (fn: (tx: Sql) => unknown) => { begins++; return fn(f.sql) }) as never
    const result = await createKnowledgeLearningRepository(f.sql).review('clinic', 'candidate', { action: 'approve', expectedRevision: 1, actorId: 'admin' })
    expect(result.write?.document.id).toBe('published'); expect(begins).toBe(1)
    expect(f.queries.join('\n')).toContain('knowledge_retrieval_revisions')
    expect(f.queries.join('\n')).toContain('knowledge_learning_history')
    const metadata = f.values[f.queries.findIndex(q => q.includes('INSERT INTO knowledge_documents'))]!.find(v => typeof v === 'object')
    expect(metadata).toMatchObject({ doctorId: 'doctor', language: 'es' })
    expect(f.queries.find(q => q.includes('INSERT INTO knowledge_learning_history'))).toContain('evidence')
    const revisionLock = f.queries.findIndex(q => q.includes('SELECT revision') && q.includes('FOR UPDATE'))
    expect(revisionLock).toBeGreaterThan(-1)
    expect(revisionLock).toBeLessThan(f.queries.findIndex(q => q.includes('INSERT INTO knowledge_documents')))
    const updateIndex = f.queries.findIndex(q => q.includes('UPDATE knowledge_candidates'))
    expect(f.queries[updateIndex]).toContain('supporting_chunks =')
    expect(f.values[updateIndex]).toContainEqual(expect.objectContaining({ retrievalRevision: 1 }))
  })
  it('an approve retry returns the same published version without a second writer', async () => {
    const f = fake(q => q.includes('FROM knowledge_candidates') ? [{ ...candidate, status: 'approved', revision: 2, publishedDocumentId: 'published', publishedDocumentVersion: 4 }] : [])
    const result = await createKnowledgeLearningRepository(f.sql).review('clinic', 'candidate', { action: 'approve', expectedRevision: 1, actorId: 'admin' })
    expect(result.write).toBeNull(); expect(result.candidate.publishedDocumentVersion).toBe(4)
    expect(f.queries.join('\n')).not.toContain('INSERT INTO knowledge_documents')
  })
  it('creates only a pending human-confirmed correction from a tenant-owned gap', async () => {
    const f = fake(q => q.includes('FROM knowledge_gaps') ? [{ id: 'gap', question: 'When do you open?' }]
      : q.includes('INSERT INTO knowledge_candidates') ? [{ ...candidate, staffConfirmed: true, revision: 1 }] : [])
    await createKnowledgeLearningRepository(f.sql).candidateFromGap('clinic', 'gap', 'We open at nine.', 'admin')
    expect(f.queries.join('\n')).toContain("'pending_review'")
    expect(f.queries.join('\n')).not.toContain('INSERT INTO knowledge_documents')
    expect(f.values.flat()).toContain('admin')
    await expect(createKnowledgeLearningRepository(fake().sql).candidateFromGap('foreign', 'gap', 'We open at nine.', 'admin')).rejects.toThrow('not_found')
  })
  it('allows a reviewed correction as a new revision without destroying prior approved history', async () => {
    const f = fake(q => q.includes('FROM knowledge_candidates') ? [{ ...candidate, status: 'approved', expiresAt: null, publishedDocumentId: 'published', publishedDocumentVersion: 1 }]
      : q.includes('UPDATE knowledge_candidates') ? [{ ...candidate, status: 'pending_review', humanEdit: 'Open at ten.', revision: 2 }] : [])
    const result = await createKnowledgeLearningRepository(f.sql).review('clinic', 'candidate', { action: 'edit', expectedRevision: 1, content: 'Open at ten.', staffConfirmed: true, actorId: 'admin' })
    expect(result.candidate.status).toBe('pending_review')
    expect(f.queries.join('\n')).not.toContain('DELETE')
    expect(f.queries.join('\n')).not.toContain('INSERT INTO knowledge_documents')
  })
  it('negative patient feedback cannot be overwritten by a later acceptance', async () => {
    const f = fake(q => q.includes('UPDATE knowledge_learning_events') ? [{ candidateId: 'candidate' }] : [])
    await createKnowledgeLearningRepository(f.sql).feedback('clinic', 'event', 'accepted', 'admin')
    expect(f.queries.find(q => q.includes('UPDATE knowledge_candidates'))).toContain("patient_feedback IN ('corrected','escalated')")
    expect(f.values.flat()).toContain('clinic')
  })
  it('deduplicates normalized facts and strips contact data', () => {
    expect(learningFingerprint('  We OPEN at 9. ')).toBe(learningFingerprint('we open at 9.'))
    expect(sanitizeLearningText('me llamo Daniel Soto. email me dan@example.com or +502 5555 1234').text).not.toMatch(/Daniel|dan@|5555/)
  })
  it('defaults automatic publication off', async () => {
    expect(await createKnowledgeLearningRepository(fake().sql).settings('clinic')).toEqual({ autoApprove: false, groundingThreshold: 1, evidenceRetentionHours: 24 })
  })
  it.each(['doctor_reassigned', 'governance_excluded', 'revision_changed'])('blocks approval after %s even when staff confirmed', async change => {
    const scoped = { ...citation, doctorId: 'doctor-a', language: 'en', governanceReviewState: 'trusted', retrievalRevision: 7 }
    const row = { ...candidate, staffConfirmed: true, humanEdit: candidate.candidateContent, supportingChunks: [scoped], evidence: { ...candidate.evidence, retrievalRevision: 7, doctorId: 'doctor-a', language: 'en' } }
    const f = fake(q => q.includes('FROM knowledge_candidates') ? [row]
      : q.includes('SELECT revision') ? [{ revision: change === 'revision_changed' ? 8 : 7 }]
      : q.includes('SELECT c.id') ? [{ id: 'chunk', documentVersion: 2, doctorId: change === 'doctor_reassigned' ? 'doctor-b' : 'doctor-a', language: 'en', governanceReviewState: change === 'governance_excluded' ? 'excluded' : 'trusted' }] : [])
    await expect(createKnowledgeLearningRepository(f.sql).review('clinic', 'candidate', { action: 'approve', actorId: 'admin', expectedRevision: 1 })).rejects.toThrow('stale_sources')
    expect(f.queries.join('\n')).not.toContain('INSERT INTO knowledge_documents')
  })
  it('uses the full retrieval predicate and preserves revision/scope evidence', async () => {
    const scoped = { ...citation, doctorId: null, language: 'en', governanceReviewState: 'trusted', retrievalRevision: 7 }
    const f = fake(q => q.includes('SELECT revision') ? [{ revision: 7 }] : q.includes('SELECT c.id') ? [{ id: 'chunk', documentVersion: 2, doctorId: null, language: 'en', governanceReviewState: 'trusted' }] : [])
    expect(await createKnowledgeLearningRepository(f.sql).sourcesCurrent('clinic', [scoped], { retrievalRevision: 7, doctorId: null, language: 'en' })).toBe(true)
    const query = f.queries.find(q => q.includes('SELECT c.id'))!
    expect(query).toContain("governanceReviewState")
    expect(query).toContain('d.effective_from <= now()')
    expect(query).not.toContain('effective_from IS NULL')
    expect(query).toContain("doctorId")
  })
  it('dedupe changes for unchanged answers with a new source version or scope', async () => {
    const fingerprints: unknown[] = []
    for (const [version, doctorId] of [[2, 'doctor-a'], [3, 'doctor-a'], [3, 'doctor-b']] as const) {
      const scoped = { ...citation, documentVersion: version, doctorId, language: 'en', governanceReviewState: 'trusted', retrievalRevision: 7 }
      const f = fake(q => q.includes('SELECT revision') ? [{ revision: 7 }] : q.includes('SELECT c.id') ? [{ id: 'chunk', documentVersion: version, doctorId, language: 'en', governanceReviewState: 'trusted' }] : q.includes('INSERT INTO knowledge_learning_events') ? [{ id: 'event' }] : [])
      await createKnowledgeLearningRepository(f.sql).recordAttempt({ clinicId: 'clinic', eventKey: 'event', question: 'Hours?', answer: 'We open at 9 AM.', citations: [scoped], ...candidate.evidence, retrievalRevision: 7, doctorId, language: 'en' })
      const index = f.queries.findIndex(q => q.includes('INSERT INTO knowledge_candidates'))
      expect(index).toBeGreaterThan(-1)
      const stored = f.values[index]!.filter(v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v))
      fingerprints.push(stored[0])
      expect(f.values[index]).toContainEqual(expect.objectContaining({ retrievalRevision: 7, doctorId, language: 'en' }))
    }
    expect(new Set(fingerprints).size).toBe(3)
  })
  it('expires questions separately and migration scrubs durable legacy questions/history', async () => {
    const f = fake(); await createKnowledgeLearningRepository(f.sql).purgeExpired()
    expect(f.queries.join('\n')).toContain('source_question_expires_at <= now()')
    const migration = readFileSync(new URL('../../supabase/migrations/20260920000003_kb_learning_evidence_remediation.sql', import.meta.url), 'utf8')
    expect(migration).toContain("source_question = ''")
    expect(migration).toContain("status IN ('approved', 'superseded')")
    expect(migration).toContain('knowledge_learning_history')
  })
  it('approval clears an unrecognized name/identifier and retains only the reviewed generalized fact', async () => {
    const rawQuestion = 'Alex ZQ17 asks when we open?'
    expect(sanitizeLearningText(rawQuestion).changed).toBe(false)
    const f = fake(q => q.includes('SELECT * FROM knowledge_candidates') ? [{ ...candidate, sourceQuestion: rawQuestion }]
      : q.includes('SELECT c.id') ? [sourceRow]
      : q.includes('SELECT metadata') ? [{ metadata: { doctorId: 'doctor', language: 'es' } }]
      : q.includes('INSERT INTO knowledge_documents') ? [{ id: 'published', version: 1 }]
      : q.includes('INSERT INTO knowledge_chunks') ? [{ id: 'new' }]
      : q.includes('UPDATE knowledge_candidates') ? [{ ...candidate, sourceQuestion: '', revision: 2, status: 'approved' }] : [])
    const result = await createKnowledgeLearningRepository(f.sql).review('clinic', 'candidate', { action: 'approve', expectedRevision: 1, actorId: 'admin', staffConfirmed: true, content: 'We open at 9 AM.' })
    expect(result.candidate.sourceQuestion).toBe('')
    expect(f.queries.find(q => q.includes('UPDATE knowledge_candidates'))).toContain("THEN '' ELSE source_question")
    expect(f.queries.find(q => q.includes('UPDATE knowledge_learning_history'))).toContain("action NOT IN ('approve', 'rollback')")
    expect(f.values.flat()).not.toContain(rawQuestion)
    expect(f.values[f.queries.findIndex(q => q.includes('INSERT INTO knowledge_learning_history'))]).toContain('We open at 9 AM.')
  })
  it.each(['Take ibuprofen every morning.', 'Aplica retinol por la noche.', 'Children must be accompanied by an adult.', 'Los menores deben venir con un adulto.'])('unknown safe class cannot auto-publish: %s', async content => {
    const row = { ...candidate, candidateContent: content, evidence: { ...candidate.evidence, safeContentClass: 'office_hours' } }
    expect(automaticPublicationReasons(row as GovernedCandidate, { autoApprove: true, groundingThreshold: 1, evidenceRetentionHours: 24 }, true)).toContain('unverified_content_class')
  })
  it.each([['We open at 9 AM. We open at 8 AM.'], ['We open at 9 AM.', 'We open at 8 AM.']])('rechecks complete scoped consistency under approval lock: %j', async (...contents) => {
    const f = fake(q => q.includes('SELECT * FROM knowledge_candidates') ? [candidate]
      : q.includes('SELECT c.id') ? [sourceRow]
      : q.includes('SELECT c.content') ? contents.map(content => ({ content }))
      : q.includes('FROM knowledge_learning_settings') ? [{ autoApprove: true, groundingThreshold: 1, evidenceRetentionHours: 24 }] : [])
    await expect(createKnowledgeLearningRepository(f.sql).review('clinic', 'candidate', { action: 'approve', expectedRevision: 1, actorId: null, automatic: true })).rejects.toThrow('automatic_gates_failed')
    expect(f.queries.join('\n')).not.toContain('INSERT INTO knowledge_documents')
  })
  it('only marks a bounded complete current scope complete and preserves language fallback evidence', async () => {
    const f = fake(q => q.includes('SELECT c.content') ? Array.from({ length: 101 }, () => ({ content: 'We open at 9 AM.' })) : [])
    const result = await createKnowledgeLearningRepository(f.sql).scopedConsistency('clinic', candidate.evidence)
    expect(result.complete).toBe(false)
    expect(f.queries.find(q => q.includes('SELECT c.content'))).toContain('LIMIT 101')
    expect(f.queries.find(q => q.includes('SELECT c.content'))).toContain("governanceReviewState")
  })
  it('scopes every list and caps pagination', async () => {
    const f = fake(); await createKnowledgeLearningRepository(f.sql).list('clinic', 'pending_review', 9000)
    expect(f.queries[0]).toContain('clinic_id =')
    expect(f.values[0]).toContain('clinic'); expect(f.values[0]).toContain(100)
  })
  it('fails closed on missing and stale source versions', async () => {
    const f = fake(() => [{ id: 'chunk', documentVersion: 3 }]); const repo = createKnowledgeLearningRepository(f.sql)
    expect(await repo.sourcesCurrent('clinic', [])).toBe(false)
    expect(await repo.sourcesCurrent('clinic', [{ ...citation, documentId: 'doc' }], candidate.evidence)).toBe(false)
    expect(f.values.flat()).toContain('clinic')
  })
  it('rejects stale review without publishing any document', async () => {
    const f = fake(q => q.includes('FROM knowledge_candidates') ? [{ id: 'candidate', revision: 2, status: 'pending_review' }] : [])
    await expect(createKnowledgeLearningRepository(f.sql).review('clinic', 'candidate', { action: 'approve', expectedRevision: 1, actorId: 'admin' })).rejects.toThrow('stale_candidate')
    expect(f.queries.join('\n')).not.toContain('INSERT INTO knowledge_documents')
  })
  it('does not recount a retried inbound event', async () => {
    const f = fake(); const repo = createKnowledgeLearningRepository(f.sql)
    const result = await repo.recordAttempt({ clinicId: 'clinic', eventKey: 'event', question: 'hours?', answer: 'Open 9.', citations: [], relevance: .9, confidence: .9, grounding: 1, contradiction: 'unknown', risks: [], handoffReason: 'missing_sources' })
    expect(result.replayed).toBe(true)
    expect(f.queries.join('\n')).not.toContain('INSERT INTO knowledge_candidates')
  })
  it('cleanup preserves approved candidate history', async () => {
    const f = fake(); await createKnowledgeLearningRepository(f.sql).purgeExpired()
    expect(f.queries.join('\n')).toContain("status IN ('pending_review', 'rejected')")
    expect(f.queries.join('\n')).not.toContain('DELETE FROM knowledge_learning_history')
  })
  it.each(['disabled', 'medical', 'pricing_or_policy', 'prompt_injection', 'privacy', 'conflict', 'unknown', 'escalated'])('refuses automatic publication for %s under the transaction lock', async (risk) => {
    const row = { ...candidate, evidence: { ...candidate.evidence, risks: ['medical','pricing_or_policy','prompt_injection','privacy'].includes(risk) ? [risk] : [], contradiction: ['conflict','unknown'].includes(risk) ? risk : 'clear' }, patientFeedback: risk === 'escalated' ? 'escalated' : 'unknown' }
    const f = fake(q => q.includes('FROM knowledge_candidates') ? [row]
      : q.includes('SELECT c.id') ? [sourceRow]
      : q.includes('FROM knowledge_learning_settings') ? [{ autoApprove: risk !== 'disabled', groundingThreshold: 1, evidenceRetentionHours: 24 }] : [])
    await expect(createKnowledgeLearningRepository(f.sql).review('clinic', 'candidate', { action: 'approve', expectedRevision: 1, actorId: null, automatic: true })).rejects.toThrow('automatic_gates_failed')
    expect(f.queries.join('\n')).not.toContain('INSERT INTO knowledge_documents')
    expect(f.queries[0]).toContain('FOR UPDATE')
  })
  it('revalidates rollback ownership and republishes the historical answer as a new document version', async () => {
    const f = fake(q => q.includes('FROM knowledge_candidates') ? [{ ...candidate, status: 'approved', publishedDocumentId: 'published', publishedDocumentVersion: 2 }]
      : q.includes('FROM knowledge_learning_history') ? [{ action: 'approve', content: 'Original approved hours.' }]
      : q.includes('SELECT c.id') ? [sourceRow]
      : q.includes('SELECT metadata') ? [{ metadata: {} }]
      : q.includes('SELECT * FROM knowledge_documents') ? [{ id: 'published', version: 2, status: 'active' }]
      : q.includes('UPDATE knowledge_documents') ? [{ id: 'published', version: 3 }]
      : q.includes('INSERT INTO knowledge_chunks') ? [{ id: 'new-chunk' }]
      : q.includes('UPDATE knowledge_candidates') ? [{ ...candidate, status: 'approved', revision: 2, publishedDocumentVersion: 3 }] : [])
    const result = await createKnowledgeLearningRepository(f.sql).review('clinic', 'candidate', { action: 'rollback', expectedRevision: 1, historyId: 'history', staffConfirmed: true, actorId: 'admin' })
    expect(result.write?.document.version).toBe(3)
    expect(f.values.flat()).toContain('Original approved hours.')
    expect(f.queries.find(q => q.includes('FROM knowledge_learning_history'))).toContain('clinic_id =')
    expect(f.queries.join('\n')).toContain('embedding = NULL')
  })
  it('serializes concurrent approve retries into one publication', async () => {
    let state = candidate; let writes = 0; let tail: Promise<unknown> = Promise.resolve()
    const f = fake(q => q.includes('FROM knowledge_candidates') ? [state]
      : q.includes('SELECT c.id') ? [sourceRow]
      : q.includes('SELECT metadata') ? [{ metadata: {} }]
      : q.includes('INSERT INTO knowledge_documents') ? (writes++, [{ id: 'published', version: 1 }])
      : q.includes('INSERT INTO knowledge_chunks') ? [{ id: 'new' }]
      : q.includes('UPDATE knowledge_candidates') ? [state = { ...candidate, status: 'approved', revision: 2 }] : [])
    f.sql.begin = ((fn: (tx: Sql) => unknown) => { const next = tail.then(() => fn(f.sql)); tail = next.catch(() => undefined); return next }) as never
    const repo = createKnowledgeLearningRepository(f.sql)
    const results = await Promise.all([1, 2].map(() => repo.review('clinic', 'candidate', { action: 'approve', expectedRevision: 1, actorId: 'admin' })))
    expect(writes).toBe(1); expect(results.filter(row => row.write).length).toBe(1)
    // Fake serializes transactions; real PostgreSQL lock behavior remains an integration gate.
    expect(f.queries.filter(q => q.includes('FROM clinics')).every(q => q.includes('FOR UPDATE'))).toBe(true)
  })
})
