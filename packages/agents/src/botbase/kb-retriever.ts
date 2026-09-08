// Knowledge-base retrieval for the clinic bot.
//
// Embeddings live in knowledge_chunks.metadata.embedding.v (jsonb) rather than a
// pgvector column (see P02 migration — vector extension is optional), so ranking
// is done in-process with cosine similarity over the clinic's chunk set. The
// caller loads the chunks (DB I/O stays in the worker/repository layer) and
// injects the embedder, so this module stays free of provider dependencies.

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
}

/** Final deterministic reranker for pgvector/FTS candidates. Newer approved
 * versions win ties, while weak candidates remain excluded for fail-closed use. */
export function rerankHybridChunks(candidates: HybridKbCandidate[], limit = 5): KbMatch[] {
  return candidates
    .map((candidate) => ({
      ...candidate,
      similarity: 0.7 * candidate.vectorScore + 0.2 * Math.min(candidate.lexicalScore, 1) +
        0.1 * Math.min(Math.max(candidate.documentVersion ?? 1, 1), 100) / 100,
    }))
    .filter((candidate) => candidate.vectorScore >= 0.78 || candidate.lexicalScore > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
    .map(({ title, content, similarity }) => ({ title, content, similarity }))
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
