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
import { createWorkflowsRepository } from '@docmee/db'
import type { WorkflowNode, WorkflowEdge } from '@docmee/db'
import { validateWorkflowDefinition } from '@docmee/agents'
import { withDb } from '../lib/db.js'
import { validate } from '../lib/validate.js'
import { resolveClinicScope } from '../lib/scope.js'
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
const createSchema = z.object({
  name: z.string().min(1),
  status: z.enum(['draft', 'active']).optional(),
  nodes: z.array(nodeSchema).optional(),
  edges: z.array(edgeSchema).optional(),
})
const patchSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(['draft', 'active']).optional(),
  nodes: z.array(nodeSchema).optional(),
  edges: z.array(edgeSchema).optional(),
})

function validateGraph(nodes: WorkflowNode[], edges: WorkflowEdge[], active: boolean, reply: FastifyReply): boolean {
  const errors = validateWorkflowDefinition(nodes, edges, { requireTrigger: active })
  if (errors.length === 0) return true
  reply.code(400).send({ error: 'Invalid workflow graph', details: errors })
  return false
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

  app.post<{ Params: { id: string } }>(
    '/clinics/:id/workflows',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(createSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const nodes = (parsed.data.nodes ?? []) as WorkflowNode[]
      const edges = (parsed.data.edges ?? []) as WorkflowEdge[]
      if (!validateGraph(nodes, edges, parsed.data.status === 'active', reply)) return
      const workflow = await withDb(async (sql) =>
        createWorkflowsRepository(sql).create({
          clinicId,
          name: parsed.data.name,
          status: parsed.data.status ?? 'draft',
          nodes,
          edges,
        }),
      )
      return reply.code(201).send({ workflow })
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
      const nodes = (parsed.data.nodes ?? current.nodes) as WorkflowNode[]
      const edges = (parsed.data.edges ?? current.edges) as WorkflowEdge[]
      const active = parsed.data.status === 'active' || (parsed.data.status === undefined && current.status === 'active')
      if (!validateGraph(nodes, edges, active, reply)) return
      const workflow = await withDb(async (sql) =>
        createWorkflowsRepository(sql).update(clinicId, request.params.workflowId, {
          name: parsed.data.name,
          status: parsed.data.status,
          nodes,
          edges,
        }),
      )
      if (!workflow) return reply.code(404).send({ error: 'Workflow not found' })
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
}

export default workflowsRoute
