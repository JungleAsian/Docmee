import { createHash } from 'node:crypto'
import type { KnowledgeRepository, KnowledgeSearchRow, LearningCitation } from '@docmee/db'
import { createKbRetrievalCache, kbRetrievalCacheKey } from './kb-retrieval-cache.js'
import { planKbQuery, type KbQueryPlan } from './kb-query-plan.js'
import { fuseKbCandidates } from './kb-retriever.js'

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
  sourcesCurrent?: (citations: KbEvidenceCitation[], revision: number) => Promise<boolean>
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

function buildPack(plan: KbQueryPlan, revision: number, rows: KnowledgeSearchRow[], mode: 'embedded' | 'keyword', cacheHit: boolean, latencyMs: number, limit: number): KbEvidencePack {
  const matches = fuseKbCandidates(rows.map(row => ({ ...row, similarity: 0 })), plan, limit)
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
  return await input.sourcesCurrent(pack.citations, pack.revision) ? pack : { ...pack, status: 'stale_sources' }
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
  const cached = sharedCache.get(key)
  if (cached) {
    const pack = await validateCurrentness(input, buildPack(plan, revision, cached.rows, cached.mode, true, Math.max(0, Math.round(performance.now() - startedAt)), limit))
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
  const pack = await validateCurrentness(input, buildPack(plan, revision, rows, mode, false, Math.max(0, Math.round(performance.now() - startedAt)), limit))
  await recordMetric(input, pack)
  return pack
}
