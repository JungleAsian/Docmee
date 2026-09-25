import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Sql } from '../client.js'
import { createKnowledgeLearningRepository, learningFingerprint, sanitizeLearningText, automaticPublicationReasons, reviewerReadiness, type GovernedCandidate } from '../repositories/knowledge-learning.repository.js'

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
  it('separates staff readiness from strict automatic publication and marks stale evidence', () => {
    const config = { autoApprove: true, groundingThreshold: .8, evidenceRetentionHours: 24 }
    const ready = reviewerReadiness({ ...candidate, expiresAt: '2099-01-01' }, config, true)
    expect(ready.ready).toBe(true)
    expect(ready.reasons).toEqual([])
    expect(reviewerReadiness({ ...candidate, expiresAt: '2099-01-01' }, config, false)).toMatchObject({ ready: false, citationsCurrent: false })
    expect(automaticPublicationReasons({ ...candidate, consistencyCount: 1 }, config, true)).toContain('repeat_consistency_required')
  })
  it('blocks manual approval and malformed rejections before creating an audit or document write', async () => {
    const attempts = [
      [{ action: 'approve', expectedRevision: 1, actorId: 'admin' }, 'staff_confirmation_required'],
      [{ action: 'reject', expectedRevision: 1, actorId: 'admin' }, 'rejection_reason_required'],
      [{ action: 'reject', expectedRevision: 1, actorId: 'admin', rejectionReason: 'other' }, 'rejection_detail_required'],
    ] as const

    for (const [input, error] of attempts) {
      const f = fake(q => q.includes('FROM knowledge_candidates') ? [candidate] : [])
      await expect(createKnowledgeLearningRepository(f.sql).review('clinic', 'candidate', input)).rejects.toThrow(error)
      expect(f.queries.join('\n')).not.toContain('INSERT INTO knowledge_documents')
      expect(f.queries.join('\n')).not.toContain('INSERT INTO knowledge_learning_history')
    }
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
    const result = await createKnowledgeLearningRepository(f.sql).review('clinic', 'candidate', { action: 'approve', expectedRevision: 1, actorId: 'admin', staffConfirmed: true })
    expect(result.write?.document.id).toBe('published'); expect(begins).toBe(1)
    expect(f.queries.join('\n')).toContain('knowledge_retrieval_revisions')
    expect(f.queries.join('\n')).toContain('knowledge_learning_history')
    const metadata = f.values[f.queries.findIndex(q => q.includes('INSERT INTO knowledge_documents'))]!.find(v => typeof v === 'object')
    expect(metadata).toMatchObject({ doctorId: 'doctor', language: 'es' })
    expect(f.queries.find(q => q.includes('INSERT INTO knowledge_learning_history'))).toContain('evidence')
    const revisionLock = f.queries.findIndex(q => q.includes('SELECT revision') && q.includes('FOR UPDATE'))
    expect(f.queries[0]).toMatch(/FROM clinics[\s\S]*FOR UPDATE/)
    expect(revisionLock).toBe(1)
    expect(f.queries.join('\n')).not.toContain('FOR SHARE')
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
  it('forks approved knowledge into an independently expiring draft without updating approved provenance', async () => {
    const f = fake(q => q.includes('FROM knowledge_candidates') && q.includes('AND id =') ? [{ ...candidate, status: 'approved', expiresAt: null, publishedDocumentId: 'published', publishedDocumentVersion: 1 }]
      : q.includes('INSERT INTO knowledge_candidates') ? [{ ...candidate, id: 'draft', previousVersionId: 'candidate', status: 'pending_review', expiresAt: '2099-01-01', revision: 1 }]
      : q.includes('UPDATE knowledge_candidates') ? [{ ...candidate, status: 'pending_review', expiresAt: null }] : [])
    const result = await createKnowledgeLearningRepository(f.sql).review('clinic', 'candidate', { action: 'edit', expectedRevision: 1, content: 'Open at ten.', staffConfirmed: true, actorId: 'admin' })
    expect(result.candidate.status).toBe('pending_review')
    expect(result.candidate.id).toBe('draft')
    expect(result.candidate.previousVersionId).toBe('candidate')
    expect(result.candidate.expiresAt).not.toBeNull()
    expect(f.queries.join('\n')).not.toContain('UPDATE knowledge_candidates')
    const insert = f.queries.find(q => q.includes('INSERT INTO knowledge_candidates'))!
    expect(insert).toContain('previous_version_id')
    expect(insert).toContain('expires_at')
    expect(insert).toContain("interval '1 hour'")
    const historyValues = f.values[f.queries.findIndex(q => q.includes('INSERT INTO knowledge_learning_history'))]!
    expect(historyValues).toContain('draft')
    expect(f.queries.join('\n')).not.toContain('DELETE')
    expect(f.queries.join('\n')).not.toContain('INSERT INTO knowledge_documents')
  })
  it.each(['approve', 'rollback'] as const)('refuses %s over a newer target document version', async action => {
    const f = fake(q => q.includes('FROM knowledge_candidates') ? [{ ...candidate, status: action === 'rollback' ? 'approved' : 'pending_review', publishedDocumentId: 'published', publishedDocumentVersion: 2, previousVersionId: 'parent' }]
      : q.includes('FROM knowledge_learning_history') ? [{ id: 'history', candidateId: 'candidate', documentId: 'published', documentVersion: 1, action: 'approve', content: 'We open at 9 AM.' }]
      : q.includes('FROM knowledge_documents') && q.includes('FOR UPDATE') ? [{ id: 'published', version: 3 }] : [])
    await expect(createKnowledgeLearningRepository(f.sql).review('clinic', 'candidate', { action, expectedRevision: 1, actorId: 'admin', staffConfirmed: true, historyId: 'history' })).rejects.toThrow('stale_candidate')
    expect(f.queries.join('\n')).not.toContain('UPDATE knowledge_documents')
  })
  it.each(['abandon', 'reject'] as const)('approve -> edit -> %s -> cleanup keeps only approved knowledge and history', async disposition => {
    const states = new Map<string, GovernedCandidate>([['candidate', { ...candidate, expiresAt: '2099-01-01', sourceQuestion: 'Private source question' }]])
    const histories: Array<{ candidateId: string; action: string; content: string }> = []
    let documentWrites = 0
    const f = fake((q, values) => {
      if (q.includes('SELECT * FROM knowledge_candidates')) return q.includes('fingerprint') ? [] : [states.get(String(values[1]))!]
      if (q.includes('SELECT c.id')) return [sourceRow]
      if (q.includes('SELECT metadata')) return [{ metadata: { doctorId: 'doctor', language: 'es' } }]
      if (q.includes('INSERT INTO knowledge_documents')) { documentWrites++; return [{ id: 'published', version: 1 }] }
      if (q.includes('INSERT INTO knowledge_chunks')) return [{ id: 'new' }]
      if (q.includes('INSERT INTO knowledge_candidates')) {
        const draft = { ...candidate, id: 'draft', candidateContent: String(values[1]), sourceQuestion: '', previousVersionId: String(values[8]), publishedDocumentId: String(values[9]), publishedDocumentVersion: Number(values[10]), evidence: values[5], humanEdit: String(values[7]), expiresAt: '2099-01-01' } as GovernedCandidate
        states.set('draft', draft); return [draft]
      }
      if (q.includes('UPDATE knowledge_candidates') && q.includes('RETURNING *')) {
        const id = String(values.at(-1)); const before = states.get(id)!
        const next = { ...before, candidateContent: String(values[0]), evidence: values[1], supportingChunks: values[2], humanEdit: values[3], status: values[7], revision: before.revision + 1, publishedDocumentId: values[10], publishedDocumentVersion: values[11], sourceQuestion: values[12] ? '' : before.sourceQuestion, expiresAt: values[14] ? null : before.expiresAt } as GovernedCandidate
        states.set(id, next); return [next]
      }
      if (q.includes('INSERT INTO knowledge_learning_history')) {
        const draftInsert = q.includes("1, 'edit'")
        histories.push({ candidateId: String(values[1]), action: draftInsert ? 'edit' : String(values[3]), content: String(values[draftInsert ? 3 : 5]) })
      }
      if (q.includes('DELETE FROM knowledge_candidates')) {
        // SQL-boundary harness models the migration's existing ON DELETE CASCADE;
        // actual PostgreSQL FK/expiry execution remains an integration gate.
        expect(q).toContain("status IN ('pending_review', 'rejected')")
        const expired = [...states.values()].filter(row => row.expiresAt && Date.parse(row.expiresAt) <= Date.now() && ['pending_review', 'rejected'].includes(row.status))
        for (const row of expired) {
          states.delete(row.id)
          for (let i = histories.length - 1; i >= 0; i--) if (histories[i]!.candidateId === row.id) histories.splice(i, 1)
        }
        return expired
      }
      return []
    })
    const repo = createKnowledgeLearningRepository(f.sql)
    await repo.review('clinic', 'candidate', { action: 'approve', expectedRevision: 1, actorId: 'admin', staffConfirmed: true })
    const approved = structuredClone(states.get('candidate')!)
    const approvedHistory = structuredClone(histories)
    const edited = await repo.review('clinic', 'candidate', { action: 'edit', expectedRevision: 2, actorId: 'admin', content: 'Unreviewed draft answer.', staffConfirmed: true })
    expect(edited.candidate.id).toBe('draft')
    expect(edited.candidate.sourceQuestion).toBe('')
    expect(edited.candidate.expiresAt).not.toBeNull()
    if (disposition === 'reject') await repo.review('clinic', 'draft', { action: 'reject', expectedRevision: 1, actorId: 'admin', rejectionReason: 'outdated' })
    expect(states.get('candidate')).toEqual(approved)
    expect(histories.filter(row => row.candidateId === 'candidate')).toEqual(approvedHistory)
    states.get('draft')!.expiresAt = '2000-01-01'
    expect((await repo.purgeExpired()).candidates).toBe(1)
    expect([...states.values()]).toEqual([approved])
    expect(histories).toEqual(approvedHistory)
    expect(JSON.stringify([...states.values(), ...histories])).not.toContain('Unreviewed draft answer.')
    expect(documentWrites).toBe(1)
  })
  it('requires an expiring pending lifecycle and migrates only unapproved snapshots away from durable provenance', () => {
    const migration = readFileSync(new URL('../../supabase/migrations/20260920000004_kb_learning_draft_lifecycle.sql', import.meta.url), 'utf8')
    const schema = readFileSync(new URL('../../supabase/migrations/20260920000002_kb_learning_governance.sql', import.meta.url), 'utf8')
    expect(schema).toMatch(/CREATE TABLE knowledge_learning_history[\s\S]*candidate_id uuid NOT NULL REFERENCES knowledge_candidates\(id\) ON DELETE CASCADE/)
    expect(migration).toContain("status NOT IN ('pending_review', 'rejected') OR expires_at IS NOT NULL")
    expect(migration).toContain('previous_version_id')
    expect(migration).toContain('SET candidate_id = draft_id')
    expect(migration).toContain("action NOT IN ('approve', 'rollback')")
    expect(migration).toContain('candidate_content = approved.content')
    expect(migration).not.toContain('DELETE FROM knowledge_learning_history')
    const reviewerAuditMigration = readFileSync(new URL('../../supabase/migrations/20260920000005_kb_learning_reviewer_audit.sql', import.meta.url), 'utf8')
    expect(reviewerAuditMigration).toContain('rejection_reason')
    expect(reviewerAuditMigration).toContain('not_clinic_policy')
    expect(reviewerAuditMigration).toContain('rejection_detail')
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
    await expect(createKnowledgeLearningRepository(f.sql).review('clinic', 'candidate', { action: 'approve', actorId: 'admin', expectedRevision: 1, staffConfirmed: true })).rejects.toThrow('stale_sources')
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
      : q.includes('FROM knowledge_learning_history') ? [{ id: 'history', candidateId: 'candidate', documentId: 'published', documentVersion: 1, action: 'approve', content: 'Original approved hours.' }]
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
  it('approves A, forks and approves B, then restores the approved A snapshot through B as document v3', async () => {
    const states = new Map<string, GovernedCandidate>([['candidate', { ...candidate, clinicId: 'clinic', previousVersionId: null }]])
    const histories: Array<Record<string, unknown>> = []
    let documentVersion = 0; let retrievalRevision = 7; let publishedContent = ''
    const f = fake((q, v) => {
      if (q.includes('SELECT revision')) return [{ revision: retrievalRevision }]
      if (q.includes('SELECT * FROM knowledge_candidates')) return q.includes('fingerprint') ? [] : [states.get(String(v[1]))!]
      if (q.includes('FROM knowledge_learning_history')) return histories.filter(h => h.clinicId === v[0] && h.id === v[q.includes('candidate_id =') ? 2 : 1] && (!q.includes('candidate_id =') || h.candidateId === v[1]))
      if (q.includes('SELECT c.id')) return [sourceRow]
      if (q.includes('SELECT metadata')) return [{ metadata: { doctorId: 'doctor', language: 'es' } }]
      if (q.includes('SELECT * FROM knowledge_documents')) return [{ id: 'published', version: documentVersion, status: 'active', metadata: {} }]
      if (q.includes('WITH current_owner AS')) return []
      if (q.includes('INSERT INTO knowledge_documents') || q.includes('UPDATE knowledge_documents')) {
        documentVersion++; publishedContent = String(v.find(value => value === 'We open at 9 AM.' || value === 'We open at 10 AM.'))
        return [{ id: 'published', version: documentVersion }]
      }
      if (q.includes('INSERT INTO knowledge_retrieval_revisions')) return [{ revision: ++retrievalRevision }]
      if (q.includes('INSERT INTO knowledge_chunks')) return [{ id: 'new' }]
      if (q.includes('INSERT INTO knowledge_candidates')) {
        const draft = { ...candidate, clinicId: 'clinic', id: 'draft', candidateContent: String(v[1]), sourceQuestion: '', previousVersionId: String(v[8]), publishedDocumentId: String(v[9]), publishedDocumentVersion: Number(v[10]), evidence: v[5], supportingChunks: v[2], humanEdit: String(v[7]), staffConfirmed: true, expiresAt: '2099-01-01' } as GovernedCandidate
        states.set('draft', draft); return [draft]
      }
      if (q.includes('UPDATE knowledge_candidates') && q.includes('RETURNING *')) {
        const id = String(v.at(-1)); const before = states.get(id)!
        const next = { ...before, candidateContent: String(v[0]), evidence: v[1], supportingChunks: v[2], humanEdit: v[3], staffConfirmed: v[4], status: v[7], revision: before.revision + 1, publishedDocumentId: v[10], publishedDocumentVersion: v[11], expiresAt: v[14] ? null : before.expiresAt } as GovernedCandidate
        states.set(id, next); return [next]
      }
      if (q.includes('INSERT INTO knowledge_learning_history')) {
        const draftInsert = q.includes("1, 'edit'")
        histories.push({ id: `history-${histories.length}`, clinicId: v[0], candidateId: v[1], action: draftInsert ? 'edit' : v[3], content: v[draftInsert ? 3 : 5], documentId: draftInsert ? null : v[8], documentVersion: draftInsert ? null : v[9], evidence: v[draftInsert ? 5 : 7] })
      }
      return []
    })
    const repo = createKnowledgeLearningRepository(f.sql)
    await repo.review('clinic', 'candidate', { action: 'approve', expectedRevision: 1, actorId: 'admin', staffConfirmed: true })
    const approvedA = structuredClone(states.get('candidate'))
    const snapshotA = structuredClone(histories[0])
    await repo.review('clinic', 'candidate', { action: 'edit', expectedRevision: 2, content: 'We open at 10 AM.', staffConfirmed: true, actorId: 'admin' })
    await repo.review('clinic', 'draft', { action: 'approve', expectedRevision: 1, actorId: 'admin', staffConfirmed: true })
    expect(documentVersion).toBe(2); expect(publishedContent).toBe('We open at 10 AM.')
    const rollback = await repo.review('clinic', 'draft', { action: 'rollback', expectedRevision: 2, historyId: 'history-0', staffConfirmed: true, actorId: 'admin' })
    expect(rollback.write?.document.version).toBe(3)
    expect(publishedContent).toBe('We open at 9 AM.')
    expect(states.get('candidate')).toEqual(approvedA)
    expect(histories[0]).toEqual(snapshotA)
    expect(histories.at(-1)).toMatchObject({ candidateId: 'draft', action: 'rollback', documentVersion: 3, evidence: { rollbackSource: { historyId: 'history-0', candidateId: 'candidate', documentVersion: 1 } } })
  })
  it.each(['foreign_history', 'unrelated_candidate', 'foreign_ancestor', 'different_document', 'cycle', 'unapproved_snapshot'])('denies rollback from %s without publishing', async invalid => {
    const current = { ...candidate, id: 'current', clinicId: 'clinic', status: 'approved', previousVersionId: 'ancestor', publishedDocumentId: 'published', publishedDocumentVersion: 2 }
    const history = { id: 'history', candidateId: invalid === 'unrelated_candidate' || invalid === 'cycle' ? 'unrelated' : 'ancestor', documentId: 'published', documentVersion: 1, action: invalid === 'unapproved_snapshot' ? 'edit' : 'approve', content: 'Old approved answer.' }
    const f = fake((q, v) => {
      if (q.includes('FROM knowledge_learning_history')) return invalid === 'foreign_history' ? [] : [history]
      if (q.includes('SELECT * FROM knowledge_candidates')) {
        if (v[1] === 'current') return [current]
        return [{ ...current, id: 'ancestor', clinicId: invalid === 'foreign_ancestor' ? 'foreign' : 'clinic', publishedDocumentId: invalid === 'different_document' ? 'other-document' : 'published', previousVersionId: invalid === 'cycle' ? 'current' : null }]
      }
      return []
    })
    await expect(createKnowledgeLearningRepository(f.sql).review('clinic', 'current', { action: 'rollback', expectedRevision: 1, historyId: 'history', staffConfirmed: true, actorId: 'admin' })).rejects.toThrow('not_found')
    expect(f.queries.join('\n')).not.toContain('UPDATE knowledge_documents')
    expect(f.queries.join('\n')).not.toContain('INSERT INTO knowledge_documents')
    expect(f.queries.find(q => q.includes('FROM knowledge_learning_history'))).toContain('clinic_id =')
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
    const results = await Promise.all([1, 2].map(() => repo.review('clinic', 'candidate', { action: 'approve', expectedRevision: 1, actorId: 'admin', staffConfirmed: true })))
    expect(writes).toBe(1); expect(results.filter(row => row.write).length).toBe(1)
    // Fake serializes transactions; real PostgreSQL lock behavior remains an integration gate.
    expect(f.queries.filter(q => q.includes('FROM clinics')).every(q => q.includes('FOR UPDATE'))).toBe(true)
  })
})
