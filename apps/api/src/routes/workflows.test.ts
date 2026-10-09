import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { simulateWorkflow as realSimulateWorkflow, SIMULATION_REPLAY_LIMITS } from '../../../../packages/agents/src/workflows/workflow-simulator.js'
import type { WorkflowSimulationInput } from '../../../../packages/agents/src/workflows/workflow-simulator.js'
import type { WorkflowNode, WorkflowEdge } from '@docmee/db'

const validation = vi.hoisted(() => ({
  errors: [] as string[],
  issues: [] as Array<Record<string, unknown>>,
  simulationCalls: [] as Array<{ workflow: unknown; input: unknown }>,
}))

vi.mock('@docmee/queue', () => ({
  whatsappInboundQueue: { add: vi.fn() },
  kbEmbedQueue: { add: vi.fn() },
  createQueue: () => ({ add: vi.fn() }),
}))
vi.mock('@docmee/agents', () => ({
  SIMULATION_REPLAY_LIMITS,
  getOAuth2Client: () => ({}),
  validateWorkflowDefinition: () => validation.errors,
  validateWorkflowDefinitionDetailed: () => validation.issues,
  materializeWorkflowDocument: (document: { definition: unknown }) => document.definition,
  simulateWorkflow: async (workflow: unknown, input: unknown) => {
    validation.simulationCalls.push({ workflow, input })
    return realSimulateWorkflow(workflow as { nodes: WorkflowNode[]; edges: WorkflowEdge[] }, input as WorkflowSimulationInput)
  },
}))
vi.mock('@docmee/shared', () => ({
  encryptValue: (value: string) => `enc:${value}`,
  verifyPassword: () => true,
}))

const store = vi.hoisted(() => ({
  workflows: new Map<string, { id: string; clinicId: string; name: string; status: 'draft'; nodes: unknown[]; edges: unknown[]; activeRevisionId?: string }>(),
  workflowFindCalls: [] as Array<{ clinicId: string; id: string }>,
  runs: [] as Array<Record<string, unknown>>,
  auditLogs: [] as Array<Record<string, unknown>>,
  schedulingSessionCount: 0,
  schedulingCountCalls: [] as string[],
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createWorkflowsRepository: () => ({
    listByClinic: async (clinicId: string) => [...store.workflows.values()].filter((workflow) => workflow.clinicId === clinicId),
    findById: async (clinicId: string, id: string) => {
      store.workflowFindCalls.push({ clinicId, id })
      const workflow = store.workflows.get(id)
      return workflow?.clinicId === clinicId ? workflow : null
    },
    delete: async (clinicId: string, id: string) => {
      const workflow = store.workflows.get(id)
      if (!workflow || workflow.clinicId !== clinicId) return false
      store.workflows.delete(id)
      return true
    },
  }),
  createWorkflowApprovalsRepository: () => ({}),
  createConversationsRepository: () => ({ countSchedulingSessions: async (clinicId: string) => {
    store.schedulingCountCalls.push(clinicId)
    return store.schedulingSessionCount
  } }),
  createWorkflowExecutionsRepository: () => ({ listRuns: async () => store.runs, findRunById: async () => null }),
  createAuditRepository: () => ({ log: async (entry: Record<string, unknown>) => { store.auditLogs.push(entry) } }),
  normalizeWorkflowStatus: (status: string) => status === 'active' ? 'published' : status,
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'
import { redactWorkflowDiagnostic } from './workflows.js'

const adminAuth = {
  authorization: `Bearer ${signAccessToken({ userId: 'admin-c1', clinicId: 'c-1', role: 'clinic_admin', email: 'admin@c1.test' })}`,
}
const secretaryAuth = {
  authorization: `Bearer ${signAccessToken({ userId: 'sec-c1', clinicId: 'c-1', role: 'secretary', email: 'sec@c1.test' })}`,
}
const doctorAuth = {
  authorization: `Bearer ${signAccessToken({ userId: 'doctor-c1', clinicId: 'c-1', role: 'doctor', email: 'doctor@c1.test' })}`,
}
const studioAuth = {
  authorization: `Bearer ${signAccessToken({ userId: 'studio-1', clinicId: 'studio', role: 'ia_studio_admin', email: 'studio@docmee.test' })}`,
}

function seed(id: string, clinicId = 'c-1') {
  store.workflows.set(id, { id, clinicId, name: id, status: 'draft', nodes: [], edges: [] })
}

describe('workflow run diagnostics', () => {
  it('redacts message and credential-like data before returning a trace', () => {
    expect(redactWorkflowDiagnostic({
      nodeId: 'send-1',
      providerPayload: { body: 'patient message', token: 'secret-token' },
      metadata: { authorization: 'Bearer value', safe: 'visible' },
    })).toEqual({
      nodeId: 'send-1',
      providerPayload: '[redacted]',
      metadata: { authorization: '[redacted]', safe: 'visible' },
    })
  })
})

describe('workflow delete contract (CRE-534)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns the documented success result for an existing scoped workflow', async () => {
    validation.errors = []
    validation.issues = []
    seed('wf-existing')
    const response = await app.inject({ method: 'DELETE', url: '/clinics/c-1/workflows/wf-existing', headers: adminAuth })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ deleted: true })
    expect(store.workflows.has('wf-existing')).toBe(false)
  })

  it('returns the same non-leaking 404 for missing, already absent, and malformed ids', async () => {
    validation.errors = []
    validation.issues = []
    for (const id of ['missing', 'not-a-workflow-id']) {
      const response = await app.inject({ method: 'DELETE', url: `/clinics/c-1/workflows/${id}`, headers: adminAuth })
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'Workflow not found' })
    }

    seed('wf-once')
    expect((await app.inject({ method: 'DELETE', url: '/clinics/c-1/workflows/wf-once', headers: adminAuth })).statusCode).toBe(200)
    const absent = await app.inject({ method: 'DELETE', url: '/clinics/c-1/workflows/wf-once', headers: adminAuth })
    expect(absent.statusCode).toBe(404)
    expect(absent.json()).toEqual({ error: 'Workflow not found' })
  })

  it('does not reveal a workflow in another clinic and rejects unprivileged callers', async () => {
    validation.errors = []
    validation.issues = []
    seed('wf-c2', 'c-2')
    const crossClinic = await app.inject({ method: 'DELETE', url: '/clinics/c-1/workflows/wf-c2', headers: adminAuth })
    expect(crossClinic.statusCode).toBe(404)
    expect(crossClinic.json()).toEqual({ error: 'Workflow not found' })

    const foreignScope = await app.inject({ method: 'DELETE', url: '/clinics/c-2/workflows/wf-c2', headers: adminAuth })
    expect(foreignScope.statusCode).toBe(403)
    expect(foreignScope.json()).toEqual({ error: 'Forbidden' })

    const unprivileged = await app.inject({ method: 'DELETE', url: '/clinics/c-1/workflows/missing', headers: secretaryAuth })
    expect(unprivileged.statusCode).toBe(403)
  })

  it('makes concurrent deletes deterministic: exactly one success and one truthful absence', async () => {
    validation.errors = []
    validation.issues = []
    seed('wf-race')
    const [first, second] = await Promise.all([
      app.inject({ method: 'DELETE', url: '/clinics/c-1/workflows/wf-race', headers: adminAuth }),
      app.inject({ method: 'DELETE', url: '/clinics/c-1/workflows/wf-race', headers: adminAuth }),
    ])
    const statuses = [first.statusCode, second.statusCode].sort()
    expect(statuses).toEqual([200, 404])
  })

  it('keeps raw workflow validation details and adds friendly issue cards', async () => {
    validation.errors = [
      'Interactive menu edge e_send_message_3_send_message_23_seq is connected to option "", which doesn\'t exist on node send_message_3 (unknown handle "") — it was likely renamed or deleted. Reconnect this edge to one of the menu\'s current options, or delete the edge.',
    ]
    validation.issues = [{
      code: 'interactive_menu_unknown_handle',
      title: 'One menu connection needs attention',
      where: 'Send message 3',
      nodeId: 'send_message_3',
      edgeId: 'e_send_message_3_send_message_23_seq',
      whatHappened: 'A connection from this menu is not attached to a valid choice. The choice may have been renamed or removed.',
      howToFix: 'Open the menu, remove the broken connection, then reconnect the correct choice.',
      technicalDetails: validation.errors[0],
    }]

    const response = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/workflows',
      headers: adminAuth,
      payload: { name: 'Appointment', status: 'active', nodes: [], edges: [] },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error: 'Invalid workflow graph',
      details: validation.errors,
      issues: validation.issues,
    })
  })

  it('simulates an unsaved editor graph without mutating the stored workflow', async () => {
    validation.errors = []
    validation.issues = []
    validation.simulationCalls = []
    seed('wf-simulate')
    const draftGraph = {
      nodes: [{ id: 'draft-start', kind: 'trigger', type: 'trigger.message_keyword', config: {}, x: 40, y: 40 }],
      edges: [],
    }
    const response = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/workflows/wf-simulate/simulate',
      headers: adminAuth,
      payload: { graph: draftGraph, input: { context: { tier: 'vip' }, maxSteps: 1 } },
    })

    expect(response.statusCode).toBe(200)
    expect(validation.simulationCalls).toEqual([{ workflow: draftGraph, input: { context: { tier: 'vip' }, maxSteps: 1 } }])
    expect(store.workflows.get('wf-simulate')?.nodes).toEqual([])
    expect(response.json().simulation.safety.isolated).toBe(true)
  })

  it('denies workflow diagnostics before repository access for every non-superuser role', async () => {
    seed('wf-diagnostics-auth')
    const callsBefore = store.workflowFindCalls.length
    const countCallsBefore = store.schedulingCountCalls.length

    const anonymous = await app.inject({ method: 'POST', url: '/clinics/c-1/workflows/wf-diagnostics-auth/diagnostics' })
    expect(anonymous.statusCode).toBe(401)
    for (const headers of [adminAuth, secretaryAuth, doctorAuth]) {
      const response = await app.inject({ method: 'POST', url: '/clinics/c-1/workflows/wf-diagnostics-auth/diagnostics', headers })
      expect(response.statusCode).toBe(403)
    }
    expect(store.workflowFindCalls).toHaveLength(callsBefore)
    expect(store.schedulingCountCalls).toHaveLength(countCallsBefore)
  })

  it('diagnoses an unsaved graph without persisting it and records metadata-only audit evidence', async () => {
    validation.errors = []
    validation.issues = []
    validation.simulationCalls = []
    store.auditLogs = []
    seed('wf-diagnostics')
    const draftGraph = {
      nodes: [
        { id: 'start', kind: 'trigger', type: 'trigger.message_keyword', config: { secret: 'do-not-audit' }, x: 0, y: 0 },
        { id: 'end', kind: 'action', type: 'action.end', config: {}, x: 200, y: 0 },
      ],
      edges: [{ id: 'edge-1', source: 'start', target: 'end' }],
    }

    const response = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/workflows/wf-diagnostics/diagnostics',
      headers: studioAuth,
      payload: { graph: draftGraph, simulation: { enabled: true }, readiness: { enabled: true }, recentRunsLimit: 5 },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().diagnostic).toMatchObject({
      source: 'unsaved_graph',
      status: 'ready',
      workflowChecks: [],
      recentRuns: [],
    })
    expect(validation.simulationCalls).toHaveLength(1)
    expect(store.workflows.get('wf-diagnostics')?.nodes).toEqual([])
    expect(store.auditLogs).toHaveLength(1)
    expect(store.auditLogs[0]).toMatchObject({
      clinicId: 'c-1',
      actorId: 'studio-1',
      action: 'workflow_diagnostic_completed',
      resourceType: 'workflow',
      resourceId: 'wf-diagnostics',
      metadata: expect.objectContaining({ source: 'unsaved_graph' }),
    })
    expect(JSON.stringify(store.auditLogs[0])).not.toContain('do-not-audit')
  })

  it('keeps invalid-graph diagnostics useful while suppressing simulation and redacting recent runs', async () => {
    validation.errors = ['Missing end step']
    validation.issues = [{
      code: 'missing_successor', severity: 'error', title: 'Add an ending', nodeId: 'start',
      whatHappened: 'The workflow has no ending.', howToFix: 'Connect an end step.', technicalDetails: 'missing successor',
    }]
    validation.simulationCalls = []
    store.runs = [{
      id: 'run-1', status: 'failed', currentNodeId: 'start',
      trace: { nodeId: 'start', message: 'patient text', providerPayload: { token: 'secret' }, safe: 'visible' },
    }]
    seed('wf-diagnostics-invalid')
    const response = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/workflows/wf-diagnostics-invalid/diagnostics',
      headers: studioAuth,
      payload: { graph: { nodes: [{ id: 'start', kind: 'trigger', type: 'trigger.message_keyword', config: {}, x: 0, y: 0 }], edges: [] } },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().diagnostic).toMatchObject({
      status: 'not_ready',
      source: 'unsaved_graph',
      workflowChecks: [{ code: 'missing_successor', nodeId: 'start' }],
      simulations: [{ status: 'skipped' }],
      recentRuns: [{ trace: { nodeId: 'start', message: '[redacted]', providerPayload: '[redacted]', safe: 'visible' } }],
    })
    expect(validation.simulationCalls).toHaveLength(0)
  })

  it('does not disclose a workflow from another clinic to a superuser diagnostic request', async () => {
    seed('wf-diagnostics-c2', 'c-2')
    const callsBefore = store.schedulingCountCalls.length
    const response = await app.inject({ method: 'POST', url: '/clinics/c-1/workflows/wf-diagnostics-c2/diagnostics', headers: studioAuth })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'Workflow not found' })
    expect(store.schedulingCountCalls).toHaveLength(callsBefore)
  })

  it('explains clinic scheduling interception, pinned revisions, and menu text fallback without changing state', async () => {
    validation.errors = []
    validation.issues = []
    seed('wf-runtime-diagnostics')
    store.workflows.get('wf-runtime-diagnostics')!.activeRevisionId = 'new-revision'
    store.schedulingSessionCount = 1
    store.runs = [{ id: 'old-run', status: 'waiting', workflowRevisionId: 'old-revision', trace: {
      menuDeliveries: [{ nodeId: 'menu-1', deliveryMode: 'text_fallback', fallbackReason: 'provider_error' }],
    } }]
    const callsBefore = store.schedulingCountCalls.length
    try {
      const response = await app.inject({ method: 'POST', url: '/clinics/c-1/workflows/wf-runtime-diagnostics/diagnostics', headers: studioAuth,
        payload: { simulation: { enabled: false }, readiness: { enabled: false } } })
      expect(response.statusCode).toBe(200)
      expect(response.json().diagnostic.workflowChecks.map((finding: { code: string }) => finding.code)).toEqual([
        'scheduling_session_interception', 'pinned_workflow_revision', 'interactive_menu_text_fallback',
      ])
      expect(store.schedulingCountCalls.slice(callsBefore)).toEqual(['c-1'])
      expect(store.runs[0]?.status).toBe('waiting')
    } finally {
      store.schedulingSessionCount = 0
      store.runs = []
    }
  })

  it.each(['action.interactive_menu', 'action.slot_menu'])('includes WhatsApp readiness for %s', async (type: string) => {
    validation.errors = []
    validation.issues = []
    seed('wf-menu-readiness')
    const response = await app.inject({ method: 'POST', url: '/clinics/c-1/workflows/wf-menu-readiness/diagnostics', headers: studioAuth,
      payload: { graph: { nodes: [{ id: 'menu-1', kind: 'action', type, config: {}, x: 0, y: 0 }], edges: [] }, simulation: { enabled: false } } })
    expect(response.statusCode).toBe(200)
    expect(response.json().diagnostic.integrations).toContainEqual(expect.objectContaining({ key: 'whatsapp', status: 'unknown' }))
  })

  it('validates simulator bounds and the editor graph before execution', async () => {
    validation.errors = []
    validation.issues = []
    seed('wf-invalid-sim')
    const badInput = await app.inject({ method: 'POST', url: '/clinics/c-1/workflows/wf-invalid-sim/simulate', headers: adminAuth, payload: { input: { maxSteps: 0 } } })
    expect(badInput.statusCode).toBe(400)
    expect(badInput.json().error).toBe('Validation failed')

    validation.errors = ['Missing trigger']
    validation.issues = [{ code: 'missing_trigger', title: 'Add a trigger' }]
    const badGraph = await app.inject({ method: 'POST', url: '/clinics/c-1/workflows/wf-invalid-sim/simulate', headers: adminAuth, payload: { graph: { nodes: [], edges: [] } } })
    expect(badGraph.statusCode).toBe(400)
    expect(badGraph.json()).toMatchObject({ error: 'Invalid workflow graph', details: ['Missing trigger'] })
  })

  it('round-trips a long message replay through the endpoint without losing edge evidence', async () => {
    validation.errors = []
    validation.issues = []
    seed('wf-roundtrip')
    const graph = {
      nodes: [
        { id: 'start', kind: 'trigger', type: 'trigger.message_keyword', config: {}, x: 0, y: 0 },
        { id: 'send', kind: 'action', type: 'action.send_message', config: { text: 'x'.repeat(900) }, x: 0, y: 0 },
        { id: 'wait', kind: 'logic', type: 'logic.wait_for_reply', config: {}, x: 0, y: 0 },
        { id: 'end', kind: 'action', type: 'action.end', config: {}, x: 0, y: 0 },
      ],
      edges: [{ id: 'a', source: 'start', target: 'send' }, { id: 'b', source: 'send', target: 'wait' }, { id: 'c', source: 'wait', target: 'end' }],
    }
    const post = (input: unknown) => app.inject({ method: 'POST', url: '/clinics/c-1/workflows/wf-roundtrip/simulate', headers: adminAuth, payload: { graph, input } })
    const first = await post({})
    expect(first.statusCode).toBe(200)
    expect(first.json().simulation.replay.effects[0].summary.length).toBeLessThanOrEqual(500)
    const next = await post({ replay: first.json().simulation.replay, reply: { text: 'continue' } })
    expect(next.statusCode).toBe(200)
    expect(next.json().simulation.status).toBe('completed')
    expect(next.json().simulation.coverage.testedEdgeIds).toEqual(['a', 'b', 'c'])
  })

  it('returns an explicit cumulative replay budget outcome through repeated API segments', async () => {
    validation.errors = []
    validation.issues = []
    seed('wf-budget')
    const graph = {
      nodes: [{ id: 'start', kind: 'trigger', type: 'trigger.message_keyword', config: {}, x: 0, y: 0 }, { id: 'wait', kind: 'logic', type: 'logic.wait_for_reply', config: {}, x: 0, y: 0 }],
      edges: [{ id: 'a', source: 'start', target: 'wait' }, { id: 'b', source: 'wait', target: 'wait' }],
    }
    let replay: unknown
    let result
    for (let i = 0; i < 105; i++) {
      const response = await app.inject({ method: 'POST', url: '/clinics/c-1/workflows/wf-budget/simulate', headers: adminAuth, payload: { graph, input: { replay, reply: { text: 'again' } } } })
      expect(response.statusCode).toBe(200)
      result = response.json().simulation
      replay = result.replay
      if (!replay) break
    }
    expect(result.status).toBe('failed')
    expect(result.trace).toHaveLength(100)
    expect(result.errors[0]).toMatchObject({ code: 'step_limit', howToFix: expect.stringMatching(/reset/i) })
    expect(replay).toBeUndefined()
  })
})
