import { describe, expect, it } from 'vitest'
import { simulateWorkflow } from '../workflows/workflow-simulator.js'
import type { WorkflowEdge, WorkflowNode } from '@docmee/db'

const node = (id: string, kind: WorkflowNode['kind'], type: string, config: Record<string, unknown> = {}): WorkflowNode => ({ id, kind, type, config, x: 0, y: 0 })
const edge = (source: string, target: string, sourceHandle?: string): WorkflowEdge => ({ id: `${source}-${target}-${sourceHandle ?? 'next'}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) })

describe('simulateWorkflow', () => {
  it('keeps invalid captures waiting without claiming the outgoing edge was tested', async () => {
    const workflow = { nodes: [node('start', 'trigger', 'trigger.message_keyword'), node('ask', 'action', 'action.ask_capture', { field: 'name', validation: 'required' }), node('wait', 'logic', 'logic.wait_for_reply'), node('end', 'action', 'action.end')], edges: [edge('start', 'ask'), edge('ask', 'wait'), edge('wait', 'end')] }
    const first = await simulateWorkflow(workflow)
    const result = await simulateWorkflow(workflow, { replay: first.replay, reply: { text: '' } })
    expect(result.status).toBe('waiting')
    expect(result.coverage.testedEdgeIds).not.toContain('wait-end-next')
    const failed = await simulateWorkflow(workflow, { scenarios: { providerOutcomes: { 'action.ask_capture': 'failure' } } })
    expect(failed.errors[0]?.code).toBe('mock_provider_failure')
  })
  it('stores a dynamic menu selection and its label', async () => {
    const workflow = { nodes: [node('start', 'trigger', 'trigger.message_keyword'), node('menu', 'action', 'action.interactive_menu', { optionSource: 'clinic_doctors', field: 'doctor_id' }), node('end', 'action', 'action.end')], edges: [edge('start', 'menu'), edge('menu', 'end', 'selected')] }
    const first = await simulateWorkflow(workflow)
    const result = await simulateWorkflow(workflow, { replay: first.replay, reply: { optionId: 'mock-doctor-1' } })
    expect(result.status).toBe('completed')
    expect(result.context.doctor_id).toBe('mock-doctor-1')
    expect(result.context.doctor_id_label).toBe('Mock doctor')
  })
  it('rejects invalid slot replies and stores valid dates in the configured field', async () => {
    const workflow = { nodes: [node('start', 'trigger', 'trigger.message_keyword'), node('availability', 'action', 'action.check_availability', { slotsField: 'slots' }), node('menu', 'action', 'action.offer_slot_menu', { slotsField: 'slots', selectField: 'date' }), node('end', 'action', 'action.end')], edges: [edge('start', 'availability'), edge('availability', 'menu'), edge('menu', 'end', 'selected')] }
    const first = await simulateWorkflow(workflow)
    expect(first.context.availability_count).toBe(1)
    expect(first.context.slots).toEqual([{ start: '2030-01-01T10:00:00Z', end: '2030-01-01T10:30:00.000Z' }])
    const invalid = await simulateWorkflow(workflow, { replay: first.replay, reply: { optionId: 'invalid' } })
    expect(invalid.status).toBe('waiting')
    const result = await simulateWorkflow(workflow, { replay: invalid.replay, reply: { optionId: '2030-01-01' } })
    expect(result.status).toBe('completed')
    expect(result.context.date).toBe('2030-01-01')
  })
  it('does not claim completion when the engine cycle guard stops execution', async () => {
    const workflow = { nodes: [node('start', 'trigger', 'trigger.message_keyword'), node('send', 'action', 'action.send_message')], edges: [edge('start', 'send'), edge('send', 'send')] }
    const result = await simulateWorkflow(workflow)
    expect(result.status).toBe('failed')
    expect(result.errors[0]?.code).toBe('simulation_error')
  })
  it('captures a validated reply before evaluating the following condition', async () => {
    const workflow = { nodes: [node('start', 'trigger', 'trigger.message_keyword'), node('ask', 'action', 'action.ask_capture', { field: 'name', validation: 'required' }), node('wait', 'logic', 'logic.wait_for_reply'), node('branch', 'logic', 'logic.condition', { field: 'name', value: 'Alice' }), node('yes', 'action', 'action.end'), node('no', 'action', 'action.end')], edges: [edge('start', 'ask'), edge('ask', 'wait'), edge('wait', 'branch'), edge('branch', 'yes', 'true'), edge('branch', 'no', 'false')] }
    const first = await simulateWorkflow(workflow)
    const result = await simulateWorkflow(workflow, { replay: first.replay, reply: { text: 'Alice' } })
    expect(result.context.name).toBe('Alice')
    expect(result.trace.at(-1)?.nodeId).toBe('yes')
    expect(result.status).toBe('completed')
  })
  it.each(['false', 'low', 'error', 'routed'] as const)('keeps Step equivalent to Run for %s routing', async (outcome) => {
    const type = outcome === 'false' ? 'logic.condition' : outcome === 'routed' ? 'action.ai_agent' : 'logic.ai_classify_intent'
    const workflow = {
      nodes: [node('start', 'trigger', 'trigger.message_keyword'), node('branch', outcome === 'routed' ? 'action' : 'logic', type, { field: 'tier', value: 'vip' }), node('wrong', 'action', 'action.end'), node('right', 'action', 'action.end')],
      edges: [edge('start', 'branch'), edge('branch', 'wrong', 'true'), edge('branch', 'right', outcome)],
    }
    const scenarios = outcome === 'routed' ? { aiAgentOutcome: outcome } : outcome === 'false' ? {} : { intentOutcome: outcome }
    const run = await simulateWorkflow(workflow, { scenarios })
    let step = await simulateWorkflow(workflow, { maxSteps: 1, scenarios })
    for (let i = 0; step.replay && i < 5; i++) step = await simulateWorkflow(workflow, { replay: step.replay, maxSteps: 1, scenarios })
    expect(step.status).toBe('completed')
    expect(step.trace).toEqual(run.trace)
    expect(step.coverage).toEqual(run.coverage)
    expect(step.trace.at(-1)?.nodeId).toBe(outcome === 'routed' ? 'branch' : 'right')
  })

  it('keeps menu reply Step equivalent to Run and counts only the selected parallel edge', async () => {
    const workflow = {
      nodes: [node('start', 'trigger', 'trigger.message_keyword'), node('menu', 'action', 'action.interactive_menu', { options: [{ optionId: 'a', title: 'A' }, { optionId: 'b', title: 'B' }] }), node('end', 'action', 'action.end')],
      edges: [edge('start', 'menu'), edge('menu', 'end', 'a'), edge('menu', 'end', 'b')],
    }
    const wait = await simulateWorkflow(workflow)
    const run = await simulateWorkflow(workflow, { replay: wait.replay, reply: { optionId: 'b' } })
    const bounded = await simulateWorkflow(workflow, { replay: wait.replay, reply: { optionId: 'b' }, maxSteps: 1 })
    const step = await simulateWorkflow(workflow, { replay: bounded.replay, maxSteps: 1 })
    expect(step.trace).toEqual(run.trace)
    expect(step.coverage.testedEdgeIds).toEqual(['start-menu-next', 'menu-end-b'])
    expect(step.coverage.untestedEdgeIds).toEqual(['menu-end-a'])
  })

  it('stops cumulative replay at a remediable budget rather than emitting an invalid cursor', async () => {
    const workflow = { nodes: [node('start', 'trigger', 'trigger.message_keyword'), node('wait', 'logic', 'logic.wait_for_reply')], edges: [edge('start', 'wait'), edge('wait', 'wait')] }
    let result = await simulateWorkflow(workflow)
    for (let i = 0; result.replay && i < 110; i++) result = await simulateWorkflow(workflow, { replay: result.replay, reply: { text: 'again' } })
    expect(result.status).toBe('failed')
    expect(result.errors[0]).toMatchObject({ code: 'step_limit', howToFix: expect.stringMatching(/reset/i) })
    expect(result.trace.length).toBeLessThanOrEqual(100)
    expect(result.replay).toBeUndefined()
  })

  it('bounds long message previews before returning a replay', async () => {
    const result = await simulateWorkflow({ nodes: [node('start', 'trigger', 'trigger.message_keyword'), node('send', 'action', 'action.send_message', { text: 'x'.repeat(900) }), node('wait', 'logic', 'logic.wait_for_reply'), node('end', 'action', 'action.end')], edges: [edge('start', 'send'), edge('send', 'wait'), edge('wait', 'end')] })
    expect(result.replay?.effects[0]?.summary.length).toBeLessThanOrEqual(500)
  })
  it('records mocked messages, branch trace, context snapshots, and coverage without external effects', async () => {
    const result = await simulateWorkflow({
      nodes: [
        node('start', 'trigger', 'trigger.message_keyword'),
        node('condition', 'logic', 'logic.condition', { field: 'tier', value: 'vip' }),
        node('vip', 'action', 'action.send_message', { text: 'Welcome VIP' }),
        node('standard', 'action', 'action.send_template', { category: 'general' }),
      ],
      edges: [edge('start', 'condition'), edge('condition', 'vip', 'true'), edge('condition', 'standard', 'false')],
    }, { context: { tier: 'vip' } })

    expect(result.status).toBe('completed')
    expect(result.trace.map((step) => step.nodeId)).toEqual(['start', 'condition', 'vip'])
    expect(result.effects).toEqual([{ nodeId: 'vip', kind: 'message', mocked: true, summary: 'Welcome VIP' }])
    expect(result.trace[2]?.context).toEqual({ tier: 'vip' })
    expect(result.coverage).toEqual({
      testedNodeIds: ['start', 'condition', 'vip'],
      untestedNodeIds: ['standard'],
      testedEdgeIds: ['start-condition-next', 'condition-vip-true'],
      untestedEdgeIds: ['condition-standard-false'],
    })
    expect(result.safety).toEqual({ isolated: true, externalCalls: 0, persistentWrites: 0, queuedJobs: 0 })
  })

  it('pauses for a reply and resumes from replay state with the supplied reply', async () => {
    const workflow = {
      nodes: [node('start', 'trigger', 'trigger.message_keyword'), node('wait', 'logic', 'logic.wait_for_reply'), node('send', 'action', 'action.send_message', { text: 'Thanks' })],
      edges: [edge('start', 'wait'), edge('wait', 'send')],
    }
    const waiting = await simulateWorkflow(workflow)
    expect(waiting.status).toBe('waiting')
    expect(waiting.waitingFor).toEqual({ kind: 'reply', nodeId: 'wait' })
    expect(waiting.replay?.startNodeId).toBe('send')

    const resumed = await simulateWorkflow(workflow, { replay: waiting.replay, reply: { text: 'Yes please' } })
    expect(resumed.status).toBe('completed')
    expect(resumed.context.message).toBe('Yes please')
    expect(resumed.trace.map((step) => step.nodeId)).toEqual(['start', 'wait', 'send'])
    expect(resumed.effects.at(-1)).toMatchObject({ nodeId: 'send', kind: 'message', mocked: true })
  })

  it('uses virtual time for delay nodes and refuses to resume before the delay has elapsed', async () => {
    const workflow = {
      nodes: [node('start', 'trigger', 'trigger.message_keyword'), node('delay', 'logic', 'logic.delay', { amount: 5, unit: 'minute' }), node('send', 'action', 'action.send_message')],
      edges: [edge('start', 'delay'), edge('delay', 'send')],
    }
    const waiting = await simulateWorkflow(workflow, { virtualNowMs: 1_000 })
    expect(waiting.waitingFor).toEqual({ kind: 'delay', nodeId: 'delay', remainingMs: 300_000, resumeAtMs: 301_000 })

    const early = await simulateWorkflow(workflow, { replay: waiting.replay, advanceTimeMs: 299_999 })
    expect(early.status).toBe('waiting')
    expect(early.waitingFor).toMatchObject({ kind: 'delay', remainingMs: 1 })

    const resumed = await simulateWorkflow(workflow, { replay: waiting.replay, advanceTimeMs: 300_000 })
    expect(resumed.status).toBe('completed')
    expect(resumed.virtualNowMs).toBe(301_000)
    expect(resumed.trace.at(-1)?.nodeId).toBe('send')
  })

  it.each(['approved', 'rejected', 'timeout'] as const)('routes a mocked %s approval outcome', async (approval) => {
    const workflow = {
      nodes: [node('start', 'trigger', 'trigger.message_keyword'), node('approval', 'action', 'action.approval'), node('approved', 'action', 'action.send_message'), node('rejected', 'action', 'action.notify_secretary'), node('timeout', 'action', 'action.send_template')],
      edges: [edge('start', 'approval'), edge('approval', 'approved', 'approved'), edge('approval', 'rejected', 'rejected'), edge('approval', 'timeout', 'timeout')],
    }
    const waiting = await simulateWorkflow(workflow)
    const resumed = await simulateWorkflow(workflow, { replay: waiting.replay, approval })
    expect(resumed.trace.at(-1)?.nodeId).toBe(approval)
    expect(resumed.context.approvalOutcome).toBe(approval)
  })

  it('returns a clickable, remediable error for a controlled provider failure', async () => {
    const result = await simulateWorkflow({ nodes: [node('start', 'trigger', 'trigger.message_keyword'), node('availability', 'action', 'action.check_availability')], edges: [edge('start', 'availability')] }, { scenarios: { providerOutcomes: { availability: 'failure' } } })
    expect(result.status).toBe('failed')
    expect(result.trace.map((step) => [step.nodeId, step.status])).toEqual([['start', 'ran'], ['availability', 'failed']])
    expect(result.coverage.testedNodeIds).toEqual(['start', 'availability'])
    expect(result.errors).toEqual([expect.objectContaining({ nodeId: 'availability', code: 'mock_provider_failure', howToFix: 'Choose a successful scenario or inspect the node’s provider error path.' })])
    expect(result.safety.externalCalls).toBe(0)
  })

  it('captures each step context at that moment and supports an empty availability outcome', async () => {
    const result = await simulateWorkflow({
      nodes: [node('start', 'trigger', 'trigger.message_keyword'), node('availability', 'action', 'action.check_availability'), node('slots', 'action', 'action.offer_slot_menu'), node('empty', 'action', 'action.send_message', { text: 'No appointments are available.' }), node('booking', 'action', 'action.create_or_reschedule_booking')],
      edges: [edge('start', 'availability'), edge('availability', 'slots'), edge('slots', 'empty', 'empty'), edge('slots', 'booking', 'selected')],
    }, { scenarios: { providerOutcomes: { availability: 'empty' } } })

    expect(result.status).toBe('completed')
    expect(result.trace[0]?.context).toEqual({})
    expect(result.trace[1]?.context).toEqual({ available_slots: [], availability_count: 0 })
    expect(result.trace.map((step) => step.nodeId)).toEqual(['start', 'availability', 'slots', 'empty'])
    expect(result.trace[2]?.context).toEqual({ available_slots: [], availability_count: 0 })
    expect(result.context.bookingStatus).toBeUndefined()
    expect(result.effects).not.toContainEqual(expect.objectContaining({ nodeId: 'slots', summary: 'Slot menu mocked' }))
    expect(result.effects).toContainEqual(expect.objectContaining({ nodeId: 'empty', summary: 'No appointments are available.' }))
  })

  it('keeps successful and failed steps when a retained provider scenario fails after a wait', async () => {
    const workflow = {
      nodes: [node('start', 'trigger', 'trigger.message_keyword'), node('wait', 'logic', 'logic.wait_for_reply'), node('availability', 'action', 'action.check_availability')],
      edges: [edge('start', 'wait'), edge('wait', 'availability')],
    }
    const waiting = await simulateWorkflow(workflow, { scenarios: { providerOutcomes: { availability: 'failure' } } })
    const resumed = await simulateWorkflow(workflow, { replay: waiting.replay, reply: { text: 'continue' }, scenarios: { providerOutcomes: { availability: 'failure' } } })

    expect(resumed.status).toBe('failed')
    expect(resumed.trace.map((step) => [step.nodeId, step.status])).toEqual([['start', 'ran'], ['wait', 'paused'], ['availability', 'failed']])
    expect(resumed.coverage.testedNodeIds).toEqual(['start', 'wait', 'availability'])
  })

  it.each([
    ['menu', 'action.interactive_menu', 'Interactive menu mocked'],
    ['slots', 'action.offer_slot_menu', 'Slot menu mocked'],
  ] as const)('attributes mocked %s effects to the active node', async (id, type, summary) => {
    const result = await simulateWorkflow({ nodes: [node('start', 'trigger', 'trigger.message_keyword'), node(id, 'action', type)], edges: [edge('start', id)] }, { context: { available_slots: [{ start: '2030-01-01T10:00:00Z', end: '2030-01-01T10:30:00Z' }] } })
    expect(result.effects).toContainEqual({ nodeId: id, kind: 'message', mocked: true, summary: expect.stringContaining(summary) })
  })

  it('makes unsupported nodes explicit and enforces the requested step bound', async () => {
    const unsupported = await simulateWorkflow({ nodes: [node('start', 'trigger', 'trigger.message_keyword'), node('mystery', 'action', 'action.future')], edges: [edge('start', 'mystery')] })
    expect(unsupported.status).toBe('failed')
    expect(unsupported.errors[0]).toMatchObject({ nodeId: 'mystery', code: 'unsupported_node' })

    const bounded = await simulateWorkflow({ nodes: [node('start', 'trigger', 'trigger.message_keyword'), node('one', 'action', 'action.send_message'), node('two', 'action', 'action.send_message')], edges: [edge('start', 'one'), edge('one', 'two')] }, { maxSteps: 1 })
    expect(bounded.status).toBe('paused')
    expect(bounded.trace).toHaveLength(1)
    expect(bounded.replay?.startNodeId).toBe('one')
  })
})
