// P18 (Gap #34) / Rev1 #28: Custom flow management. Keyword-triggered scripted
// conversation flows that bypass intent classification / the LLM. Single-shot OR
// multi-step / conditional (executed by the flow engine). Managed in Admin Studio.
//   GET    /clinics/:id/custom-flows              (any authenticated user, own clinic)
//   GET    /clinics/:id/custom-flows/templates    (any authenticated user, own clinic)
//   POST   /clinics/:id/custom-flows              (clinic_admin, ia_studio_admin)
//   PATCH  /clinics/:id/custom-flows/:flowId      (clinic_admin, ia_studio_admin)
//   DELETE /clinics/:id/custom-flows/:flowId      (clinic_admin, ia_studio_admin)
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { createCustomFlowsRepository } from '@docmee/db'
import type { CustomFlowStep } from '@docmee/db'
import { FLOW_TEMPLATES } from '@docmee/agents'
import { withDb } from '../lib/db.js'
import { validate } from '../lib/validate.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const actionSchema = z.enum(['book', 'handoff', 'end'])
const languageSchema = z.enum(['es', 'en', 'both'])

const branchSchema = z.object({
  op: z.enum(['contains', 'equals', 'yes', 'no', 'any']),
  keywords: z.array(z.string().min(1)).optional(),
  next: z.string().min(1),
})

const stepSchema = z.object({
  id: z.string().min(1),
  messages: z.array(z.string().min(1)),
  branches: z.array(branchSchema).optional(),
  collect: z.string().min(1).nullable().optional(),
  next: z.string().min(1).nullable().optional(),
  action: actionSchema.nullable().optional(),
  // Visual-canvas node coordinates (Rev 2) — persisted in the steps JSONB so the
  // graph reopens with the same layout. The flow engine ignores them.
  x: z.number().optional(),
  y: z.number().optional(),
})

// A flow needs SOMETHING to say: either a single-shot `messages` list or a step
// graph. The matcher always needs trigger keywords.
const createSchema = z
  .object({
    name: z.string().min(1),
    triggerKeywords: z.array(z.string().min(1)).min(1),
    messages: z.array(z.string().min(1)).optional(),
    action: actionSchema.nullable().optional(),
    language: languageSchema.optional(),
    enabled: z.boolean().optional(),
    steps: z.array(stepSchema).optional(),
    startStepId: z.string().min(1).nullable().optional(),
  })
  .refine((d) => (d.messages?.length ?? 0) > 0 || (d.steps?.length ?? 0) > 0, {
    message: 'Provide either messages or steps',
    path: ['messages'],
  })

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  triggerKeywords: z.array(z.string().min(1)).min(1).optional(),
  messages: z.array(z.string().min(1)).min(1).optional(),
  action: actionSchema.nullable().optional(),
  language: languageSchema.optional(),
  enabled: z.boolean().optional(),
  steps: z.array(stepSchema).optional(),
  startStepId: z.string().min(1).nullable().optional(),
})

const customFlowsRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get<{ Params: { id: string } }>('/clinics/:id/custom-flows', async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const flows = await withDb(async (sql) => createCustomFlowsRepository(sql).listByClinic(clinicId))
    return { flows }
  })

  // Prebuilt flows (schedule / reschedule / price / surgery / review) the admin
  // can instantiate into a real, editable flow in one click.
  app.get<{ Params: { id: string } }>('/clinics/:id/custom-flows/templates', async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    return { templates: FLOW_TEMPLATES }
  })

  app.post<{ Params: { id: string } }>(
    '/clinics/:id/custom-flows',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(createSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const flow = await withDb(async (sql) =>
        createCustomFlowsRepository(sql).create({
          clinicId,
          name: parsed.data.name,
          triggerKeywords: parsed.data.triggerKeywords,
          messages: parsed.data.messages ?? [],
          action: parsed.data.action ?? null,
          language: parsed.data.language ?? 'both',
          enabled: parsed.data.enabled ?? true,
          steps: (parsed.data.steps ?? []) as CustomFlowStep[],
          startStepId: parsed.data.startStepId ?? null,
        }),
      )
      return reply.code(201).send({ flow })
    },
  )

  app.patch<{ Params: { id: string; flowId: string } }>(
    '/clinics/:id/custom-flows/:flowId',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(patchSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const flow = await withDb(async (sql) => {
        const repo = createCustomFlowsRepository(sql)
        if (!(await repo.findById(clinicId, request.params.flowId))) return null
        return repo.update(clinicId, request.params.flowId, parsed.data)
      })
      if (!flow) return reply.code(404).send({ error: 'Custom flow not found' })
      return { flow }
    },
  )

  app.delete<{ Params: { id: string; flowId: string } }>(
    '/clinics/:id/custom-flows/:flowId',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      await withDb(async (sql) => createCustomFlowsRepository(sql).delete(clinicId, request.params.flowId))
      return { deleted: true }
    },
  )
}

export default customFlowsRoute
