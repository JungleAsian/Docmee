// Consumes: kb-embed queue. Embeds knowledge-base chunks and persists the vectors.
// Three job shapes (one processor, branch on job.name):
//   embed           { chunkId, clinicId, content }  → one chunk
//   embed-document  { clinicId, documentId }        → all chunks of a document
//   reembed-clinic  { clinicId }                    → every chunk of the clinic (re-index)
// Embeds with the clinic's chosen provider (clinic.settings.aiAssistant.embedProvider).
import { z } from 'zod'
import { type Job } from '@docmee/queue'
import { createServiceDbClient, toJson } from '@docmee/db'
import { resolveEmbedder } from './clinic-ai-key.js'

const ChunkJob = z.object({ chunkId: z.string(), clinicId: z.string(), content: z.string() })
const DocJob = z.object({ clinicId: z.string(), documentId: z.string() })
const ClinicJob = z.object({ clinicId: z.string() })

type Sql = ReturnType<typeof createServiceDbClient>

async function clinicSettings(sql: Sql, clinicId: string): Promise<unknown> {
  const rows = await sql<{ settings: unknown }[]>`SELECT settings FROM clinics WHERE id = ${clinicId}`
  return rows[0]?.settings ?? {}
}

async function storeEmbedding(
  sql: Sql,
  clinicId: string,
  chunkId: string,
  vector: number[],
): Promise<void> {
  await sql`
    UPDATE knowledge_chunks
    SET metadata = jsonb_set(COALESCE(metadata, '{}'), '{embedding}', ${sql.json(
      toJson({ v: vector }),
    )}::jsonb)
    WHERE id = ${chunkId} AND clinic_id = ${clinicId}
  `
}

export async function processKbEmbedJob(job: Job): Promise<void> {
  const sql = createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })
  try {
    if (job.name === 'reembed-clinic') {
      const { clinicId } = ClinicJob.parse(job.data)
      const embedder = resolveEmbedder(await clinicSettings(sql, clinicId))
      const chunks = await sql<{ id: string; content: string }[]>`
        SELECT id, content FROM knowledge_chunks WHERE clinic_id = ${clinicId}
      `
      for (const c of chunks) await storeEmbedding(sql, clinicId, c.id, await embedder(c.content))
      return
    }

    if (job.name === 'embed-document') {
      const { clinicId, documentId } = DocJob.parse(job.data)
      const embedder = resolveEmbedder(await clinicSettings(sql, clinicId))
      const chunks = await sql<{ id: string; content: string }[]>`
        SELECT id, content FROM knowledge_chunks
        WHERE clinic_id = ${clinicId} AND document_id = ${documentId}
      `
      for (const c of chunks) await storeEmbedding(sql, clinicId, c.id, await embedder(c.content))
      return
    }

    // Default: a single chunk ('embed').
    const data = ChunkJob.parse(job.data)
    const embedder = resolveEmbedder(await clinicSettings(sql, data.clinicId))
    await storeEmbedding(sql, data.clinicId, data.chunkId, await embedder(data.content))
  } finally {
    await sql.end()
  }
}
