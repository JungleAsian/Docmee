import { describe, it, expect, vi } from 'vitest'
import { runWorkflow, type WorkflowExecutors } from '../workflows/workflow-engine.js'
import type { WorkflowNode, WorkflowEdge } from '@docmee/db'

const node = (
  id: string,
  kind: WorkflowNode['kind'],
  type: string,
  config: Record<string, unknown> = {},
): WorkflowNode => ({ id, kind, type, config, x: 0, y: 0 })

const edge = (source: string, target: string, sourceHandle?: string): WorkflowEdge => ({
  id: `${source}-${target}-${sourceHandle ?? ''}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
})

function makeExec(over: Partial<WorkflowExecutors> = {}): WorkflowExecutors {
  return {
    sendMessage: vi.fn(),
    sendTemplate: vi.fn(),
    notifySecretary: vi.fn(),
    addTag: vi.fn(),
    aiDraft: vi.fn(),
    requestApproval: vi.fn(),
    scheduleResume: vi.fn(),
    ...over,
  }
}

describe('runWorkflow', () => {
  it('routes each action through the worker-owned durable side-effect boundary', async () => {
    const guarded = vi.fn(async (_node, _ctx, invoke) => invoke())
    const exec = makeExec({ runSideEffect: guarded })
    await runWorkflow({
      nodes: [node('t', 'trigger', 'trigger.message_keyword'), node('send', 'action', 'action.send_message')],
      edges: [edge('t', 'send')],
    }, {}, exec)
    expect(guarded).toHaveBeenCalledTimes(1)
    expect(guarded.mock.calls[0]?.[0]).toMatchObject({ id: 'send', type: 'action.send_message' })
  })
  it('walks a linear trigger → action → end and runs the action', async () => {
    const wf = {
      nodes: [
        node('t', 'trigger', 'trigger.no_show'),
        node('s', 'action', 'action.send_message', { text: 'Hi' }),
        node('e', 'action', 'action.end'),
      ],
      edges: [edge('t', 's'), edge('s', 'e')],
    }
    const exec = makeExec()
    const trace = await runWorkflow(wf, {}, exec)
    expect(exec.sendMessage).toHaveBeenCalledWith('Hi', {})
    expect(trace.map((s) => s.status)).toEqual(['ran', 'ran', 'ended'])
  })

  it('routes a condition node down its true / false branch', async () => {
    const wf = {
      nodes: [
        node('t', 'trigger', 'trigger.message_keyword'),
        node('c', 'logic', 'logic.condition', { field: 'message', op: 'contains', value: 'urgent' }),
        node('a', 'action', 'action.notify_secretary'),
        node('b', 'action', 'action.add_tag', { tag: 'normal' }),
      ],
      edges: [edge('t', 'c'), edge('c', 'a', 'true'), edge('c', 'b', 'false')],
    }

    const yes = makeExec()
    await runWorkflow(wf, { message: 'this is URGENT' }, yes)
    expect(yes.notifySecretary).toHaveBeenCalled()
    expect(yes.addTag).not.toHaveBeenCalled()

    const no = makeExec()
    await runWorkflow(wf, { message: 'routine question' }, no)
    expect(no.addTag).toHaveBeenCalledWith('normal', { message: 'routine question' })
    expect(no.notifySecretary).not.toHaveBeenCalled()
  })

  it('routes AI confidence through explicit high, low, and error handles', async () => {
    const wf = {
      nodes: [
        node('t', 'trigger', 'trigger.message_keyword'),
        node('classify', 'logic', 'logic.ai_classify_intent'),
        node('high', 'action', 'action.add_tag', { tag: 'high' }),
        node('low', 'action', 'action.add_tag', { tag: 'low' }),
        node('error', 'action', 'action.add_tag', { tag: 'error' }),
      ],
      edges: [edge('t', 'classify'), edge('classify', 'high', 'high'), edge('classify', 'low', 'low'), edge('classify', 'error', 'error')],
    }
    for (const route of ['high', 'low', 'error'] as const) {
      const exec = makeExec({ classifyIntentConfidence: vi.fn(async () => route) })
      await runWorkflow(wf, {}, exec)
      expect(exec.addTag).toHaveBeenCalledWith(route, expect.any(Object))
    }
  })

  it('pauses at a delay node and resumes at the next node', async () => {
    const wf = {
      nodes: [
        node('t', 'trigger', 'trigger.appointment_booked'),
        node('d', 'logic', 'logic.delay', { amount: 2, unit: 'hour' }),
        node('s', 'action', 'action.send_message', { text: 'later' }),
      ],
      edges: [edge('t', 'd'), edge('d', 's')],
    }
    const exec = makeExec()
    const trace = await runWorkflow(wf, {}, exec)
    expect(exec.scheduleResume).toHaveBeenCalledWith('s', 2 * 3_600_000, {})
    expect(exec.sendMessage).not.toHaveBeenCalled()
    expect(trace.at(-1)?.status).toBe('paused')

    const resume = makeExec()
    await runWorkflow(wf, {}, resume, { startNodeId: 's' })
    expect(resume.sendMessage).toHaveBeenCalledWith('later', {})
  })

  it('pauses at an approval node without running downstream actions', async () => {
    const wf = {
      nodes: [
        node('t', 'trigger', 'trigger.patient_upset'),
        node('ap', 'action', 'action.approval'),
        node('s', 'action', 'action.send_message', { text: 'sorry' }),
      ],
      edges: [edge('t', 'ap'), edge('ap', 's')],
    }
    const exec = makeExec()
    const trace = await runWorkflow(wf, {}, exec)
    expect(exec.requestApproval).toHaveBeenCalled()
    expect(exec.sendMessage).not.toHaveBeenCalled()
    expect(trace.at(-1)?.status).toBe('paused')
  })

  it('runs calendar-native booking nodes with the shared mutable context', async () => {
    const wf = {
      nodes: [
        node('t', 'trigger', 'trigger.message_keyword'),
        node('check', 'action', 'action.check_availability'),
        node('offer', 'action', 'action.offer_slots'),
        node('book', 'action', 'action.create_or_reschedule_booking'),
      ],
      edges: [edge('t', 'check'), edge('check', 'offer'), edge('offer', 'book')],
    }
    const ctx = { preferred_date: '2026-07-21' }
    const exec = makeExec({
      checkAvailability: vi.fn(async (_node, shared) => {
        shared['available_slots'] = [{ start: '2026-07-21T09:00:00', end: '2026-07-21T09:30:00' }]
      }),
      offerSlots: vi.fn(),
      createOrRescheduleBooking: vi.fn(),
    })

    await runWorkflow(wf, ctx, exec)

    expect(exec.checkAvailability).toHaveBeenCalledWith(wf.nodes[1], ctx)
    expect(exec.offerSlots).toHaveBeenCalledWith(wf.nodes[2], ctx)
    expect(exec.createOrRescheduleBooking).toHaveBeenCalledWith(wf.nodes[3], ctx)
  })

  it('runs guided interactive booking nodes before appointment creation', async () => {
    const wf = {
      nodes: [
        node('t', 'trigger', 'trigger.message_keyword'),
        node('doctors', 'action', 'action.interactive_menu', { menuType: 'doctor' }),
        node('services', 'action', 'action.interactive_menu', { menuType: 'service' }),
        node('slots', 'action', 'action.available_slots'),
        node('days', 'action', 'action.interactive_menu', { menuType: 'date' }),
        node('times', 'action', 'action.interactive_menu', { menuType: 'time_slot' }),
        node('revalidate', 'action', 'action.revalidate_slot'),
        node('confirm', 'action', 'action.interactive_menu', { menuType: 'confirm' }),
        node('book', 'action', 'action.create_or_reschedule_booking'),
      ],
      edges: [
        edge('t', 'doctors'),
        edge('doctors', 'services'),
        edge('services', 'slots'),
        edge('slots', 'days'),
        edge('days', 'times'),
        edge('times', 'revalidate'),
        edge('revalidate', 'confirm'),
        edge('confirm', 'book'),
      ],
    }
    const order: string[] = []
    const ctx = { clinicId: 'clinic_1' }
    const exec = makeExec({
      interactiveMenu: vi.fn(async (current, shared) => {
        order.push(`${current.id}:${String(current.config?.['menuType'] ?? '')}`)
        shared['last_menu'] = current.id
      }),
      availableSlots: vi.fn(async (_current, shared) => {
        order.push('slots')
        shared['available_slots'] = [{ bookingKey: 'slot_1' }]
      }),
      revalidateSlot: vi.fn(async (_current, shared) => {
        order.push('revalidate')
        shared['slot_revalidation_status'] = 'available'
      }),
      createOrRescheduleBooking: vi.fn(async () => {
        order.push('book')
      }),
    })

    await runWorkflow(wf, ctx, exec)

    expect(order).toEqual([
      'doctors:doctor',
      'services:service',
      'slots',
      'days:date',
      'times:time_slot',
      'revalidate',
      'confirm:confirm',
      'book',
    ])
    expect(exec.createOrRescheduleBooking).toHaveBeenCalledWith(wf.nodes[8], expect.objectContaining({
      available_slots: [{ bookingKey: 'slot_1' }],
      slot_revalidation_status: 'available',
    }))
  })

  it('routes an interactive menu reply through the selected option handle', async () => {
    const wf = {
      nodes: [
        node('t', 'trigger', 'trigger.message_keyword'),
        node('menu', 'action', 'action.interactive_menu', { selectionField: 'workflow_selection_id' }),
        node('hours', 'action', 'action.send_message', { text: 'Clinic hours' }),
        node('booking', 'action', 'action.send_message', { text: 'Booking flow' }),
        node('secretary', 'action', 'action.notify_secretary'),
      ],
      edges: [
        edge('t', 'menu'),
        edge('menu', 'hours', 'clinic_hours'),
        edge('menu', 'booking', 'book_appointment'),
        edge('menu', 'secretary', 'secretary'),
      ],
    }
    const ctx = { workflow_selection_id: '' }
    const exec = makeExec({
      interactiveMenu: vi.fn(async (_node, shared) => {
        shared['workflow_selection_id'] = 'book_appointment'
      }),
    })

    await runWorkflow(wf, ctx, exec)

    expect(exec.sendMessage).toHaveBeenCalledWith('Booking flow', expect.objectContaining({ workflow_selection_id: 'book_appointment' }))
    expect(exec.sendMessage).not.toHaveBeenCalledWith('Clinic hours', expect.any(Object))
    expect(exec.notifySecretary).not.toHaveBeenCalled()
  })

  it('asks, persists at wait, then resumes after a captured reply', async () => {
    const wf = {
      nodes: [
        node('t', 'trigger', 'trigger.message_keyword'),
        node('ask', 'action', 'action.ask_capture', { field: 'preferred_date' }),
        node('wait', 'logic', 'logic.wait_for_reply'),
        node('done', 'action', 'action.send_message', { text: 'Thanks' }),
      ],
      edges: [edge('t', 'ask'), edge('ask', 'wait'), edge('wait', 'done')],
    }
    const first = makeExec({
      askAndCapture: vi.fn(async (_node, ctx) => {
        ctx['__workflowCapture'] = { nodeId: 'ask', status: 'pending' }
      }),
      waitForReply: vi.fn(async () => true),
    })
    const firstTrace = await runWorkflow(wf, {}, first)
    expect(firstTrace.at(-1)).toEqual({ nodeId: 'wait', type: 'logic.wait_for_reply', status: 'paused' })
    expect(first.sendMessage).not.toHaveBeenCalled()

    const resumed = makeExec({
      askAndCapture: vi.fn(async (_node, ctx) => {
        ctx['preferred_date'] = String(ctx.message)
        ctx['__workflowCapture'] = { nodeId: 'ask', status: 'captured' }
      }),
      waitForReply: vi.fn(async () => false),
    })
    const context = { message: '2026-07-22' }
    await runWorkflow(wf, context, resumed, { startNodeId: 'ask' })
    expect(resumed.sendMessage).toHaveBeenCalledWith('Thanks', expect.objectContaining({ preferred_date: '2026-07-22' }))
  })

  it('terminates on a cyclic graph instead of looping forever', async () => {
    const wf = {
      nodes: [node('t', 'trigger', 'trigger.no_show'), node('a', 'action', 'action.notify_secretary')],
      edges: [edge('t', 'a'), edge('a', 't')],
    }
    const exec = makeExec()
    const trace = await runWorkflow(wf, {}, exec)
    expect(trace.length).toBeLessThan(5)
    expect(exec.notifySecretary).toHaveBeenCalledTimes(1)
  })

  it('returns an empty trace when there is no trigger', async () => {
    const wf = { nodes: [node('s', 'action', 'action.send_message', { text: 'x' })], edges: [] }
    const exec = makeExec()
    const trace = await runWorkflow(wf, {}, exec)
    expect(trace).toEqual([])
    expect(exec.sendMessage).not.toHaveBeenCalled()
  })
})
