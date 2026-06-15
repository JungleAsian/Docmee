import type { ClinicTx } from "../types.js";

export type KbType = "manual" | "document_chunk" | "rule";

export interface NewKbEntry {
  type: KbType;
  title?: string;
  content: string;
  embedding?: number[];
  source?: string;
  /** Doctor-scoped entry; null/undefined = clinic-wide (Phase 3A). */
  doctorId?: string;
}

export interface KbRetrieval {
  id: string;
  content: string;
  similarity: number;
}

/** The grounding threshold (architecture §4): below this, the bot does NOT answer. */
export const RETRIEVAL_THRESHOLD = 0.7;

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

export async function createKbEntry(
  tx: ClinicTx,
  e: NewKbEntry,
): Promise<{ id: string }> {
  const embeddingSql = e.embedding ? "$5::vector" : "NULL";
  const tailParams = e.embedding
    ? [toVectorLiteral(e.embedding), e.source ?? null, e.doctorId ?? null]
    : [e.source ?? null, e.doctorId ?? null];
  const sourceIdx = e.embedding ? 6 : 5;
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO kb_entries (clinic_id, type, title, content, embedding, source, doctor_id)
     VALUES ($1, $2, $3, $4, ${embeddingSql}, $${sourceIdx}, $${sourceIdx + 1})
     RETURNING id`,
    [tx.clinicId, e.type, e.title ?? null, e.content, ...tailParams],
  );
  return rows[0]!;
}

/** The "rules" KB category — injected into every prompt in full. */
export async function getRules(tx: ClinicTx): Promise<string[]> {
  const { rows } = await tx.query<{ content: string }>(
    `SELECT content FROM kb_entries WHERE type = 'rule' ORDER BY created_at`,
  );
  return rows.map((r) => r.content);
}

/**
 * Cosine-similarity retrieval over embeddable KB entries. Returns only entries at
 * or above `threshold` (default 0.70). Below threshold → caller must NOT fall back
 * to general LLM knowledge; it acknowledges the gap and offers handoff.
 */
export async function retrieve(
  tx: ClinicTx,
  queryEmbedding: number[],
  opts: { k?: number; threshold?: number; doctorId?: string } = {},
): Promise<KbRetrieval[]> {
  const k = opts.k ?? 5;
  const threshold = opts.threshold ?? RETRIEVAL_THRESHOLD;
  // Doctor-scoped retrieval: that doctor's entries + clinic-wide (doctor_id NULL).
  const doctorClause = opts.doctorId ? "AND (doctor_id = $3 OR doctor_id IS NULL)" : "";
  const params: unknown[] = [toVectorLiteral(queryEmbedding), k];
  if (opts.doctorId) params.push(opts.doctorId);
  const { rows } = await tx.query<{ id: string; content: string; similarity: number }>(
    `SELECT id, content, 1 - (embedding <=> $1::vector) AS similarity
     FROM kb_entries
     WHERE type <> 'rule' AND embedding IS NOT NULL ${doctorClause}
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    params,
  );
  return rows
    .map((r) => ({ id: r.id, content: r.content, similarity: Number(r.similarity) }))
    .filter((r) => r.similarity >= threshold);
}
