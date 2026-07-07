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
