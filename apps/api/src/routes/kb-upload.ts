// P18 (Gap #33): Document training — upload a clinic document (PDF / Word / text /
// FAQ), extract + chunk it, persist as a knowledge document, and enqueue each chunk
// for embedding.
//   POST /clinics/:id/kb/upload   (clinic_admin, ia_studio_admin) — multipart/form-data: file
import type { FastifyPluginAsync } from 'fastify'
import multipart from '@fastify/multipart'
import { createKnowledgeRepository } from '@docmee/db'
import { kbEmbedQueue } from '@docmee/queue'
import { trainDocument, detectFormat, needsOcr } from '@docmee/agents'
import { withDb } from '../lib/db.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { rateLimitGuard } from '../lib/rate-limit.js'
import { kbUploadObjectKey, uploadKbVaultObject } from '../lib/kb-vault-storage.js'

const MAX_FILE_BYTES = 50 * 1024 * 1024 // 50 MB

const kbUploadRoute: FastifyPluginAsync = async (app) => {
  // Multipart is encapsulated to this plugin (Fastify parsers are per-plugin), so it
  // never interferes with the JSON body parsing the rest of the API relies on.
  await app.register(multipart, { limits: { fileSize: MAX_FILE_BYTES } })
  app.addHook('preHandler', requireAuth)
  // CRE-56: embedding + storage is expensive — cap uploads per operator.
  app.addHook('preHandler', rateLimitGuard({ name: 'kb-upload', max: 20, windowMs: 60_000 }))

  app.post<{ Params: { id: string } }>(
    '/clinics/:id/kb/upload',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      const file = await request.file()
      if (!file) return reply.code(400).send({ error: 'No file uploaded' })

      let buffer: Buffer
      try {
        buffer = await file.toBuffer()
      } catch (err) {
        // @fastify/multipart throws RequestFileTooLargeError (413) once the file
        // exceeds MAX_FILE_BYTES. Surface a clear, actionable message to the panel.
        if ((err as { code?: string } | null)?.code === "FST_REQ_FILE_TOO_LARGE") {
          const maxMb = Math.round(MAX_FILE_BYTES / (1024 * 1024))
          return reply.code(413).send({ error: `File too large — the maximum is ${maxMb} MB` })
        }
        throw err
      }
      const format = detectFormat(file.filename, file.mimetype)
      const ocrUsed = needsOcr(format)

      let chunks
      try {
        chunks = await trainDocument({ buffer, format })
      } catch (err) {
        request.log.error({ err }, 'document training failed')
        return reply.code(422).send({ error: 'Could not extract text from the document' })
      }
      if (chunks.length === 0) return reply.code(422).send({ error: 'Document has no extractable content' })

      const { document, stored } = await withDb(async (sql) => {
        const repo = createKnowledgeRepository(sql)
        // Parsed/OCR'd documents land as `draft` so a human reviews the extracted
        // text before it is retrievable — the bot only ever searches `active`
        // documents (knowledge.repository listEmbeddedChunks filters d.status='active').
        // Chunks are still embedded immediately, so approval makes it instantly live.
        const doc = await repo.createDocument({
          clinicId,
          title: file.filename || 'Uploaded document',
          content: chunks.map((c) => c.content).join('\n\n'),
          documentType: 'custom',
          status: 'draft',
          metadata: { source: 'document', format, needsReview: true, ocr: ocrUsed },
        })
        const vaultKey = kbUploadObjectKey({
          clinicId,
          documentId: doc.id,
          fileName: file.filename || 'uploaded-document',
        })
        const vault = await uploadKbVaultObject({
          key: vaultKey,
          body: buffer,
          contentType: file.mimetype || 'application/octet-stream',
          metadata: {
            clinicId,
            documentId: doc.id,
            source: 'document',
          },
        }).catch((err) => {
          request.log.warn({ err, clinicId, documentId: doc.id }, 'kb vault upload skipped')
          return null
        })
        if (vault) {
          await sql`
            UPDATE knowledge_documents
            SET metadata = metadata || ${sql.json({
              vault: {
                provider: 's3',
                bucket: vault.bucket,
                key: vault.key,
                fileName: file.filename || 'uploaded-document',
                contentType: file.mimetype || 'application/octet-stream',
                storedAt: new Date().toISOString(),
              },
            })}::jsonb
            WHERE clinic_id = ${clinicId} AND id = ${doc.id}
          `
        }
        const rows = []
        for (const c of chunks) {
          rows.push(
            await repo.createChunk({
              documentId: doc.id,
              clinicId,
              content: c.content,
              chunkIndex: c.chunkIndex,
              metadata: { source: 'document', ...(c.question ? { question: c.question } : {}) },
            }),
          )
        }
        return { document: doc, stored: rows }
      })

      // Each chunk is embedded asynchronously (same job shape the kb-embed worker expects).
      for (const chunk of stored) {
        await kbEmbedQueue.add('embed', { chunkId: chunk.id, clinicId, content: chunk.content })
      }

      return reply
        .code(201)
        .send({ jobId: document.id, chunks: stored.length, status: 'draft', ocr: ocrUsed })
    },
  )
}

export default kbUploadRoute
