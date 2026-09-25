// Knowledge-base retrieval for the clinic bot.
//
// Runtime callers retrieve bounded, current, clinic-scoped PostgreSQL candidates.
// Legacy pure cosine helpers remain for compatibility; runtime retrieval does
// not load every clinic chunk. This module is provider-independent.

/** Embeds query text into a vector — injected (e.g. @docmee/llm's embedText). */
export type Embedder = (text: string) => Promise<number[]>

export interface EmbeddedChunk {
  title: string
  content: string
  embedding: number[]
  /** When set, the chunk belongs to a doctor-scoped document (Req 30 per-doctor
   *  FAQs) and is only retrievable when the patient asks about that doctor. */
  doctorId?: string | null
}

export interface KbMatch {
  title: string
  content: string
  similarity: number
}

export interface HybridKbCandidate extends KbMatch {
  vectorScore: number
  lexicalScore: number
  documentVersion?: number
  updatedAt?: string
  semanticRank?: number
  lexicalRank?: number
  authority?: 'clinic' | 'doctor' | 'system'
  language?: string | null
  doctorId?: string | null
  canonicalFactKey?: string | null
  contentHash?: string | null
  conflictState?: 'clear' | 'conflicting' | 'superseded' | null
}

export interface KbFusionPlan {
  language?: string | null
  doctorId?: string | null
  timeSensitive?: boolean
}

/** Reciprocal-rank fusion keeps lexical exact matches and semantic matches in
 * one deterministic order. Conflicting/superseded evidence is fail-closed and
 * byte-identical facts are collapsed before the answer model sees them. */
export function fuseKbCandidates<T extends HybridKbCandidate>(
  candidates: T[],
  plan: KbFusionPlan = {},
  limit = 5,
  minVectorScore = 0.78,
): T[] {
  const eligible = candidates.filter(candidate =>
    Number.isFinite(candidate.vectorScore) && Number.isFinite(candidate.lexicalScore) &&
    (candidate.vectorScore >= minVectorScore || candidate.lexicalScore > 0) &&
    candidate.conflictState !== 'conflicting' && candidate.conflictState !== 'superseded',
  )
  const semanticOrder = [...eligible].sort((a, b) => b.vectorScore - a.vectorScore)
  const lexicalOrder = [...eligible].sort((a, b) => b.lexicalScore - a.lexicalScore)
  const scored = eligible.map((candidate) => {
    const semanticRank = candidate.semanticRank ?? semanticOrder.indexOf(candidate) + 1
    const lexicalRank = candidate.lexicalRank ?? lexicalOrder.indexOf(candidate) + 1
    const languageBoost = plan.language && candidate.language === plan.language ? 0.002 : 0
    const doctorBoost = plan.doctorId && candidate.doctorId === plan.doctorId ? 0.003 : 0
    const authorityBoost = candidate.authority === 'doctor' && plan.doctorId ? 0.002 : candidate.authority === 'clinic' ? 0.001 : 0
    const freshnessBoost = plan.timeSensitive ? Math.min(Math.max(candidate.documentVersion ?? 1, 1), 100) / 100_000 : 0
    return { candidate, score: 1 / (60 + semanticRank) + 1 / (60 + lexicalRank) + languageBoost + doctorBoost + authorityBoost + freshnessBoost }
  }).sort((a, b) => b.score - a.score || (Date.parse(b.candidate.updatedAt ?? '') || 0) - (Date.parse(a.candidate.updatedAt ?? '') || 0))

  const seen = new Set<string>()
  const result: T[] = []
  for (const { candidate, score } of scored) {
    const key = candidate.contentHash || `${candidate.title.trim().toLocaleLowerCase()}\u0000${candidate.content.trim().toLocaleLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ ...candidate, similarity: score })
    if (result.length >= Math.max(1, Math.min(limit, 5))) break
  }
  return result
}

/** Final deterministic reranker for pgvector/FTS candidates. Newer approved
 * versions win ties, while weak candidates remain excluded for fail-closed use. */
export function rerankHybridChunks<T extends HybridKbCandidate>(candidates: T[], limit = 5): T[] {
  return candidates
    .filter(candidate => Number.isFinite(candidate.vectorScore) && Number.isFinite(candidate.lexicalScore))
    .map((candidate) => ({
      ...candidate,
      similarity: 0.7 * Math.min(1, Math.max(0, candidate.vectorScore)) + 0.2 * Math.min(Math.max(0, candidate.lexicalScore), 1) +
        0.1 * Math.min(Math.max(candidate.documentVersion ?? 1, 1), 100) / 100,
    }))
    .filter((candidate) => candidate.vectorScore >= 0.78 || candidate.lexicalScore > 0)
    .sort((a, b) => b.similarity - a.similarity || (Date.parse(b.updatedAt ?? '') || 0) - (Date.parse(a.updatedAt ?? '') || 0))
    .slice(0, Math.max(1, Math.min(limit, 5)))
}

/** Small audited clinic vocabulary; expansion is retrieval-only, never evidence. */
export function expandKbQuery(query: string): string {
  const words = query.slice(0, 1600).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[\p{L}\p{N}]+/gu) ?? []
  const groups = [ ['hours', 'horario', 'horarios', 'open', 'opening', 'abierto'], ['appointment', 'booking', 'cita', 'reservar', 'agendar'],
    ['address', 'location', 'direccion', 'ubicacion'], ['price', 'cost', 'precio', 'costo'], ['doctor', 'medico', 'doctora'], ['acne', 'pimples', 'espinillas'] ]
  const result = new Set(words)
  for (const group of groups) if (words.some((word) => group.some((term) => word === term || word.length >= 5 && levenshteinAtMostOne(word, term)))) for (const term of group) result.add(term)
  // websearch_to_tsquery otherwise ANDs every translated alternative together.
  // Tokens are sanitized above; user-supplied query operators are never preserved.
  const stop = new Set(['a','al','and','de','del','el','en','es','for','from','la','las','los','of','que','the','un','una','y','is','what','when'])
  return [...result].filter(term => !stop.has(term)).slice(0, 100).join(' OR ').slice(0, 2000)
}

/** Deterministic fallback for active chunks that are not indexed yet. This is
 * intentionally conservative: only chunks sharing meaningful query terms are
 * returned, so an indexing delay never turns into an invented answer. */
export function rankKeywordChunks(
  query: string,
  chunks: Array<Pick<EmbeddedChunk, 'title' | 'content'>>,
  limit = 5,
): KbMatch[] {
  const stop = new Set(['a', 'al', 'and', 'de', 'del', 'el', 'en', 'es', 'for', 'from', 'la', 'las', 'los', 'of', 'que', 'the', 'un', 'una', 'y'])
  const terms = query.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[\p{L}\p{N}]{3,}/gu)?.filter((term) => !stop.has(term)) ?? []
  if (terms.length === 0) return []
  return chunks
    .map((chunk) => {
      const haystack = `${chunk.title} ${chunk.content}`.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      const haystackTerms = haystack.match(/[\p{L}\p{N}]{3,}/gu) ?? []
      const hits = terms.filter((term) => haystack.includes(term) || haystackTerms.some((candidate) =>
        term.length >= 4 && candidate.length >= 4 && levenshteinAtMostOne(term, candidate),
      )).length
      return { title: chunk.title, content: chunk.content, similarity: hits / terms.length }
    })
    .filter((match) => match.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
}

function levenshteinAtMostOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let edits = 0
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue }
    edits += 1
    if (edits > 1) return false
    if (a.length > b.length) i += 1
    else if (b.length > a.length) j += 1
    else { i += 1; j += 1 }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    dot += x * y
    normA += x * x
    normB += y * y
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/** Rank pre-loaded chunks against an already-computed query embedding. */
export function rankChunks(
  queryEmbedding: number[],
  chunks: EmbeddedChunk[],
  threshold = 0.78,
  limit = 5,
): KbMatch[] {
  return chunks
    .map((c) => ({
      title: c.title,
      content: c.content,
      similarity: cosineSimilarity(queryEmbedding, c.embedding),
    }))
    .filter((m) => m.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
}

/** Embed `query` and return the best-matching clinic KB chunks above `threshold`. */
export async function searchKb(
  query: string,
  chunks: EmbeddedChunk[],
  embed: Embedder,
  threshold = 0.78,
  limit = 5,
): Promise<KbMatch[]> {
  if (chunks.length === 0) return []
  const embedding = await embed(query)
  return rankChunks(embedding, chunks, threshold, limit)
}
