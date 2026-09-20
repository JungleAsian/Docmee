import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { createKnowledgeLearningRepository, createKnowledgeRepository, rejectionReasons } from '@docmee/db'
import { kbEmbedQueue } from '@docmee/queue'
import { withDb } from '../lib/db.js'
import { validate } from '../lib/validate.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const settingsSchema = z.object({ autoApprove: z.boolean(), groundingThreshold: z.number().min(.8).max(1), evidenceRetentionHours: z.number().int().min(1).max(24) }).strict()
const reviewSchema = z.object({
  action: z.enum(['edit','reject','approve','rollback']), expectedRevision: z.number().int().positive(), content: z.string().trim().min(1).max(12000).optional(),
  staffConfirmed: z.boolean().optional(), historyId: z.string().uuid().optional(), rejectionReason: z.enum(rejectionReasons).optional(), rejectionDetail: z.string().trim().min(1).max(1000).optional(),
}).strict().superRefine((value, context) => {
  if (value.action === 'approve' && value.staffConfirmed !== true) context.addIssue({ code: z.ZodIssueCode.custom, path: ['staffConfirmed'], message: 'staff_confirmation_required' })
  if (value.action === 'reject' && !value.rejectionReason) context.addIssue({ code: z.ZodIssueCode.custom, path: ['rejectionReason'], message: 'rejection_reason_required' })
  if (value.action === 'reject' && value.rejectionReason === 'other' && !value.rejectionDetail) context.addIssue({ code: z.ZodIssueCode.custom, path: ['rejectionDetail'], message: 'rejection_detail_required' })
})
const feedbackSchema = z.object({ feedback: z.enum(['accepted','corrected','escalated']) }).strict()
const correctionSchema = z.object({ content: z.string().trim().min(1).max(12000), staffConfirmed: z.literal(true) }).strict()

const route: FastifyPluginAsync = async app => {
  app.addHook('preHandler', requireAuth)
  app.addHook('preHandler', requireRole('clinic_admin', 'ia_studio_admin'))
  app.addHook('preHandler', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!resolveClinicScope(request, id)) return reply.code(403).send({ error: 'Forbidden' })
  })
  app.setErrorHandler((error, _request, reply) => {
    const code = error.message
    if (code === 'not_found') return reply.code(404).send({ error: code })
    if (['stale_candidate','stale_sources','expired_candidate','invalid_state','automatic_gates_failed','mixed_source_scope'].includes(code)) return reply.code(409).send({ error: code })
    if (['content_required','remove_private_information','rollback_confirmation_required','staff_confirmation_required','rejection_reason_required','rejection_detail_required','invalid_settings','generalized_fact_review_required'].includes(code)) return reply.code(400).send({ error: code })
    return reply.code(500).send({ error: 'learning_operation_failed' })
  })
  const base = '/clinics/:id/kb/learning'
  app.get<{ Params: { id: string }; Querystring: { status?: string } }>(`${base}/candidates`, async (request, reply) => {
    const status = request.query.status ?? 'pending_review'
    if (!['pending_review','approved','rejected','superseded'].includes(status)) return reply.code(400).send({ error: 'invalid_status' })
    return withDb(sql => createKnowledgeLearningRepository(sql).list(request.params.id, status))
  })
  app.get<{ Params: { id: string } }>(`${base}/settings`, request => withDb(sql => createKnowledgeLearningRepository(sql).settings(request.params.id)))
  app.put<{ Params: { id: string } }>(`${base}/settings`, async (request, reply) => {
    const body = validate(settingsSchema, request.body, reply); if (!body.ok) return
    return withDb(sql => createKnowledgeLearningRepository(sql).updateSettings(request.params.id, body.data))
  })
  app.get<{ Params: { id: string } }>(`${base}/events`, request => withDb(sql => createKnowledgeLearningRepository(sql).events(request.params.id)))
  app.get<{ Params: { id: string } }>(`${base}/gaps`, request => withDb(sql => createKnowledgeLearningRepository(sql).gaps(request.params.id)))
  app.post<{ Params: { id: string; gapId: string } }>(`${base}/gaps/:gapId/resolve`, async request => {
    await withDb(sql => createKnowledgeLearningRepository(sql).resolveGap(request.params.id, request.params.gapId)); return { ok: true }
  })
  app.post<{ Params: { id: string; gapId: string } }>(`${base}/gaps/:gapId/candidate`, async (request, reply) => {
    const body = validate(correctionSchema, request.body, reply); if (!body.ok) return
    return withDb(sql => createKnowledgeLearningRepository(sql).candidateFromGap(request.params.id, request.params.gapId, body.data.content, request.user!.userId))
  })
  app.get<{ Params: { id: string; candidateId: string } }>(`${base}/candidates/:candidateId/history`, request => withDb(sql => createKnowledgeLearningRepository(sql).history(request.params.id, request.params.candidateId)))
  app.post<{ Params: { id: string; eventId: string } }>(`${base}/events/:eventId/feedback`, async (request, reply) => {
    const body = validate(feedbackSchema, request.body, reply); if (!body.ok) return
    await withDb(sql => createKnowledgeLearningRepository(sql).feedback(request.params.id, request.params.eventId, body.data.feedback, request.user!.userId)); return { ok: true }
  })
  app.post<{ Params: { id: string; candidateId: string } }>(`${base}/candidates/:candidateId/review`, async (request, reply) => {
    const body = validate(reviewSchema, request.body, reply); if (!body.ok) return
    const clinicId = request.params.id
    const result = await withDb(sql => createKnowledgeLearningRepository(sql).review(clinicId, request.params.candidateId, { ...body.data, actorId: request.user!.userId }))
    let indexing: 'queued' | 'failed' | 'unchanged' = 'unchanged'
    // Retrying an approved review can also repair an interrupted enqueue.
    const documentId = result.write?.document.id ?? result.candidate.publishedDocumentId
    const documentVersion = result.write?.document.version ?? result.candidate.publishedDocumentVersion
    if (documentId && documentVersion && ['approve','rollback'].includes(body.data.action)) {
      try {
        await kbEmbedQueue.add('embed-document', { clinicId, documentId, documentVersion })
        indexing = 'queued'
      } catch {
        await withDb(sql => createKnowledgeRepository(sql).markDocumentIndexFailed(clinicId, documentId, documentVersion, 'queue_unavailable'))
        indexing = 'failed'
      }
    }
    return { candidate: result.candidate, indexing }
  })
}
export default route
