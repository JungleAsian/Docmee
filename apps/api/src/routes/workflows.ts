// Rev 3 — N8N-style automation workflows (CRUD). A clinic builds a typed node graph
// (trigger → logic → action) on the canvas; the workflow-runner worker executes
// active workflows when their trigger fires.
//   GET    /clinics/:id/workflows
//   GET    /clinics/:id/workflows/:workflowId
//   POST   /clinics/:id/workflows               (clinic_admin, ia_studio_admin)
//   PATCH  /clinics/:id/workflows/:workflowId    (clinic_admin, ia_studio_admin)
//   DELETE /clinics/:id/workflows/:workflowId    (clinic_admin, ia_studio_admin)
import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { z } from 'zod'
import { createAuditRepository, createClinicsRepository, createWorkflowApprovalsRepository, createWorkflowExecutionsRepository, createWorkflowsRepository, normalizeWorkflowStatus } from '@docmee/db'
import type { Clinic } from '@docmee/db'
import { createQueue } from '@docmee/queue'
import type { WorkflowNode, WorkflowEdge, WorkflowDocumentV2 } from '@docmee/db'
import { materializeWorkflowDocument, simulateWorkflow, validateWorkflowDefinition, validateWorkflowDefinitionDetailed } from '@docmee/agents'
import { readAiAssistant, resolveChat } from '../lib/ai-assistant.js'
import { withDb } from '../lib/db.js'
import { validate } from '../lib/validate.js'
import { resolveClinicScope } from '../lib/scope.js'
import { rateLimitGuard } from '../lib/rate-limit.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const nodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['trigger', 'logic', 'action']),
  type: z.string().min(1),
  config: z.record(z.unknown()).default({}),
  x: z.number(),
  y: z.number(),
})
const edgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().nullable().optional(),
})
const executionNodeSchema = nodeSchema.omit({ x: true, y: true })
const workflowDocumentSchema = z.object({
  version: z.literal(2),
  definition: z.object({
    nodes: z.array(executionNodeSchema),
    edges: z.array(edgeSchema),
  }),
  presentation: z.object({
    nodes: z.record(z.object({ x: z.number(), y: z.number(), width: z.number().optional(), height: z.number().optional() })),
    viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() }).optional(),
    groups: z.array(z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      nodeIds: z.array(z.string().min(1)),
      collapsed: z.boolean().optional(),
      lane: z.string().min(1).optional(),
    })).optional(),
  }),
})
const workflowStatusSchema = z.enum(['draft', 'validated', 'ready', 'published', 'superseded', 'archived', 'active']).transform(normalizeWorkflowStatus)
const createSchema = z.object({
  name: z.string().min(1),
  status: workflowStatusSchema.optional(),
  nodes: z.array(nodeSchema).optional(),
  edges: z.array(edgeSchema).optional(),
  document: workflowDocumentSchema.optional(),
})
const patchSchema = z.object({
  name: z.string().min(1).optional(),
  status: workflowStatusSchema.optional(),
  nodes: z.array(nodeSchema).optional(),
  edges: z.array(edgeSchema).optional(),
  document: workflowDocumentSchema.optional(),
  expectedVersion: z.number().int().positive().optional(),
})

function graphFromDocument(document: WorkflowDocumentV2): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  return materializeWorkflowDocument(document)
}

function hasMixedGraphRepresentations(data: { nodes?: unknown; edges?: unknown; document?: unknown }): boolean {
  return data.document !== undefined && (data.nodes !== undefined || data.edges !== undefined)
}

function expectedWorkflowVersion(request: { headers: Record<string, string | string[] | undefined> }, bodyVersion?: number): number | undefined {
  const header = request.headers['if-match']
  const raw = Array.isArray(header) ? header[0] : header
  if (!raw) return bodyVersion
  const parsed = Number(raw.replace(/^W\//, '').replaceAll('"', ''))
  return Number.isInteger(parsed) && parsed > 0 ? parsed : bodyVersion
}

function validateGraph(nodes: WorkflowNode[], edges: WorkflowEdge[], active: boolean, reply: FastifyReply): boolean {
  const errors = validateWorkflowDefinition(nodes, edges, { requireTrigger: active })
  if (errors.length === 0) return true
  reply.code(400).send({
    error: 'Invalid workflow graph',
    details: errors,
    issues: validateWorkflowDefinitionDetailed(nodes, edges, { requireTrigger: active }),
  })
  return false
}

/** Operator diagnostics must never become a second transport for patient
 * messages, credentials, or raw provider payloads. Keep state + node trace. */
export function redactWorkflowDiagnostic(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactWorkflowDiagnostic)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => {
    const secret = /message|content|body|token|secret|authorization|provider.*payload/i.test(key)
    return [key, secret ? '[redacted]' : redactWorkflowDiagnostic(nested)]
  }))
}

// ── AI "Start with a wizard" (guided Q&A → workflow) ─────────────────────────
const wizardSchema = z.object({
  answers: z.record(z.string()).default({}),
  templates: z
    .array(z.object({ key: z.string().min(1), name: z.string(), description: z.string() }))
    .min(1),
})

function clinicRulesText(clinic: Clinic): string | null {
  const raw = (clinic.settings as { clinicRules?: unknown }).clinicRules
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null
}

/** Pull the first JSON object out of an LLM reply and validate it against the
 *  allowed template keys. Returns null on any malformation so the caller can
 *  fall back to a deterministic template — the wizard must never dead-end. */
function parseWizardJson(
  raw: string,
  allowedKeys: string[],
): { templateKey: string; name: string; greeting: string } | null {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>
    const templateKey =
      typeof obj.templateKey === 'string' && allowedKeys.includes(obj.templateKey)
        ? obj.templateKey
        : null
    if (!templateKey) return null
    const name = typeof obj.name === 'string' ? obj.name.trim().slice(0, 60) : ''
    const greeting = typeof obj.greeting === 'string' ? obj.greeting.trim().slice(0, 400) : ''
    return { templateKey, name, greeting }
  } catch {
    return null
  }
}

const workflowsRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get<{ Params: { id: string } }>('/clinics/:id/workflows', async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const workflows = await withDb(async (sql) => createWorkflowsRepository(sql).listByClinic(clinicId))
    return { workflows }
  })

  app.get<{ Params: { id: string; workflowId: string } }>(
    '/clinics/:id/workflows/:workflowId',
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const workflow = await withDb(async (sql) => createWorkflowsRepository(sql).findById(clinicId, request.params.workflowId))
      if (!workflow) return reply.code(404).send({ error: 'Workflow not found' })
      return { workflow }
    },
  )

  app.get<{ Params: { id: string; workflowId: string } }>(
    '/clinics/:id/workflows/:workflowId/revisions',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const revisions = await withDb((sql) => createWorkflowsRepository(sql).listRevisions(clinicId, request.params.workflowId))
      return { revisions }
    },
  )

  app.get<{ Params: { id: string; workflowId: string }; Querystring: { limit?: string } }>(
    '/clinics/:id/workflows/:workflowId/runs',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const limit = Number(request.query.limit ?? 50)
      const runs = await withDb((sql) => createWorkflowExecutionsRepository(sql).listRuns(clinicId, request.params.workflowId, Number.isFinite(limit) ? limit : 50))
      return { runs: runs.map((run) => ({ ...run, trace: redactWorkflowDiagnostic(run.trace) })) }
    },
  )

  app.get<{ Params: { id: string; workflowId: string; runId: string } }>(
    '/clinics/:id/workflows/:workflowId/runs/:runId',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const run = await withDb((sql) => createWorkflowExecutionsRepository(sql).findRunById(clinicId, request.params.workflowId, request.params.runId))
      if (!run) return reply.code(404).send({ error: 'Workflow run not found' })
      return { run: { ...run, trace: redactWorkflowDiagnostic(run.trace) } }
    },
  )

  app.post<{ Params: { id: string; workflowId: string }; Body: { context?: Record<string, unknown> } }>(
    '/clinics/:id/workflows/:workflowId/simulate',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const workflow = await withDb((sql) => createWorkflowsRepository(sql).findById(clinicId, request.params.workflowId))
      if (!workflow) return reply.code(404).send({ error: 'Workflow not found' })
      if (!validateGraph(workflow.nodes, workflow.edges, true, reply)) return
      const outcome = await simulateWorkflow(workflow, request.body?.context ?? {})
      return { simulation: { ...outcome, simulated: true } }
    },
  )

  app.post<{ Params: { id: string; workflowId: string; runId: string } }>(
    '/clinics/:id/workflows/:workflowId/runs/:runId/cancel',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const cancelled = await withDb((sql) => createWorkflowExecutionsRepository(sql).requestCancellation({
        id: request.params.runId,
        clinicId,
        workflowId: request.params.workflowId,
      }))
      if (!cancelled) return reply.code(409).send({ error: 'Workflow run cannot be cancelled' })
      await withDb((sql) => createAuditRepository(sql).log({
        clinicId,
        actorId: request.user!.userId,
        action: 'workflow_run_cancellation_requested',
        resourceType: 'workflow_run',
        resourceId: request.params.runId,
        metadata: { workflowId: request.params.workflowId },
      }))
      return { cancelled: true }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/clinics/:id/workflows',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(createSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      if (hasMixedGraphRepresentations(parsed.data)) {
        return reply.code(400).send({ error: 'Send either nodes/edges or document, not both' })
      }
      const graph = parsed.data.document ? graphFromDocument(parsed.data.document) : {
        nodes: (parsed.data.nodes ?? []) as WorkflowNode[],
        edges: (parsed.data.edges ?? []) as WorkflowEdge[],
      }
      const { nodes, edges } = graph
      if (!validateGraph(nodes, edges, parsed.data.status === 'published', reply)) return
      const workflow = await withDb(async (sql) =>
        createWorkflowsRepository(sql).create({
          clinicId,
          name: parsed.data.name,
          status: parsed.data.status ?? 'draft',
          nodes,
          edges,
          document: parsed.data.document,
        }),
      )
      return reply.code(201).send({ workflow })
    },
  )

  // Guided-Q&A wizard: given the operator's answers + the available templates
  // (passed by the client, which owns the template catalog), ask the clinic's AI
  // to pick the best-fit template and draft a tailored workflow name + opening
  // WhatsApp greeting. Always resolves to a valid template key — on a disabled/
  // missing/erroring model it falls back to the first template, so the wizard
  // never dead-ends. Returns only a small, sanitised suggestion; the client
  // builds the actual (already-valid) graph from its own template.
  app.post<{ Params: { id: string } }>(
    '/clinics/:id/workflows/wizard',
    {
      preHandler: [
        requireRole('clinic_admin', 'ia_studio_admin'),
        rateLimitGuard({ name: 'workflow-wizard', max: 20, windowMs: 60_000 }),
      ],
    },
    async (request, reply) => {
      const parsed = validate(wizardSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const { answers, templates } = parsed.data
      const allowedKeys = templates.map((tpl) => tpl.key)
      const fallback = { templateKey: allowedKeys[0], name: '', greeting: '' }

      const clinic = await withDb((sql) => createClinicsRepository(sql).findById(clinicId))
      if (!clinic) return reply.send(fallback)

      const ai = readAiAssistant(clinic)
      if (!ai.enabled) return reply.send(fallback)

      const language =
        (clinic.settings as { botLanguage?: unknown }).botLanguage === 'en' ? 'en' : 'es'
      try {
        const complete = resolveChat(ai, clinic.settings)
        const rules = clinicRulesText(clinic)
        const system =
          `You configure WhatsApp automations for a medical clinic. From the list of templates, choose the single best-fit template for the clinic's goal, and write a short workflow name and a warm, professional opening WhatsApp greeting. ` +
          `Reply in ${language === 'en' ? 'English' : 'Spanish'}. ` +
          `Return ONLY compact JSON, no markdown: {"templateKey":"<one of the given keys>","name":"<max 40 chars>","greeting":"<max 220 chars>"}.`
        const user = [
          `Clinic: ${clinic.name}`,
          rules ? `Clinic rules: ${rules}` : '',
          `Available templates:\n${templates.map((tpl) => `- ${tpl.key}: ${tpl.name} — ${tpl.description}`).join('\n')}`,
          `Operator answers:\n${Object.entries(answers).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`,
        ]
          .filter(Boolean)
          .join('\n\n')
        const raw = await complete(system, user, 400)
        return reply.send(parseWizardJson(raw, allowedKeys) ?? fallback)
      } catch (err) {
        request.log.error({ err }, 'workflow wizard suggestion failed')
        return reply.send(fallback)
      }
    },
  )

  app.patch<{ Params: { id: string; workflowId: string } }>(
    '/clinics/:id/workflows/:workflowId',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(patchSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const current = await withDb(async (sql) =>
        createWorkflowsRepository(sql).findById(clinicId, request.params.workflowId),
      )
      if (!current) return reply.code(404).send({ error: 'Workflow not found' })
      if (hasMixedGraphRepresentations(parsed.data)) {
        return reply.code(400).send({ error: 'Send either nodes/edges or document, not both' })
      }
      const graph = parsed.data.document ? graphFromDocument(parsed.data.document) : {
        nodes: (parsed.data.nodes ?? current.nodes) as WorkflowNode[],
        edges: (parsed.data.edges ?? current.edges) as WorkflowEdge[],
      }
      const { nodes, edges } = graph
      const published = parsed.data.status === 'published' || (parsed.data.status === undefined && current.status === 'published')
      if (!validateGraph(nodes, edges, published, reply)) return
      const expectedVersion = expectedWorkflowVersion(request, parsed.data.expectedVersion)
      const workflow = await withDb(async (sql) =>
        createWorkflowsRepository(sql).update(clinicId, request.params.workflowId, {
          name: parsed.data.name,
          status: parsed.data.status,
          nodes,
          edges,
          document: parsed.data.document,
          expectedVersion,
          actorId: request.user!.userId,
        }),
      )
      if (!workflow) {
        if (expectedVersion !== undefined) {
          const latest = await withDb((sql) => createWorkflowsRepository(sql).findById(clinicId, request.params.workflowId))
          if (latest) return reply.code(409).send({ error: 'Workflow changed by another editor', currentVersion: latest.documentVersion, workflow: latest })
        }
        return reply.code(404).send({ error: 'Workflow not found' })
      }
      reply.header('ETag', `"${workflow.documentVersion}"`)
      return { workflow }
    },
  )

  app.post<{ Params: { id: string; workflowId: string }; Body: { action?: string; reason?: string; expectedVersion?: number } }>(
    '/clinics/:id/workflows/:workflowId/lifecycle',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const action = request.body?.action
      if (action !== 'validate' && action !== 'mark_ready' && action !== 'publish' && action !== 'archive' && action !== 'restore') {
        return reply.code(400).send({ error: 'Invalid workflow lifecycle action' })
      }
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const current = await withDb((sql) => createWorkflowsRepository(sql).findById(clinicId, request.params.workflowId))
      if (!current) return reply.code(404).send({ error: 'Workflow not found' })
      if (action === 'validate' || action === 'mark_ready' || action === 'publish') {
        if (!validateGraph(current.nodes, current.edges, true, reply)) return
      }
      const expectedVersion = expectedWorkflowVersion(request, request.body?.expectedVersion)
      const workflow = await withDb((sql) => createWorkflowsRepository(sql).transitionLifecycle(clinicId, request.params.workflowId, action, {
        actorId: request.user!.userId,
        reason: request.body?.reason,
        expectedVersion,
      }))
      if (!workflow) return reply.code(409).send({ error: 'Workflow lifecycle changed or action is not allowed' })
      reply.header('ETag', `"${workflow.documentVersion}"`)
      return { workflow }
    },
  )

  app.post<{ Params: { id: string; workflowId: string; revisionId: string }; Body: { reason?: string; expectedVersion?: number } }>(
    '/clinics/:id/workflows/:workflowId/revisions/:revisionId/restore',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const workflow = await withDb((sql) => createWorkflowsRepository(sql).restoreRevision(clinicId, request.params.workflowId, request.params.revisionId, {
        actorId: request.user!.userId,
        reason: request.body?.reason,
        expectedVersion: expectedWorkflowVersion(request, request.body?.expectedVersion),
      }))
      if (!workflow) return reply.code(409).send({ error: 'Revision cannot be restored because this workflow changed or the revision is unavailable' })
      reply.header('ETag', `"${workflow.documentVersion}"`)
      return { workflow }
    },
  )

  app.delete<{ Params: { id: string; workflowId: string } }>(
    '/clinics/:id/workflows/:workflowId',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const removed = await withDb(async (sql) =>
        createWorkflowsRepository(sql).delete(clinicId, request.params.workflowId),
      )
      if (!removed) return reply.code(404).send({ error: 'Workflow not found' })
      return { deleted: true }
    },
  )

  app.get<{ Params: { id: string } }>('/clinics/:id/workflow-approvals', async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const approvals = await withDb(async (sql) => createWorkflowApprovalsRepository(sql).listPending(clinicId))
    return { approvals }
  })

  app.get<{ Params: { id: string } }>('/clinics/:id/workflow-ai-drafts', async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const drafts = await withDb(async (sql) => createWorkflowApprovalsRepository(sql).listDrafts(clinicId))
    return { drafts }
  })

  app.post<{ Params: { id: string; approvalId: string }; Body: { decision?: string } }>(
    '/clinics/:id/workflow-approvals/:approvalId/decision',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const decision = request.body?.decision
      if (decision !== 'approved' && decision !== 'rejected') return reply.code(400).send({ error: 'Decision must be approved or rejected' })
      const approval = await withDb(async (sql) => {
        const repo = createWorkflowApprovalsRepository(sql)
        const row = await repo.decide(clinicId, request.params.approvalId, decision, request.user!.userId)
        if (row) await createAuditRepository(sql).log({ clinicId, actorId: request.user!.userId, action: `workflow_approval_${decision}`, resourceType: 'workflow_approval', resourceId: row.id, metadata: { workflowId: row.workflowId, nodeId: row.nodeId } })
        return row
      })
      if (!approval) return reply.code(409).send({ error: 'Approval is not pending or has expired' })
      if (decision === 'approved') {
        await createQueue('workflow-run').add('run', {
          clinicId, workflowId: approval.workflowId,
          workflowRevisionId: approval.workflowRevisionId ?? undefined,
          trigger: { type: 'trigger.workflow_approval', sourceEventId: `workflow-approval:${approval.id}`, conversationId: approval.conversationId ?? undefined, patientId: approval.patientId ?? undefined },
          startNodeId: approval.resumeNodeId ?? undefined, context: approval.context, approvalId: approval.id,
        }, { jobId: `workflow-approval:${approval.id}` })
      }
      return { approval }
    },
  )
}

export default workflowsRoute
