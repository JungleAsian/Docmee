import type { FastifyPluginAsync } from 'fastify'
import { createClinicsRepository, createWorkflowExecutionsRepository, createWorkflowsRepository } from '@docmee/db'
import { simulateWorkflow, validateWorkflowDefinitionDetailed } from '@docmee/agents'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { resolveClinicScope } from '../lib/scope.js'
import { withDb } from '../lib/db.js'
import { rateLimitGuard } from '../lib/rate-limit.js'
import { readAiAssistant, resolveChat } from '../lib/ai-assistant.js'
import { parseWorkflowProposal, workflowAssistantContext, workflowAssistantRequest, workflowAssistantSystem } from '../lib/workflow-assistant.js'

type Graph = Parameters<typeof workflowAssistantContext>[0]
async function inspect(graph: Graph) {
  const issues = validateWorkflowDefinitionDetailed(graph.nodes, graph.edges, { requireTrigger: true })
  const checks = issues.map(({ code, severity, nodeId, edgeId }) => ({ code, severity, nodeId, edgeId }))
  if (issues.some((issue) => issue.severity === 'error')) return { checks, simulation: null }
  const result = await simulateWorkflow(graph, {})
  return { checks, simulation: { status: result.status, coverage: result.coverage, safety: result.safety, errors: result.errors.map(({ code, nodeId }) => ({ code, nodeId })) } }
}

// Suggestion-only endpoint. It intentionally has no write repository, queue or live provider tools.
const workflowAssistantRoute: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string } }>('/clinics/:id/workflows/assistant', {
    bodyLimit: 120_000,
    preHandler: [requireAuth, requireRole('ia_studio_admin'), rateLimitGuard({ name: 'workflow-assistant', max: 10, windowMs: 60_000 })],
  }, async (request, reply) => {
    const parsed = workflowAssistantRequest.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid workflow assistant request' })
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const clinic = await withDb((sql) => createClinicsRepository(sql).findById(clinicId))
    if (!clinic) return reply.code(404).send({ error: 'Clinic not found' })
    const input = parsed.data
    if (input.workflowId) {
      const workflow = await withDb((sql) => createWorkflowsRepository(sql).findById(clinicId, input.workflowId!))
      if (!workflow) return reply.code(404).send({ error: 'Workflow not found' })
    }
    const ai = readAiAssistant(clinic)
    if (!ai.enabled || ai.chatProvider === 'claude_cli') return reply.code(503).send({ error: 'Enable an API-based assistant in this clinic’s AI settings to use workflow assistance.' })
    const runs = input.workflowId ? await withDb((sql) => createWorkflowExecutionsRepository(sql).listRuns(clinicId, input.workflowId!, 10)) : []
    const evidence = await inspect(input.graph)
    const limitations = ['Simulation uses mocked providers; live integrations are not verified.', 'Recent run statuses do not establish a runtime root cause.', 'Existing configuration values are withheld from the model. Proposals replace the entire draft and must be reviewed.']
    let timer: ReturnType<typeof setTimeout> | undefined
    let raw: string
    try {
      const chat = resolveChat(ai, clinic.settings, clinicId, false)
      raw = await Promise.race([
        chat(workflowAssistantSystem(input.mode, input.language), JSON.stringify({ instruction: input.instruction, ...workflowAssistantContext(input.graph, runs), ...evidence, limitations }), input.mode === 'build' ? 5000 : 2000),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 30_000) }),
      ])
    } catch {
      // Provider messages can contain credentials/request content; never return or log them.
      return reply.code(502).send({ error: 'Workflow assistant could not respond. Check this clinic’s AI settings and retry.' })
    } finally { if (timer) clearTimeout(timer) }
    if (input.mode === 'diagnose') {
      if (!raw.trim() || raw.length > 12_000) return reply.code(422).send({ error: 'Invalid assistant response. No changes were made.' })
      return { clinicId, mode: input.mode, ...evidence, limitations, explanation: raw }
    }
    try {
      const proposal = parseWorkflowProposal(raw)
      const proposalEvidence = proposal.kind === 'proposal' ? await inspect(proposal) : evidence
      return { clinicId, mode: input.mode, ...proposalEvidence, limitations, proposal }
    } catch {
      return reply.code(422).send({ error: 'Assistant produced an invalid workflow proposal. No changes were made.' })
    }
  })
}
export default workflowAssistantRoute
