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

const ChunkJob = z.object({
  chunkId: z.string(), clinicId: z.string(), content: z.string(),
  documentId: z.string().optional(), documentVersion: z.number().int().positive().optional(),
})
const DocJob = z.object({ clinicId: z.string(), documentId: z.string(), documentVersion: z.number().int().positive() })
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
  documentId?: string,
  documentVersion?: number,
): Promise<void> {
  await sql`
    UPDATE knowledge_chunks c
    SET metadata = jsonb_set(COALESCE(metadata, '{}'), '{embedding}', ${sql.json(toJson({ v: vector }))}::jsonb),
        embedding = ${vector.length === 1536 ? `[${vector.join(',')}]` : null}::vector,
        embedding_model = CASE WHEN ${vector.length === 1536} THEN 'docmee-1536' ELSE NULL END,
        embedded_at = CASE WHEN ${vector.length === 1536} THEN now() ELSE NULL END
    WHERE c.id = ${chunkId} AND c.clinic_id = ${clinicId} AND c.is_active = true
      AND (${documentId ?? null}::uuid IS NULL OR c.document_id = ${documentId ?? null})
      AND (${documentVersion ?? null}::int IS NULL OR c.document_version = ${documentVersion ?? null})
      AND EXISTS (
        SELECT 1 FROM knowledge_documents d
        WHERE d.id = c.document_id AND d.clinic_id = c.clinic_id
          AND d.version = c.document_version
          AND (${documentVersion ?? null}::int IS NULL OR d.version = ${documentVersion ?? null})
      )
  `
}

async function markDocumentReady(sql: Sql, clinicId: string, documentId: string, version: number): Promise<void> {
  await sql`
    UPDATE knowledge_documents d SET indexing_status = 'ready', indexing_error = NULL
    WHERE d.clinic_id = ${clinicId} AND d.id = ${documentId} AND d.version = ${version}
      AND d.status = 'active' AND d.approved_at IS NOT NULL
      AND d.effective_from <= now() AND (d.effective_until IS NULL OR d.effective_until > now())
      AND EXISTS (
        SELECT 1 FROM knowledge_chunks c
        WHERE c.clinic_id = d.clinic_id AND c.document_id = d.id
          AND c.document_version = d.version AND c.is_active = true
      )
      AND NOT EXISTS (
        SELECT 1 FROM knowledge_chunks c
        WHERE c.clinic_id = d.clinic_id AND c.document_id = d.id
          AND c.document_version = d.version AND c.is_active = true
          AND c.embedding IS NULL
          AND NOT COALESCE((c.metadata -> 'embedding') ? 'v', false)
      )
  `
}

export async function processKbEmbedJob(job: Job): Promise<void> {
  const sql = createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })
  let failureContext: { clinicId: string; documentId: string; documentVersion: number } | undefined
  try {
    if (job.name === 'reembed-clinic') {
      const { clinicId } = ClinicJob.parse(job.data)
      const embedder = resolveEmbedder(await clinicSettings(sql, clinicId))
      const chunks = await sql<{ id: string; content: string }[]>`
        SELECT c.id, c.content, c.document_id, c.document_version
        FROM knowledge_chunks c JOIN knowledge_documents d
          ON d.id = c.document_id AND d.clinic_id = c.clinic_id
        WHERE c.clinic_id = ${clinicId} AND c.is_active = true AND c.document_version = d.version
          AND d.status = 'active' AND d.approved_at IS NOT NULL
          AND d.effective_from <= now() AND (d.effective_until IS NULL OR d.effective_until > now())
      `
      for (const c of chunks as Array<{ id: string; content: string; documentId?: string; documentVersion?: number }>) {
        await storeEmbedding(sql, clinicId, c.id, await embedder(c.content), c.documentId, c.documentVersion)
      }
      return
    }

    if (job.name === 'embed-document') {
      const { clinicId, documentId, documentVersion } = DocJob.parse(job.data)
      failureContext = { clinicId, documentId, documentVersion }
      const embedder = resolveEmbedder(await clinicSettings(sql, clinicId))
      const chunks = await sql<{ id: string; content: string }[]>`
        SELECT id, content FROM knowledge_chunks
        WHERE clinic_id = ${clinicId} AND document_id = ${documentId}
          AND document_version = ${documentVersion} AND is_active = true
      `
      for (const c of chunks) await storeEmbedding(sql, clinicId, c.id, await embedder(c.content), documentId, documentVersion)
      await markDocumentReady(sql, clinicId, documentId, documentVersion)
      return
    }

    // Default: a single chunk ('embed').
    const data = ChunkJob.parse(job.data)
    if (data.documentId && data.documentVersion) {
      failureContext = { clinicId: data.clinicId, documentId: data.documentId, documentVersion: data.documentVersion }
    }
    const embedder = resolveEmbedder(await clinicSettings(sql, data.clinicId))
    await storeEmbedding(sql, data.clinicId, data.chunkId, await embedder(data.content), data.documentId, data.documentVersion)
  } catch (err) {
    if (failureContext) {
      await sql`
        UPDATE knowledge_documents
        SET indexing_status = 'failed', indexing_error = 'embedding_failed'
        WHERE clinic_id = ${failureContext.clinicId} AND id = ${failureContext.documentId}
          AND version = ${failureContext.documentVersion}
      `
    }
    throw err
  } finally {
    await sql.end()
  }
}
