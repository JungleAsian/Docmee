import { createHash } from 'node:crypto'
import type { Sql, TxSql } from '../client.js'
import { toJson } from '../client.js'
import { lockKnowledgeMutation, writeKnowledgeDocument, type KnowledgeCandidate, type DocumentIndexWrite } from './knowledge.repository.js'
import { officeHourFact, scopedOfficeHourConsistency } from './knowledge-learning-evidence.js'

export interface LearningScope { retrievalRevision?: number; doctorId?: string | null; language?: string | null }
export interface LearningCitation extends LearningScope { chunkId: string; documentId: string; documentVersion: number; governanceReviewState?: string }
export interface LearningSettings { autoApprove: boolean; groundingThreshold: number; evidenceRetentionHours: number }
export interface LearningEvidence extends Record<string, unknown>, LearningScope {
  relevance: number | null; confidence: number | null; grounding: number | null
  contradiction: 'unknown' | 'clear' | 'conflict'; risks: string[]
  safeContentClass?: 'office_hours' | 'unknown'
}
export interface GovernedCandidate extends KnowledgeCandidate {
  revision: number; fingerprint: string; evidence: LearningEvidence; expiresAt: string | null
  publishedDocumentId: string | null; publishedDocumentVersion: number | null; staffConfirmed: boolean
  gateReasons?: string[]
}
export interface LearningAttempt extends LearningEvidence {
  clinicId: string; eventKey: string; question: string; answer: string
  citations: LearningCitation[]; handoffReason?: string | null
}
export interface LearningHistory {
  id: string; candidateId: string; revision: number; action: string; actorId: string | null
  content: string; citations: LearningCitation[]; evidence: Record<string, unknown>; documentId: string | null; documentVersion: number | null; createdAt: string
}
export interface LearningReview {
  action: 'edit' | 'reject' | 'approve' | 'rollback'
  expectedRevision: number; actorId: string | null; content?: string; staffConfirmed?: boolean
  historyId?: string; automatic?: boolean
}
const defaults: LearningSettings = { autoApprove: false, groundingThreshold: 1, evidenceRetentionHours: 24 }
const score = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null
/** Reasons are also returned to staff; no single model score authorizes publication. */
export function automaticPublicationReasons(candidate: GovernedCandidate, config: LearningSettings, current: boolean): string[] {
  const reasons: string[] = []
  if (config.autoApprove !== true) reasons.push('automatic_publication_disabled')
  if (!current) reasons.push('stale_or_missing_sources')
  if (score(Number(candidate.confidenceScore)) === null || Number(candidate.confidenceScore) < .8) reasons.push('confidence_below_80_percent')
  if (score(Number(candidate.groundingScore)) !== 1) reasons.push('not_fully_grounded')
  if (candidate.evidence?.contradiction !== 'clear' || !candidate.contradictionFree) reasons.push('contradiction_not_clear')
  if (!Array.isArray(candidate.evidence?.risks)) reasons.push('risk_unknown')
  else reasons.push(...candidate.evidence.risks)
  if (!candidate.medicalSafetyOk || !candidate.promptSafetyOk) reasons.push('safety_review_required')
  if (candidate.evidence?.safeContentClass !== 'office_hours' || !officeHourFact(candidate.candidateContent)) reasons.push('unverified_content_class')
  if (!Number.isInteger(candidate.consistencyCount) || candidate.consistencyCount < 2) reasons.push('repeat_consistency_required')
  if (['corrected','escalated'].includes(candidate.patientFeedback)) reasons.push(`patient_${candidate.patientFeedback}`)
  if (candidate.staffConfirmed || candidate.humanEdit) reasons.push('staff_review_required')
  return [...new Set(reasons)]
}
export function learningFingerprint(value: string): string {
  return createHash('sha256').update(value.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ')).digest('hex')
}
/** Bounded first-line deidentification, not a claim of comprehensive anonymization. */
export function sanitizeLearningText(value: string): { text: string; changed: boolean } {
  const text = value.slice(0, 12000)
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[phone]')
    .replace(/\b(?:my name is|me llamo|mi nombre es|patient name:)\s+[^.!?\n,]{2,80}/gi, '[name]')
    .replace(/https?:\/\/\S+/gi, '[link]')
  return { text, changed: text !== value }
}

async function revisionCurrent(tx: Sql | TxSql, clinicId: string, scope?: LearningScope): Promise<boolean> {
  if (!scope || !Number.isInteger(scope.retrievalRevision) || !Object.hasOwn(scope, 'doctorId') || !Object.hasOwn(scope, 'language')) return false
  const rows = await tx<Array<{ revision: number }>>`SELECT revision FROM knowledge_retrieval_revisions WHERE clinic_id = ${clinicId}`
  return Number(rows[0]?.revision ?? 0) === scope.retrievalRevision
}

async function scopedConsistency(tx: Sql | TxSql, clinicId: string, scope: LearningScope) {
  if (!await revisionCurrent(tx, clinicId, scope)) return { complete: false, sources: [] as string[] }
  // A complete, bounded scope is required. Unknown prose or >100 chunks cannot
  // prove consistency and is deliberately routed to staff rather than guessed.
  const rows = await tx<Array<{ content: string }>>`SELECT c.content FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id AND d.clinic_id = c.clinic_id
    WHERE c.clinic_id = ${clinicId} AND d.status = 'active' AND d.approved_at IS NOT NULL
      AND d.effective_from <= now() AND (d.effective_until IS NULL OR d.effective_until > now())
      AND c.is_active = true AND c.document_version = d.version
      AND COALESCE(d.metadata ->> 'governanceReviewState', 'trusted') NOT IN ('excluded', 'archived')
      AND (d.metadata ->> 'doctorId' IS NULL OR d.metadata ->> 'doctorId' = ${scope.doctorId ?? null})
    ORDER BY c.id LIMIT 101`
  return { complete: rows.length > 0 && rows.length <= 100 && await revisionCurrent(tx, clinicId, scope), sources: rows.map(row => row.content) }
}

async function sourcesCurrent(tx: Sql | TxSql, clinicId: string, citations: LearningCitation[], scope?: LearningScope): Promise<boolean> {
  if (!citations.length || citations.length > 5) return false
  if (!await revisionCurrent(tx, clinicId, scope)) return false
  for (const citation of citations) {
    if (!citation.chunkId || !citation.documentId || !Number.isInteger(citation.documentVersion)) return false
    if (citation.retrievalRevision !== scope!.retrievalRevision || !Object.hasOwn(citation, 'doctorId') || !Object.hasOwn(citation, 'language') || !citation.governanceReviewState) return false
    // Publication already owns the shared clinic/revision writer locks. Do not
    // take document SHARE locks that would need upgrading during replacement.
    const rows = await tx<Array<{ id: string; documentVersion: number; doctorId: string | null; language: string | null; governanceReviewState: string }>>`
      SELECT c.id, c.document_version, d.metadata ->> 'doctorId' AS doctor_id,
        COALESCE(d.metadata ->> 'language', c.metadata ->> 'language') AS language,
        COALESCE(d.metadata ->> 'governanceReviewState', 'trusted') AS governance_review_state
      FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id
      WHERE c.clinic_id = ${clinicId} AND d.clinic_id = ${clinicId} AND c.id = ${citation.chunkId}
        AND d.id = ${citation.documentId} AND c.document_version = ${citation.documentVersion}
        AND d.version = c.document_version AND c.is_active AND d.status = 'active' AND d.approved_at IS NOT NULL
        AND d.effective_from <= now()
        AND (d.effective_until IS NULL OR d.effective_until > now())
        AND COALESCE(d.metadata ->> 'governanceReviewState', 'trusted') NOT IN ('excluded', 'archived')
        AND (d.metadata ->> 'doctorId' IS NULL OR d.metadata ->> 'doctorId' = ${scope!.doctorId ?? null})
    `
    if (!rows.some(row => row.id === citation.chunkId && row.documentVersion === citation.documentVersion
      && row.doctorId === citation.doctorId && row.language === citation.language
      && row.governanceReviewState === citation.governanceReviewState && !['excluded', 'archived'].includes(row.governanceReviewState))) return false
  }
  return revisionCurrent(tx, clinicId, scope)
}

export function createKnowledgeLearningRepository(sql: Sql) {
  const settings = async (clinicId: string): Promise<LearningSettings> => {
    const rows = await sql<LearningSettings[]>`SELECT auto_approve, grounding_threshold, evidence_retention_hours FROM knowledge_learning_settings WHERE clinic_id = ${clinicId}`
    return rows[0] ? { autoApprove: rows[0].autoApprove === true, groundingThreshold: Number(rows[0].groundingThreshold), evidenceRetentionHours: Number(rows[0].evidenceRetentionHours) } : { ...defaults }
  }
  return {
    settings,
    async updateSettings(clinicId: string, value: LearningSettings) {
      if (typeof value.autoApprove !== 'boolean' || score(value.groundingThreshold) === null || value.groundingThreshold < .8 || !Number.isInteger(value.evidenceRetentionHours) || value.evidenceRetentionHours < 1 || value.evidenceRetentionHours > 24) throw new Error('invalid_settings')
      await sql`INSERT INTO knowledge_learning_settings (clinic_id, auto_approve, grounding_threshold, evidence_retention_hours)
        VALUES (${clinicId}, ${value.autoApprove}, ${value.groundingThreshold}, ${value.evidenceRetentionHours})
        ON CONFLICT (clinic_id) DO UPDATE SET auto_approve = EXCLUDED.auto_approve, grounding_threshold = EXCLUDED.grounding_threshold,
          evidence_retention_hours = EXCLUDED.evidence_retention_hours, updated_at = now()`
      return value
    },
    sourcesCurrent: (clinicId: string, citations: LearningCitation[], scope?: LearningScope) => sourcesCurrent(sql, clinicId, citations, scope),
    scopedConsistency: (clinicId: string, scope: LearningScope) => scopedConsistency(sql, clinicId, scope),
    async list(clinicId: string, status = 'pending_review', limit = 50): Promise<GovernedCandidate[]> {
      const rows = await sql<GovernedCandidate[]>`SELECT * FROM knowledge_candidates WHERE clinic_id = ${clinicId} AND status = ${status}
        AND (expires_at IS NULL OR expires_at > now()) ORDER BY updated_at DESC LIMIT ${Math.min(100, Math.max(1, limit))}`
      const config = await settings(clinicId)
      return Promise.all(rows.map(async row => ({ ...row, confidenceScore: Number(row.confidenceScore), groundingScore: Number(row.groundingScore), gateReasons: automaticPublicationReasons(row, config, await sourcesCurrent(sql, clinicId, row.supportingChunks as LearningCitation[], row.evidence)) })))
    },
    async events(clinicId: string) {
      return sql`SELECT id, candidate_id, question, answer, citations, evidence, feedback, handoff_reason, created_at FROM knowledge_learning_events
        WHERE clinic_id = ${clinicId} AND expires_at > now() ORDER BY created_at DESC LIMIT 100`
    },
    async gaps(clinicId: string) {
      return sql`SELECT * FROM knowledge_gaps WHERE clinic_id = ${clinicId} AND expires_at > now() ORDER BY occurrences DESC, updated_at DESC LIMIT 100`
    },
    async resolveGap(clinicId: string, id: string) {
      const rows = await sql`UPDATE knowledge_gaps SET status = 'resolved', updated_at = now() WHERE clinic_id = ${clinicId} AND id = ${id} RETURNING id`
      if (!rows[0]) throw new Error('not_found')
    },
    async candidateFromGap(clinicId: string, gapId: string, content: string, actorId: string): Promise<GovernedCandidate> {
      if (!actorId || !content.trim()) throw new Error('content_required')
      if (sanitizeLearningText(content).changed) throw new Error('remove_private_information')
      const config = await settings(clinicId)
      return sql.begin(async tx => {
        await tx`SELECT id FROM clinics WHERE id = ${clinicId} FOR UPDATE`
        const gaps = await tx<Array<{ id: string; question: string }>>`SELECT * FROM knowledge_gaps WHERE clinic_id = ${clinicId} AND id = ${gapId} AND expires_at > now() FOR UPDATE`
        if (!gaps[0]) throw new Error('not_found')
        const fingerprint = learningFingerprint(`staff:${gapId}:${content}`)
        const existing = await tx<GovernedCandidate[]>`SELECT * FROM knowledge_candidates WHERE clinic_id = ${clinicId} AND fingerprint = ${fingerprint}`
        if (existing[0]) return existing[0]
        const evidence = { relevance: null, confidence: null, grounding: null, contradiction: 'unknown', risks: ['staff_correction'] }
        const rows = await tx<GovernedCandidate[]>`INSERT INTO knowledge_candidates (clinic_id, source_question, candidate_content, status, confidence_score, grounding_score, medical_safety_ok, prompt_safety_ok, contradiction_free, supporting_chunks, original_source, fingerprint, evidence, staff_confirmed, human_edit, expires_at)
          VALUES (${clinicId}, ${gaps[0].question}, ${content}, 'pending_review', 0, 0, false, false, false, '[]'::jsonb, ${tx.json(toJson({ gapId, actorId, source: 'staff_correction' }))}, ${fingerprint}, ${tx.json(toJson(evidence))}, true, ${content}, now() + ${config.evidenceRetentionHours} * interval '1 hour') RETURNING *`
        const candidate = rows[0]!
        await tx`INSERT INTO knowledge_learning_history (clinic_id, candidate_id, revision, action, actor_id, content, evidence) VALUES (${clinicId}, ${candidate.id}, 1, 'staff_correction', ${actorId}, ${content}, ${tx.json(toJson(evidence))})`
        return candidate
      }) as unknown as Promise<GovernedCandidate>
    },
    async history(clinicId: string, candidateId: string): Promise<LearningHistory[]> {
      return sql<LearningHistory[]>`SELECT * FROM knowledge_learning_history WHERE clinic_id = ${clinicId} AND candidate_id = ${candidateId} ORDER BY revision DESC LIMIT 100`
    },
    async recordAttempt(input: LearningAttempt): Promise<{ replayed: boolean; candidate: GovernedCandidate | null }> {
      if (!input.eventKey || input.eventKey.length > 512) throw new Error('invalid_event_key')
      const question = sanitizeLearningText(input.question); const answer = sanitizeLearningText(input.answer)
      const evidence: LearningEvidence = { relevance: score(input.relevance), confidence: score(input.confidence), grounding: score(input.grounding), contradiction: input.contradiction, risks: [...new Set([...input.risks, ...(question.changed || answer.changed ? ['privacy'] : [])])], retrievalRevision: input.retrievalRevision, doctorId: input.doctorId, language: input.language, safeContentClass: officeHourFact(answer.text) ? 'office_hours' : 'unknown' }
      const config = await settings(input.clinicId)
      return sql.begin(async tx => {
        await tx`SELECT id FROM clinics WHERE id = ${input.clinicId} FOR UPDATE`
        const events = await tx<Array<{ id: string }>>`INSERT INTO knowledge_learning_events (clinic_id, event_key, question, answer, citations, evidence, handoff_reason, expires_at)
          VALUES (${input.clinicId}, ${learningFingerprint(input.eventKey)}, ${question.text}, ${answer.text}, ${tx.json(toJson(input.citations))}, ${tx.json(toJson(evidence))}, ${input.handoffReason ?? null}, now() + ${config.evidenceRetentionHours} * interval '1 hour')
          ON CONFLICT (clinic_id, event_key) DO NOTHING RETURNING id`
        if (!events[0]) return { replayed: true, candidate: null }
        const current = await sourcesCurrent(tx, input.clinicId, input.citations, evidence)
        const eligible = !input.handoffReason && current && answer.text.trim() && evidence.confidence !== null && evidence.confidence >= .8 && evidence.grounding !== null && evidence.grounding >= config.groundingThreshold && !evidence.risks.some(r => ['injection', 'prompt_injection', 'privacy'].includes(r))
        if (!eligible) {
          const reason = input.handoffReason ?? (!current ? 'stale_or_missing_sources' : 'insufficient_evidence')
          await tx`INSERT INTO knowledge_gaps (clinic_id, fingerprint, question, reason, expires_at)
            VALUES (${input.clinicId}, ${learningFingerprint(question.text)}, ${question.text}, ${reason}, now() + ${config.evidenceRetentionHours} * interval '1 hour')
            ON CONFLICT (clinic_id, fingerprint) DO UPDATE SET occurrences = knowledge_gaps.occurrences + 1, updated_at = now()`
          return { replayed: false, candidate: null }
        }
        const fingerprint = learningFingerprint(`${answer.text}\n${JSON.stringify({ scope: { revision: evidence.retrievalRevision, doctorId: evidence.doctorId, language: evidence.language }, citations: [...input.citations].sort((a,b) => a.chunkId.localeCompare(b.chunkId)) })}`)
        const rows = await tx<GovernedCandidate[]>`INSERT INTO knowledge_candidates
          (clinic_id, source_question, candidate_content, status, confidence_score, grounding_score, medical_safety_ok, prompt_safety_ok, contradiction_free, supporting_chunks, fingerprint, evidence, expires_at)
          VALUES (${input.clinicId}, ${question.text}, ${answer.text}, 'pending_review', ${evidence.confidence}, ${evidence.grounding}, ${!evidence.risks.includes('medical')}, ${!evidence.risks.includes('injection')}, ${evidence.contradiction === 'clear'}, ${tx.json(toJson(input.citations))}, ${fingerprint}, ${tx.json(toJson(evidence))}, now() + ${config.evidenceRetentionHours} * interval '1 hour')
          ON CONFLICT (clinic_id, fingerprint) WHERE fingerprint IS NOT NULL DO UPDATE
          SET consistency_count = knowledge_candidates.consistency_count + 1, updated_at = now(), revision = knowledge_candidates.revision + 1,
            confidence_score = LEAST(knowledge_candidates.confidence_score, EXCLUDED.confidence_score),
            grounding_score = LEAST(knowledge_candidates.grounding_score, EXCLUDED.grounding_score),
            contradiction_free = knowledge_candidates.contradiction_free AND EXCLUDED.contradiction_free,
            medical_safety_ok = knowledge_candidates.medical_safety_ok AND EXCLUDED.medical_safety_ok,
            prompt_safety_ok = knowledge_candidates.prompt_safety_ok AND EXCLUDED.prompt_safety_ok,
            evidence = jsonb_set(EXCLUDED.evidence, '{risks}', COALESCE(knowledge_candidates.evidence->'risks','[]'::jsonb) || (EXCLUDED.evidence->'risks'))
          WHERE knowledge_candidates.status = 'pending_review'
          RETURNING *`
        const candidate = rows[0] ?? (await tx<GovernedCandidate[]>`SELECT * FROM knowledge_candidates WHERE clinic_id = ${input.clinicId} AND fingerprint = ${fingerprint}`)[0] ?? null
        if (candidate) {
          await tx`UPDATE knowledge_learning_events SET candidate_id = ${candidate.id} WHERE clinic_id = ${input.clinicId} AND id = ${events[0].id}`
          if (candidate.revision === 1) await tx`INSERT INTO knowledge_learning_history (clinic_id, candidate_id, revision, action, content, citations)
            VALUES (${input.clinicId}, ${candidate.id}, 1, 'candidate', ${answer.text}, ${tx.json(toJson(input.citations))}) ON CONFLICT DO NOTHING`
        }
        return { replayed: false, candidate }
      }) as unknown as Promise<{ replayed: boolean; candidate: GovernedCandidate | null }>
    },
    async feedback(clinicId: string, eventId: string, feedback: 'accepted' | 'corrected' | 'escalated', actorId: string) {
      if (!['accepted','corrected','escalated'].includes(feedback) || !actorId) throw new Error('invalid_feedback')
      await sql.begin(async tx => {
        await tx`SELECT id FROM clinics WHERE id = ${clinicId} FOR UPDATE`
        const rows = await tx<Array<{ candidateId: string | null }>>`UPDATE knowledge_learning_events SET feedback = ${feedback}, feedback_by = ${actorId}, feedback_at = now()
          WHERE clinic_id = ${clinicId} AND id = ${eventId} AND expires_at > now() RETURNING candidate_id`
        if (!rows[0]) throw new Error('not_found')
        if (rows[0].candidateId) await tx`UPDATE knowledge_candidates SET patient_feedback = CASE WHEN patient_feedback IN ('corrected','escalated') THEN patient_feedback ELSE ${feedback} END, revision = revision + 1, updated_at = now()
          WHERE clinic_id = ${clinicId} AND id = ${rows[0].candidateId} AND status = 'pending_review'`
      })
    },
    async review(clinicId: string, id: string, input: LearningReview): Promise<{ candidate: GovernedCandidate; write: DocumentIndexWrite | null }> {
      return sql.begin(async tx => {
        await lockKnowledgeMutation(tx, clinicId)
        const rows = await tx<GovernedCandidate[]>`SELECT * FROM knowledge_candidates WHERE clinic_id = ${clinicId} AND id = ${id} FOR UPDATE`
        const candidate = rows[0]
        if (!candidate) throw new Error('not_found')
        // Approve retries return the committed publication, never create another document/version.
        if (input.action === 'approve' && candidate.status === 'approved' && candidate.revision === input.expectedRevision + 1) return { candidate, write: null }
        if (candidate.revision !== input.expectedRevision) throw new Error('stale_candidate')
        if (candidate.expiresAt && Date.parse(candidate.expiresAt) <= Date.now()) throw new Error('expired_candidate')
        if (!input.automatic && !input.actorId) throw new Error('reviewer_required')
        if (input.automatic && input.action !== 'approve') throw new Error('invalid_action')
        if (input.action !== 'rollback' && candidate.status !== 'pending_review' && !(input.action === 'edit' && candidate.status === 'approved')) throw new Error('invalid_state')
        let content = candidate.candidateContent
        let confirmed = candidate.staffConfirmed
        let rollbackSource: { historyId: string; candidateId: string; documentVersion: number } | undefined
        if (input.action === 'edit' || (input.action === 'approve' && input.content !== undefined && !input.automatic)) {
          if (!input.content?.trim()) throw new Error('content_required')
          const cleaned = sanitizeLearningText(input.content)
          if (cleaned.changed) throw new Error('remove_private_information')
          content = cleaned.text; confirmed = input.staffConfirmed === true
        }
        if (input.action === 'edit' && candidate.status === 'approved') {
          // Durable approval is immutable when drafting. A separately expiring
          // candidate owns all unapproved text/history, including abandoned edits.
          const fingerprint = learningFingerprint(`draft:${id}:${candidate.revision}:${content}`)
          const existing = await tx<GovernedCandidate[]>`SELECT * FROM knowledge_candidates WHERE clinic_id = ${clinicId} AND fingerprint = ${fingerprint}`
          if (existing[0]) return { candidate: existing[0], write: null }
          const configRows = await tx<LearningSettings[]>`SELECT auto_approve, grounding_threshold, evidence_retention_hours FROM knowledge_learning_settings WHERE clinic_id = ${clinicId}`
          const retention = configRows[0]?.evidenceRetentionHours ?? defaults.evidenceRetentionHours
          const risks = Array.isArray(candidate.evidence?.risks) ? candidate.evidence.risks : ['risk_unknown']
          const evidence = { ...candidate.evidence, grounding: 0, contradiction: 'unknown', risks: [...new Set([...risks, 'staff_correction'])] }
          const drafts = await tx<GovernedCandidate[]>`INSERT INTO knowledge_candidates
            (clinic_id, source_question, candidate_content, status, confidence_score, grounding_score,
             medical_safety_ok, prompt_safety_ok, contradiction_free, supporting_chunks, original_source,
             fingerprint, evidence, staff_confirmed, human_edit, previous_version_id,
             published_document_id, published_document_version, expires_at)
            VALUES (${clinicId}, '', ${content}, 'pending_review', 0, 0, false, false, false,
              ${tx.json(toJson(candidate.supportingChunks))}, ${tx.json(toJson({ source: 'approved_revision', candidateId: id }))},
              ${fingerprint}, ${tx.json(toJson(evidence))}, ${confirmed}, ${content}, ${id},
              ${candidate.publishedDocumentId}, ${candidate.publishedDocumentVersion}, now() + ${retention} * interval '1 hour') RETURNING *`
          const draft = drafts[0]!
          await tx`INSERT INTO knowledge_learning_history (clinic_id, candidate_id, revision, action, actor_id, content, citations, evidence)
            VALUES (${clinicId}, ${draft.id}, 1, 'edit', ${input.actorId}, ${content}, ${tx.json(toJson(candidate.supportingChunks))}, ${tx.json(toJson(evidence))})`
          return { candidate: draft, write: null }
        }
        if (input.action === 'rollback') {
          if (!input.historyId || input.staffConfirmed !== true || !candidate.publishedDocumentId) throw new Error('rollback_confirmation_required')
          const history = await tx<LearningHistory[]>`SELECT * FROM knowledge_learning_history
            WHERE clinic_id = ${clinicId} AND id = ${input.historyId}
              AND document_id = ${candidate.publishedDocumentId} AND action IN ('approve', 'rollback')`
          const snapshot = history[0]
          if (!snapshot || !['approve','rollback'].includes(snapshot.action) || snapshot.documentId !== candidate.publishedDocumentId
            || !Number.isInteger(snapshot.documentVersion) || Number(snapshot.documentVersion) < 1
            || Number(snapshot.documentVersion) > Number(candidate.publishedDocumentVersion)) throw new Error('not_found')
          // The current candidate owns the optimistic target version. It may
          // restore its own approved snapshot or an ancestor's, never a sibling
          // or arbitrary same-document candidate. The clinic lock protects this
          // walk; cycles/overlong or broken links fail closed.
          let ancestor: GovernedCandidate = candidate
          const visited = new Set([candidate.id])
          while (ancestor.id !== snapshot.candidateId) {
            const parentId = ancestor.previousVersionId
            if (!parentId || visited.has(parentId) || visited.size >= 100) throw new Error('not_found')
            const parents: GovernedCandidate[] = await tx<GovernedCandidate[]>`SELECT * FROM knowledge_candidates
              WHERE clinic_id = ${clinicId} AND id = ${parentId} AND published_document_id = ${candidate.publishedDocumentId}`
            const parent: GovernedCandidate | undefined = parents[0]
            if (!parent || parent.id !== parentId || parent.clinicId !== clinicId || parent.publishedDocumentId !== candidate.publishedDocumentId
              || !['approved','superseded'].includes(parent.status)) throw new Error('not_found')
            visited.add(parentId); ancestor = parent
          }
          rollbackSource = { historyId: snapshot.id, candidateId: snapshot.candidateId, documentVersion: snapshot.documentVersion! }
          content = snapshot.content; confirmed = true
        }
        const publishing = input.action === 'approve' || input.action === 'rollback'
        let write: DocumentIndexWrite | null = null
        if (publishing) {
          if (candidate.publishedDocumentId) {
            const target = await tx<Array<{ version: number }>>`SELECT * FROM knowledge_documents WHERE clinic_id = ${clinicId} AND id = ${candidate.publishedDocumentId} FOR UPDATE`
            if (!target[0] || target[0].version !== candidate.publishedDocumentVersion) throw new Error('stale_candidate')
          }
          const citations = candidate.supportingChunks as LearningCitation[]
          const current = await sourcesCurrent(tx, clinicId, citations, candidate.evidence)
          if ((citations.length > 0 || !confirmed) && !current) throw new Error('stale_sources')
          if (sanitizeLearningText(content).changed) throw new Error('remove_private_information')
          if (!officeHourFact(content) && !(confirmed && (input.content !== undefined || candidate.humanEdit || input.action === 'rollback'))) throw new Error('generalized_fact_review_required')
          if (input.automatic) {
            const configRows = await tx<LearningSettings[]>`SELECT auto_approve, grounding_threshold, evidence_retention_hours FROM knowledge_learning_settings WHERE clinic_id = ${clinicId} FOR SHARE`
            const config = configRows[0] ?? defaults
            if (automaticPublicationReasons(candidate, config, current).length) throw new Error('automatic_gates_failed')
            const consistency = await scopedConsistency(tx, clinicId, candidate.evidence)
            if (scopedOfficeHourConsistency(content, consistency.sources, consistency.complete) !== 'clear') throw new Error('automatic_gates_failed')
          }
          // Preserve source doctor/language scope. A learned answer must not widen a doctor's fact to the whole clinic.
          const scopes: Array<{ doctorId: string | null; language: string | null }> = []
          for (const citation of citations) {
            const docs = await tx<Array<{ metadata: Record<string, unknown> }>>`SELECT metadata FROM knowledge_documents WHERE clinic_id = ${clinicId} AND id = ${citation.documentId}`
            if (!docs[0]) throw new Error('stale_sources')
            const meta = docs[0].metadata ?? {}
            scopes.push({ doctorId: typeof meta['doctorId'] === 'string' ? meta['doctorId'] : null, language: typeof meta['language'] === 'string' ? meta['language'] : null })
          }
          if (new Set(scopes.map(s => JSON.stringify(s))).size > 1) throw new Error('mixed_source_scope')
          const scope = scopes[0] ?? { doctorId: null, language: null }
          write = await writeKnowledgeDocument(tx, { clinicId, id: candidate.publishedDocumentId ?? undefined, doctorId: scope.doctorId, title: 'Reviewed clinic knowledge', content, status: 'active', documentType: 'faq', metadata: { source: 'governed_learning', candidateId: id, approver: input.actorId ?? 'automatic', citations, rollbackSource: rollbackSource ?? null, ...(scope.language ? { language: scope.language } : {}) }, chunks: [{ content, chunkIndex: 0 }] })
          // Pending drafts are not durable facts. Keep their audit metadata only.
          await tx`UPDATE knowledge_learning_history SET content = '' WHERE clinic_id = ${clinicId} AND candidate_id = ${id} AND action NOT IN ('approve', 'rollback')`
        }
        // Our own authoritative write is the only scope change while the revision
        // lock is held. Carry that revision forward for subsequent staff edits or
        // rollback; audit history below still records the original evidence.
        const nextEvidence = write ? { ...candidate.evidence, retrievalRevision: write.retrievalRevision } : candidate.evidence
        const nextCitations = write ? (candidate.supportingChunks as LearningCitation[]).map(citation => ({ ...citation, retrievalRevision: write.retrievalRevision })) : candidate.supportingChunks
        const updated = await tx<GovernedCandidate[]>`UPDATE knowledge_candidates SET candidate_content = ${content},
          evidence = ${tx.json(toJson(nextEvidence))}, supporting_chunks = ${tx.json(toJson(nextCitations))},
          human_edit = ${publishing ? (confirmed ? content : null) : input.action === 'edit' ? content : candidate.humanEdit}, staff_confirmed = ${confirmed},
          grounding_score = CASE WHEN ${input.action === 'edit'} THEN 0 ELSE grounding_score END,
          contradiction_free = CASE WHEN ${input.action === 'edit'} THEN false ELSE contradiction_free END,
          status = ${publishing ? 'approved' : input.action === 'reject' ? 'rejected' : 'pending_review'}, revision = revision + 1,
          approved_by = ${publishing ? input.actorId : candidate.approvedBy}, approved_at = CASE WHEN ${publishing} THEN now() ELSE approved_at END,
          published_document_id = ${write?.document.id ?? candidate.publishedDocumentId}, published_document_version = ${write?.document.version ?? candidate.publishedDocumentVersion},
          source_question = CASE WHEN ${publishing} THEN '' ELSE source_question END,
          source_question_expires_at = CASE WHEN ${publishing} THEN now() ELSE source_question_expires_at END,
          expires_at = CASE WHEN ${publishing} THEN NULL ELSE expires_at END, updated_at = now()
          WHERE clinic_id = ${clinicId} AND id = ${id} RETURNING *`
        await tx`INSERT INTO knowledge_learning_history (clinic_id, candidate_id, revision, action, actor_id, content, citations, evidence, document_id, document_version)
          VALUES (${clinicId}, ${id}, ${candidate.revision + 1}, ${input.action}, ${input.actorId}, ${content}, ${tx.json(toJson(candidate.supportingChunks))}, ${tx.json(toJson({ ...candidate.evidence, patientFeedback: candidate.patientFeedback, consistencyCount: candidate.consistencyCount, staffConfirmed: confirmed, ...(rollbackSource ? { rollbackSource } : {}) }))}, ${write?.document.id ?? null}, ${write?.document.version ?? null})`
        return { candidate: updated[0]!, write }
      }) as unknown as Promise<{ candidate: GovernedCandidate; write: DocumentIndexWrite | null }>
    },
    async purgeExpired() {
      await sql`UPDATE knowledge_candidates SET source_question = '' WHERE source_question_expires_at <= now() AND source_question <> ''`
      const events = await sql`DELETE FROM knowledge_learning_events WHERE expires_at <= now() RETURNING id`
      const gaps = await sql`DELETE FROM knowledge_gaps WHERE expires_at <= now() RETURNING id`
      const candidates = await sql`DELETE FROM knowledge_candidates WHERE expires_at <= now() AND status IN ('pending_review', 'rejected') RETURNING id`
      return { events: events.length, gaps: gaps.length, candidates: candidates.length }
    },
  }
}
