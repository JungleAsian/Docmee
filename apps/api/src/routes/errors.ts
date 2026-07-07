// Error-review routes (P09 — Admin Studio "Error Review" over bot_error_log/error_reviews).
//   GET  /clinics/:id/errors                     (clinic_admin, ia_studio_admin) — status + date filters (Req 36)
//   GET  /clinics/:id/errors/export.csv          (clinic_admin, ia_studio_admin) — CSV export (Req 36)
//   POST /clinics/:id/errors/batch-resolve       (clinic_admin, ia_studio_admin) — batch resolve (Req 36)
//   POST /clinics/:id/errors/:errorId/resolve    (clinic_admin, ia_studio_admin)
//   POST /clinics/:id/errors/:errorId/add-to-kb  (clinic_admin, ia_studio_admin) — Req 29
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { createErrorReviewsRepository, createKnowledgeRepository } from '@docmee/db'
import type { ErrorReview, ErrorReviewFilters } from '@docmee/db'
import { kbEmbedQueue } from '@docmee/queue'
import { withDb } from '../lib/db.js'
import { validate } from '../lib/validate.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const STATUS_VALUES = ['open', 'reviewed', 'resolved', 'ignored'] as const
// `from`/`to` are date-only (YYYY-MM-DD) or full ISO timestamps; the repo compares
// against created_at, so a bare date upper bound is widened to end-of-day here.
const dateBound = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}([T ].*)?$/, 'Expected YYYY-MM-DD or ISO timestamp')
  .optional()
const listQuerySchema = z.object({
  status: z.enum(STATUS_VALUES).optional(),
  from: dateBound,
  to: dateBound,
})
const addToKbSchema = z.object({ title: z.string().min(1), content: z.string().min(1) })
const batchResolveSchema = z.object({ ids: z.array(z.string().min(1)).min(1) })

// A bare YYYY-MM-DD `to` filter means "the whole of that day": widen it to 23:59:59.
function normalizeFilters(q: z.infer<typeof listQuerySchema>): ErrorReviewFilters {
  const to = q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? `${q.to}T23:59:59.999` : q.to
  return { status: q.status, from: q.from, to }
}

// RFC-4180 CSV field: wrap in quotes and double any embedded quotes when the value
// contains a comma, quote, or newline.
function csvCell(value: unknown): string {
  const s = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const errorsRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get<{ Params: { id: string } }>(
    '/clinics/:id/errors',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(listQuerySchema, request.query, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const errors = await withDb(async (sql) =>
        createErrorReviewsRepository(sql).listByClinic(clinicId, normalizeFilters(parsed.data)),
      )
      return { errors }
    },
  )

  // CSV export (Req 36): same status + date filters as the list, streamed as a
  // downloadable file so operators can audit/triage errors outside the panel.
  app.get<{ Params: { id: string } }>(
    '/clinics/:id/errors/export.csv',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(listQuerySchema, request.query, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const errors = await withDb(async (sql) =>
        createErrorReviewsRepository(sql).listByClinic(clinicId, normalizeFilters(parsed.data)),
      )
      const header = [
        'id',
        'created_at',
        'status',
        'error_type',
        'error_message',
        'reviewed_by',
        'resolved_at',
        'context',
      ]
      const rows = errors.map((e: ErrorReview) =>
        [
          e.id,
          e.createdAt,
          e.status,
          e.errorType,
          e.errorMessage,
          e.reviewedBy,
          e.resolvedAt,
          e.context,
        ]
          .map(csvCell)
          .join(','),
      )
      const csv = [header.join(','), ...rows].join('\r\n')
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="error-reviews-${clinicId}.csv"`)
        .send(csv)
    },
  )

  // Batch resolve (Req 36): resolve many reviews in one action from the list view.
  app.post<{ Params: { id: string } }>(
    '/clinics/:id/errors/batch-resolve',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(batchResolveSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const errors = await withDb(async (sql) =>
        createErrorReviewsRepository(sql).resolveMany(clinicId, parsed.data.ids, request.user!.userId),
      )
      return { errors, resolved: errors.length }
    },
  )

  app.post<{ Params: { id: string; errorId: string } }>(
    '/clinics/:id/errors/:errorId/resolve',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const error = await withDb(async (sql) =>
        createErrorReviewsRepository(sql).resolve(clinicId, request.params.errorId, request.user!.userId),
      )
      if (!error) return reply.code(404).send({ error: 'Error review not found' })
      return { error }
    },
  )

  // Add-to-KB (Req 29): turn a reviewed error — typically an unanswered question
  // or a bad bot response — into approved clinic knowledge. Creates a KB document,
  // enqueues embedding so the bot can retrieve it, and resolves the error in one
  // step so the operator's review action is atomic from the UI's perspective.
  app.post<{ Params: { id: string; errorId: string } }>(
    '/clinics/:id/errors/:errorId/add-to-kb',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(addToKbSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      const result = await withDb(async (sql) => {
        const errors = createErrorReviewsRepository(sql)
        const existing = await errors.findById(clinicId, request.params.errorId)
        if (!existing) return null
        const document = await createKnowledgeRepository(sql).createDocument({
          clinicId,
          title: parsed.data.title,
          content: parsed.data.content,
          documentType: 'faq',
          status: 'active',
          metadata: { source: 'error_review', errorReviewId: existing.id },
        })
        const error = await errors.resolve(clinicId, existing.id, request.user!.userId)
        return { document, error }
      })
      if (!result) return reply.code(404).send({ error: 'Error review not found' })
      // New content must be embedded before the bot can retrieve it.
      await kbEmbedQueue.add('embed-document', { clinicId, documentId: result.document.id })
      return reply.code(201).send(result)
    },
  )
}

export default errorsRoute
