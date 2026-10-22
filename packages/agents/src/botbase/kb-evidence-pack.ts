import { createHash } from 'node:crypto'
import type { KnowledgeRepository, KnowledgeSearchRow, LearningCitation } from '@docmee/db'
import { createKbRetrievalCache, kbRetrievalCacheKey } from './kb-retrieval-cache.js'
import { planKbQuery, type KbQueryPlan } from './kb-query-plan.js'
import { fuseKbCandidates } from './kb-retriever.js'
import type { createLayaAdapter } from '../laya/adapter.js'

type RetrievalKnowledge = Pick<KnowledgeRepository, 'getClinicRetrievalRevision' | 'searchChunks'>
  & Partial<Pick<KnowledgeRepository, 'recordRetrievalMetric'>>

export interface KbEvidenceCitation extends LearningCitation {
  title: string
  source: string | null
}

export interface KbEvidencePack {
  plan: KbQueryPlan
  revision: number
  matches: Array<KnowledgeSearchRow & { similarity: number }>
  citations: KbEvidenceCitation[]
  context: string
  mode: 'embedded' | 'keyword' | 'none'
  cacheHit: boolean
  latencyMs: number
  status: 'ready' | 'insufficient_evidence' | 'conflicting_sources' | 'stale_sources'
}

export interface RetrieveKbEvidenceInput {
  clinicId: string
  question: string
  language?: 'en' | 'es'
  doctorId?: string | null
  knowledge: RetrievalKnowledge
  embed: (query: string) => Promise<number[]>
  limit?: number
  /** Clinic-selected vector-confidence floor. Values are clamped fail-closed. */
  minVectorScore?: number
  sourcesCurrent?: (citations: KbEvidenceCitation[], revision: number,
    scope: Pick<KbQueryPlan, 'doctorId' | 'language'>) => Promise<boolean>
  /** Server-owned optional dependency. Never populate from a client request. */
  layaAdapter?: ReturnType<typeof createLayaAdapter>
}

const sharedCache = createKbRetrievalCache<{ rows: KnowledgeSearchRow[]; mode: 'embedded' | 'keyword' }>({
  ttlMs: 30_000,
  maxEntries: 500,
})

export function clearSharedKbEvidenceCache(): void {
  sharedCache.clear()
}

function hashQuery(query: string): string {
  return createHash('sha256').update(query, 'utf8').digest('hex')
}

function buildPack(plan: KbQueryPlan, revision: number, rows: KnowledgeSearchRow[], mode: 'embedded' | 'keyword', cacheHit: boolean, latencyMs: number, limit: number, minVectorScore: number): KbEvidencePack {
  const matches = fuseKbCandidates(rows.map(row => ({ ...row, similarity: 0 })), plan, limit, minVectorScore)
  return {
    plan,
    revision,
    matches,
    citations: matches.map(match => ({
      chunkId: match.chunkId,
      documentId: match.documentId,
      documentVersion: match.documentVersion,
      doctorId: match.doctorId ?? null,
      language: match.language ?? null,
      retrievalRevision: match.retrievalRevision,
      governanceReviewState: typeof match.provenance?.['governanceReviewState'] === 'string' ? match.provenance['governanceReviewState'] : 'trusted',
      title: match.title,
      source: match.source ?? null,
    })),
    context: matches.map(match => `[${match.title}]\n${match.content}`).join('\n\n'),
    mode: matches.length ? mode : 'none',
    cacheHit,
    latencyMs,
    status: rows.some(row => row.conflictState === 'conflicting')
      ? 'conflicting_sources'
      : matches.length ? 'ready' : 'insufficient_evidence',
  }
}

async function validateCurrentness(input: RetrieveKbEvidenceInput, pack: KbEvidencePack): Promise<KbEvidencePack> {
  if (pack.status !== 'ready' || !input.sourcesCurrent || pack.citations.length === 0) return pack
  return await input.sourcesCurrent(pack.citations, pack.revision,
    { doctorId: pack.plan.doctorId, language: pack.plan.language }) ? pack : { ...pack, status: 'stale_sources' }
}

/** This proof must be bound to authenticated clinic/doctor/language scope by the caller.
 * Search rows have no clinic ID: row metadata alone cannot prove tenant authorization. */
async function finalizePack(input: RetrieveKbEvidenceInput, pack: KbEvidencePack): Promise<KbEvidencePack> {
  if (!input.layaAdapter) return validateCurrentness(input, pack)
  if (pack.status !== 'ready' || !input.sourcesCurrent) return pack
  const mode = await input.layaAdapter.taskMode(input.clinicId, 'kb_relevance')
  // Unavailable optional controls must not invalidate otherwise current baseline evidence.
  // No passage is disclosed to LAYA on this path; the ordinary source proof still applies.
  if (mode === 'disabled' || mode === null) return validateCurrentness(input, pack)
  // Detach cache/repository objects before crossing asynchronous trust boundaries.
  pack = structuredClone(pack)
  const adapter = input.layaAdapter
  const proof = input.sourcesCurrent
  async function current(): Promise<boolean> {
    try {
      return await adapter.runDependency(() => proof(structuredClone(pack.citations), pack.revision,
        { doctorId: pack.plan.doctorId, language: pack.plan.language })) === true
    } catch { return false }
  }
  if (!await current()) return { ...pack, status: 'stale_sources' }
  const eligible = (): boolean => pack.matches.every(match => {
    const governance = match.provenance?.['governanceReviewState'] ?? 'trusted'
    const now = Date.now()
    return (match.doctorId === null || match.doctorId === pack.plan.doctorId)
      && (match.language === null || match.language === pack.plan.language)
      && governance === 'trusted' && match.retrievalRevision === pack.revision
      && Number.isInteger(match.documentVersion) && match.documentVersion > 0
      && (!match.conflictState || match.conflictState === 'clear')
      && (match.effectiveFrom === undefined || Date.parse(match.effectiveFrom) <= now)
      && (match.effectiveUntil == null || Date.parse(match.effectiveUntil) > now)
  })
  if (!eligible()) return { ...pack, status: 'stale_sources' }
  const result = await adapter.assess({ clinicId: input.clinicId, task: 'kb_relevance',
    language: pack.plan.language, text: input.question,
    candidates: pack.matches.map((match, index) => ({ id: `evidence-${index + 1}`, label: `[${match.title}]\n${match.content}` })) })
  // A revoked/expired source must not become usable because ranking failed or stayed observational.
  if (!await current() || !eligible()) return { ...pack, status: 'stale_sources' }
  if (!result.apply || result.outcome !== 'suggestion') return pack
  const chosen = pack.matches.findIndex((_match, index) => result.choiceId === `evidence-${index + 1}`)
  if (chosen <= 0) return pack
  const order = [chosen, ...pack.matches.map((_match, index) => index).filter(index => index !== chosen)]
  const matches = order.map(index => pack.matches[index]!)
  return { ...pack, matches, citations: order.map(index => pack.citations[index]!),
    context: matches.map(match => `[${match.title}]\n${match.content}`).join('\n\n') }
}

async function recordMetric(input: RetrieveKbEvidenceInput, pack: KbEvidencePack): Promise<void> {
  if (!input.knowledge.recordRetrievalMetric) return
  try {
    await input.knowledge.recordRetrievalMetric({
      clinicId: input.clinicId,
      queryHash: hashQuery(pack.plan.normalizedQuery),
      intent: pack.plan.intent,
      resultCount: pack.matches.length,
      latencyMs: pack.latencyMs,
      cacheHit: pack.cacheHit,
      outcome: pack.status === 'ready' ? 'answered' : pack.status === 'insufficient_evidence' ? 'no_evidence' : 'handoff',
    })
  } catch {
    // Metrics are deliberately best-effort and must never block patient routing.
  }
}

/** One governed retrieval contract for J.zel, workflow AI agents, and previews.
 * Cache entries are clinic/scope/revision bound; only hashes reach metrics. */
export async function retrieveKbEvidence(input: RetrieveKbEvidenceInput): Promise<KbEvidencePack> {
  input = { ...input }
  const startedAt = performance.now()
  const plan = planKbQuery(input.question, { language: input.language, doctorId: input.doctorId })
  const revision = await input.knowledge.getClinicRetrievalRevision(input.clinicId)
  const key = kbRetrievalCacheKey({
    clinicId: input.clinicId,
    revision,
    normalizedQuery: plan.normalizedQuery,
    language: plan.language,
    doctorId: plan.doctorId,
    intent: plan.intent,
  })
  const limit = Math.max(1, Math.min(input.limit ?? 5, 5))
  const minVectorScore = Math.min(1, Math.max(0.6, input.minVectorScore ?? 0.78))
  const cached = sharedCache.get(key)
  if (cached) {
    const pack = await finalizePack(input, buildPack(plan, revision, cached.rows, cached.mode, true, Math.max(0, Math.round(performance.now() - startedAt)), limit, minVectorScore))
    await recordMetric(input, pack)
    return pack
  }

  let embedding: number[] = []
  let mode: 'embedded' | 'keyword' = 'embedded'
  try {
    embedding = await input.embed(plan.normalizedQuery)
  } catch {
    mode = 'keyword'
  }
  const rows = await input.knowledge.searchChunks(plan.expandedQuery, embedding, {
    clinicId: input.clinicId,
    language: plan.language,
    doctorId: plan.doctorId ?? undefined,
  }, 40)
  sharedCache.set(key, { rows, mode })
  const pack = await finalizePack(input, buildPack(plan, revision, rows, mode, false, Math.max(0, Math.round(performance.now() - startedAt)), limit, minVectorScore))
  await recordMetric(input, pack)
  return pack
}
