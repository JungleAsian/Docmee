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
const TERMINAL_TOKENS = new Set<string>(['book', 'handoff', 'end'])

const branchSchema = z.object({
  op: z.enum(['contains', 'equals', 'yes', 'no', 'any', 'starts_with', 'regex']),
  keywords: z.array(z.string().min(1)).optional(),
  // Match text for `op: 'regex'` (ignored otherwise).
  pattern: z.string().min(1).optional(),
  next: z.string().min(1),
})

// Single Choice option (Punchlist Aug 3 parity spec) — a tappable WhatsApp
// button/list row. `optionId` is a stable slug sent as the interactive reply
// id, so routing never depends on the patient's locale or a retyped label.
const optionSchema = z.object({
  optionId: z.string().regex(/^[a-z0-9_]{1,64}$/),
  title: z.string().min(1).max(24),
  description: z.string().max(72).optional(),
  goToNext: z.string().min(1),
  saveValue: z.string().optional(),
})

const stepSchema = z.object({
  id: z.string().min(1),
  messages: z.array(z.string().min(1)),
  branches: z.array(branchSchema).optional(),
  collect: z.string().min(1).nullable().optional(),
  next: z.string().min(1).nullable().optional(),
  action: actionSchema.nullable().optional(),
  // Single Choice — additive fields; absent `type` = today's legacy step.
  type: z.enum(['single_choice']).optional(),
  header: z.string().max(60).optional(),
  footer: z.string().max(60).optional(),
  renderMode: z.enum(['buttons', 'list']).optional(),
  listButtonLabel: z.string().max(20).optional(),
  options: z.array(optionSchema).optional(),
  storeAs: z.enum(['optionId', 'title', 'saveValue']).optional(),
  retryMessage: z.string().max(1024).optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
  onFailNext: z.string().min(1).optional(),
  // Visual-canvas node coordinates (Rev 2) — persisted in the steps JSONB so the
  // graph reopens with the same layout. The flow engine ignores them.
  x: z.number().optional(),
  y: z.number().optional(),
})

type StepInput = z.infer<typeof stepSchema>

/**
 * Publish-time checks for `single_choice` steps (Punchlist Aug 3 parity spec):
 * non-empty options, count within the renderMode limit, unique optionId per
 * node, and every goToNext/next/branch/onFailNext resolves to a real stepId or
 * a terminal token. Scoped to single_choice steps' own fields only — legacy
 * step routing is unvalidated today and this doesn't change that.
 */
function validateStepGraph(steps: StepInput[], ctx: z.RefinementCtx): void {
  const ids = new Set(steps.map((s) => s.id))
  const isValidTarget = (target: string) => TERMINAL_TOKENS.has(target) || ids.has(target)

  for (const step of steps) {
    if (step.type !== 'single_choice') continue
    const options = step.options ?? []
    const renderMode = step.renderMode ?? 'buttons'
    const limit = renderMode === 'list' ? 10 : 3

    if (options.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps'], message: `Step "${step.id}": single_choice requires at least one option` })
    } else if (options.length > limit) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps'], message: `Step "${step.id}": too many options for renderMode "${renderMode}" (max ${limit})` })
    }
    const seenIds = new Set<string>()
    for (const opt of options) {
      if (seenIds.has(opt.optionId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps'], message: `Step "${step.id}": duplicate optionId "${opt.optionId}"` })
      }
      seenIds.add(opt.optionId)
      if (!isValidTarget(opt.goToNext)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps'], message: `Step "${step.id}": option "${opt.optionId}" goToNext references an unknown step "${opt.goToNext}"` })
      }
    }

    if (step.next && !isValidTarget(step.next)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps'], message: `Step "${step.id}": next references an unknown step "${step.next}"` })
    }
    for (const b of step.branches ?? []) {
      if (!isValidTarget(b.next)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps'], message: `Step "${step.id}": a condition references an unknown step "${b.next}"` })
      }
    }
    if (step.onFailNext && !isValidTarget(step.onFailNext)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps'], message: `Step "${step.id}": onFailNext references an unknown step "${step.onFailNext}"` })
    }
  }
}

/** `renderMode: 'list'` needs a tap-to-open button label — default it (spec: `"Select"`)
 *  rather than hard-erroring when the admin didn't set one. */
function applyStepDefaults(steps: StepInput[]): StepInput[] {
  return steps.map((s) =>
    s.type === 'single_choice' && s.renderMode === 'list' && !s.listButtonLabel
      ? { ...s, listButtonLabel: 'Select' }
      : s,
  )
}

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
  .superRefine((d, ctx) => {
    if (d.steps) validateStepGraph(d.steps, ctx)
  })

const patchSchema = z
  .object({
    name: z.string().min(1).optional(),
    triggerKeywords: z.array(z.string().min(1)).min(1).optional(),
    messages: z.array(z.string().min(1)).min(1).optional(),
    action: actionSchema.nullable().optional(),
    language: languageSchema.optional(),
    enabled: z.boolean().optional(),
    steps: z.array(stepSchema).optional(),
    startStepId: z.string().min(1).nullable().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.steps) validateStepGraph(d.steps, ctx)
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
          steps: applyStepDefaults(parsed.data.steps ?? []) as CustomFlowStep[],
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
        const patch = parsed.data.steps ? { ...parsed.data, steps: applyStepDefaults(parsed.data.steps) } : parsed.data
        return repo.update(clinicId, request.params.flowId, patch)
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
