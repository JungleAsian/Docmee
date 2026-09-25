import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { createClinicsRepository, createDoctorsRepository, createKnowledgeRepository, createKnowledgeLearningRepository,
  createWorkflowsRepository, type KnowledgeDocument, type LearningHistory } from '@docmee/db'
import { withDb } from '../lib/db.js'
import { validate } from '../lib/validate.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { rateLimitGuard } from '../lib/rate-limit.js'
import { previewTeachingAnswer } from '../lib/teaching-preview.js'

const scopeFields = { doctorId: z.string().uuid().nullable(), language: z.enum(['en', 'es']).nullable() }
const draftSchema = z.object({ ...scopeFields, title: z.string().trim().min(1).max(200), content: z.string().trim().min(1).max(12000),
  targetDocumentId: z.string().uuid().optional(), targetVersion: z.number().int().positive().optional(),
}).strict().refine(v => Boolean(v.targetDocumentId) === Boolean(v.targetVersion), 'target_version_required')
const previewSchema = z.object({ ...scopeFields, question: z.string().trim().min(1).max(2000),
  workflowId: z.string().uuid(), nodeId: z.string().min(1).max(200),
}).strict()

export function teachingAvailability(candidate: { status: string; publishedDocumentVersion: number | null }, doc: KnowledgeDocument | null): string {
  if (candidate.status !== 'approved') return candidate.status === 'pending_review' ? 'draft' : candidate.status
  if (!doc || doc.version !== candidate.publishedDocumentVersion || doc.status !== 'active' || !doc.approvedAt
    || ['excluded', 'archived'].includes(String(doc.metadata['governanceReviewState']))
    || (doc.effectiveFrom && Date.parse(doc.effectiveFrom) > Date.now())
    || (doc.effectiveUntil && Date.parse(doc.effectiveUntil) <= Date.now())) return 'superseded'
  return doc.indexingStatus === 'ready' ? 'ready' : doc.indexingStatus === 'failed' ? 'indexing_failed' : 'approved'
}

const route: FastifyPluginAsync = async app => {
  app.addHook('preHandler', requireAuth)
  app.addHook('preHandler', requireRole('ia_studio_admin'))
  app.addHook('preHandler', async (request, reply) => {
    if (!resolveClinicScope(request, (request.params as { id: string }).id)) return reply.code(403).send({ error: 'Forbidden' })
  })
  app.addHook('preHandler', rateLimitGuard({ name: 'kb-teaching', max: 90, windowMs: 60_000 }))
  app.setErrorHandler((error, request, reply) => {
    if (error.message === 'not_found') return reply.code(404).send({ error: 'not_found' })
    if (['duplicate_knowledge', 'stale_candidate', 'stale_sources', 'expired_candidate', 'mixed_source_scope'].includes(error.message)) return reply.code(409).send({ error: error.message })
    if (['content_required', 'remove_private_information'].includes(error.message)) return reply.code(400).send({ error: error.message })
    request.log.warn({ operation: 'kb_teaching' }, 'Teaching operation failed')
    return reply.code(500).send({ error: 'teaching_operation_failed' })
  })
  const base = '/clinics/:id/kb/teaching'
  app.get<{ Params: { id: string } }>(`${base}/drafts`, request => withDb(sql =>
    sql`SELECT id, original_source->>'title' AS title, evidence->>'doctorId' AS doctor_id,
        evidence->>'language' AS language, status
      FROM knowledge_candidates WHERE clinic_id = ${request.params.id} AND original_source->>'source' = 'jzel_teaching'
        AND (expires_at IS NULL OR expires_at > now()) AND status IN ('pending_review', 'approved')
      ORDER BY updated_at DESC LIMIT 30`))
  app.get<{ Params: { id: string } }>(`${base}/options`, request => withDb(async sql => {
    const clinicId = request.params.id
    const clinic = await createClinicsRepository(sql).findById(clinicId)
    if (!clinic) throw new Error('not_found')
    const doctors = await createDoctorsRepository(sql).listByClinic(clinicId)
    const workflows = await createWorkflowsRepository(sql).listByClinic(clinicId)
    const documents = await sql<Array<Pick<KnowledgeDocument, 'id'|'title'|'version'|'metadata'>>> `
      SELECT id, title, version, jsonb_build_object('doctorId', metadata->'doctorId', 'language', metadata->'language') AS metadata
      FROM knowledge_documents WHERE clinic_id = ${clinicId} AND status = 'active' AND approved_at IS NOT NULL
        AND COALESCE(metadata->>'governanceReviewState', 'trusted') NOT IN ('excluded', 'archived')
      ORDER BY updated_at DESC LIMIT 201`
    return { clinic: { id: clinic.id, name: clinic.name }, doctors: doctors.map(d => ({ id: d.id, name: d.name })),
      documents: documents.slice(0, 200), documentsTruncated: documents.length > 200,
      nodes: workflows.flatMap(w => w.nodes.filter(n => n.type === 'action.ai_agent').map(n => ({ workflowId: w.id, nodeId: n.id,
        name: `${w.name} · ${n.id}`, version: w.documentVersion, status: w.status }))) }
  }))
  app.post<{ Params: { id: string } }>(`${base}/drafts`, async (request, reply) => {
    const body = validate(draftSchema, request.body, reply); if (!body.ok) return
    return withDb(async sql => {
      const clinicId = request.params.id
      const learning = createKnowledgeLearningRepository(sql)
      const candidate = await learning.teachingDraft(clinicId, { ...body.data, actorId: request.user!.userId })
      const knowledge = createKnowledgeRepository(sql)
      // Bounded lexical matches surface possible conflicts for human review, never certify their absence.
      const related = await knowledge.searchChunks(`${body.data.title} ${body.data.content}`.slice(0, 4000), [], {
        clinicId, doctorId: body.data.doctorId ?? undefined, language: body.data.language ?? undefined,
      }, 10)
      const previous = body.data.targetDocumentId ? await knowledge.findDocument(clinicId, body.data.targetDocumentId) : null
      return { candidate, related: related.map(m => ({ documentId: m.documentId, title: m.title, content: m.content, documentVersion: m.documentVersion })),
        previous: previous ? { title: previous.title, content: previous.content, version: previous.version } : null }
    })
  })
  app.get<{ Params: { id: string; candidateId: string } }>(`${base}/drafts/:candidateId`, request => withDb(async sql => {
    const { id: clinicId, candidateId } = request.params
    const learning = createKnowledgeLearningRepository(sql)
    const candidate = await learning.findCandidate(clinicId, candidateId)
    if (!candidate || candidate.originalSource?.['source'] !== 'jzel_teaching') throw new Error('not_found')
    const document = candidate.publishedDocumentId ? await createKnowledgeRepository(sql).findDocument(clinicId, candidate.publishedDocumentId) : null
    const history: LearningHistory[] = await learning.history(clinicId, candidate.id)
    let parentId = candidate.previousVersionId
    const visited = new Set([candidate.id])
    while (parentId && !visited.has(parentId) && visited.size < 100) {
      visited.add(parentId)
      const parent = await learning.findCandidate(clinicId, parentId)
      if (!parent || parent.publishedDocumentId !== candidate.publishedDocumentId || !['approved', 'superseded'].includes(parent.status)) break
      history.push(...(await learning.history(clinicId, parentId)).filter(h => ['approve', 'rollback'].includes(h.action)))
      parentId = parent.previousVersionId
    }
    const related = candidate.status === 'pending_review' ? await createKnowledgeRepository(sql).searchChunks(
      `${candidate.originalSource['title']} ${candidate.candidateContent}`.slice(0, 4000), [], {
        clinicId, doctorId: candidate.evidence.doctorId ?? undefined, language: candidate.evidence.language ?? undefined,
      }, 10) : []
    return { candidate, related: related.map(m => ({ documentId: m.documentId, title: m.title, content: m.content, documentVersion: m.documentVersion })),
      previous: candidate.status === 'pending_review' && document ? { title: document.title, content: document.content, version: document.version } : null,
      availability: teachingAvailability(candidate, document), history,
      indexingStatus: document?.indexingStatus ?? null }
  }))
  app.post<{ Params: { id: string } }>(`${base}/preview`, {
    preHandler: rateLimitGuard({ name: 'kb-teaching-preview', max: 10, windowMs: 60_000 }),
  }, async (request, reply) => {
    const body = validate(previewSchema, request.body, reply); if (!body.ok) return
    return withDb(async sql => {
      const clinicId = request.params.id
      const clinic = await createClinicsRepository(sql).findById(clinicId)
      if (!clinic) throw new Error('not_found')
      if (body.data.doctorId && !await createDoctorsRepository(sql).findById(clinicId, body.data.doctorId)) throw new Error('not_found')
      const workflow = await createWorkflowsRepository(sql).findById(clinicId, body.data.workflowId)
      const node = workflow?.nodes.find(n => n.id === body.data.nodeId && n.type === 'action.ai_agent')
      if (!workflow || !node) throw new Error('not_found')
      const result = await previewTeachingAnswer(sql, clinic, node, body.data)
      return { ...result, workflowVersion: workflow.documentVersion, workflowStatus: workflow.status,
        diagnostics: {
          clinic: { id: clinic.id, name: clinic.name },
          workflowNode: { workflowId: workflow.id, workflowName: workflow.name, nodeId: node.id },
          kbMatches: result.kbMatches,
          retrievalMode: result.retrievalMode,
          sources: result.sources,
        },
      }
    })
  })
}
export default route
