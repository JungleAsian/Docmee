import { describe, it, expect, vi } from 'vitest'
import {
  runWorkflow,
  resolveMenuHandle,
  parseMenuOptions,
  type WorkflowExecutors,
  type WorkflowMenuOption,
} from '../workflows/workflow-engine.js'
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

  it('check_availability deliberately bypasses the durable side-effect boundary (it only reads Google Calendar)', async () => {
    // Regression guard: wrapping this node the same way as genuine side
    // effects (send/book/tag) meant one interrupted attempt permanently
    // poisoned that execution key — every retry hit "uncertain prior
    // provider outcome" and never got to actually check availability again.
    const guarded = vi.fn(async (_node, _ctx, invoke) => invoke())
    const checkAvailability = vi.fn()
    const exec = makeExec({ runSideEffect: guarded, checkAvailability })
    await runWorkflow({
      nodes: [node('t', 'trigger', 'trigger.message_keyword'), node('check', 'action', 'action.check_availability')],
      edges: [edge('t', 'check')],
    }, {}, exec)
    expect(checkAvailability).toHaveBeenCalledTimes(1)
    expect(guarded).not.toHaveBeenCalled()
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

describe('interactive_menu — resolveMenuHandle', () => {
  const opts: WorkflowMenuOption[] = [
    { optionId: 'book_appt', title: 'Book an appointment' },
    { optionId: 'location', title: 'Location & Hours' },
    { optionId: 'inquiry', title: 'General Inquiry' },
  ]

  it('reserves footer 0 → restart and 1 → livechat', () => {
    expect(resolveMenuHandle(opts, undefined, '0')).toBe('restart')
    expect(resolveMenuHandle(opts, undefined, '1')).toBe('livechat')
  })
  it('matches a tapped interactive reply id exactly', () => {
    expect(resolveMenuHandle(opts, 'inquiry', 'anything')).toBe('inquiry')
  })
  it('falls back to a 1-based numeric index for typed replies', () => {
    expect(resolveMenuHandle(opts, undefined, '2')).toBe('location')
  })
  it('falls back to a case-insensitive title match', () => {
    expect(resolveMenuHandle(opts, undefined, 'book an APPOINTMENT')).toBe('book_appt')
  })
  it('routes anything unrecognized to default', () => {
    expect(resolveMenuHandle(opts, 'stale_id', 'blah blah')).toBe('default')
  })
})

describe('interactive_menu — parseMenuOptions', () => {
  it('parses a JSON-string options config', () => {
    const parsed = parseMenuOptions({ options: JSON.stringify([{ optionId: 'a', title: 'A' }]) })
    expect(parsed).toEqual([{ optionId: 'a', title: 'A' }])
  })
  it('accepts an already-array config and drops malformed entries', () => {
    const parsed = parseMenuOptions({ options: [{ optionId: 'a', title: 'A' }, { bad: true }] as unknown[] })
    expect(parsed).toEqual([{ optionId: 'a', title: 'A' }])
  })
  it('returns [] for absent or unparseable options', () => {
    expect(parseMenuOptions({})).toEqual([])
    expect(parseMenuOptions({ options: 'not json' })).toEqual([])
  })
})

describe('runWorkflow — interactive_menu node', () => {
  const menuConfig = {
    variant: 'list',
    header: 'Welcome',
    message: 'Choose an option',
    options: JSON.stringify([
      { optionId: 'book_appt', title: 'Book an appointment' },
      { optionId: 'inquiry', title: 'General Inquiry' },
    ]),
  }
  const wf = {
    nodes: [
      node('t', 'trigger', 'trigger.message_keyword'),
      node('menu', 'action', 'action.interactive_menu', menuConfig),
      node('book', 'action', 'action.send_message', { text: 'Booking...' }),
      node('inq', 'action', 'action.ai_draft', { prompt: 'answer' }),
      node('restart', 'action', 'action.send_message', { text: 'Back to menu' }),
      node('human', 'action', 'action.notify_secretary'),
      node('fallback', 'action', 'action.send_message', { text: 'Sorry, please choose again' }),
    ],
    edges: [
      edge('t', 'menu'),
      edge('menu', 'book', 'book_appt'),
      edge('menu', 'inq', 'inquiry'),
      edge('menu', 'restart', 'restart'),
      edge('menu', 'human', 'livechat'),
      edge('menu', 'fallback', 'default'),
    ],
  }

  it('sends the menu and pauses on first arrival', async () => {
    const send = vi.fn(async () => true)
    const exec = makeExec({ sendInteractiveMenu: send })
    const trace = await runWorkflow(wf, {}, exec)
    expect(send).toHaveBeenCalledTimes(1)
    expect(trace.at(-1)).toEqual({ nodeId: 'menu', type: 'action.interactive_menu', status: 'paused' })
    expect(exec.sendMessage).not.toHaveBeenCalled()
  })

  it('resumes and routes out of the matched option handle', async () => {
    const exec = makeExec({ matchMenuReply: vi.fn(async () => 'book_appt') })
    const ctx = { workflowMenu: { nodeId: 'menu', status: 'pending' }, message: 'Book an appointment' }
    await runWorkflow(wf, ctx, exec, { startNodeId: 'menu' })
    expect(exec.sendMessage).toHaveBeenCalledWith('Booking...', expect.any(Object))
    // menu state was cleared after routing
    expect((ctx as Record<string, unknown>)['workflowMenu']).toBeUndefined()
  })

  it('routes an unrecognized reply out of the default handle', async () => {
    const exec = makeExec({ matchMenuReply: vi.fn(async () => 'default') })
    const ctx = { workflowMenu: { nodeId: 'menu', status: 'pending' }, message: 'gibberish' }
    await runWorkflow(wf, ctx, exec, { startNodeId: 'menu' })
    expect(exec.sendMessage).toHaveBeenCalledWith('Sorry, please choose again', expect.any(Object))
  })

  it('routes footer restart / livechat handles', async () => {
    const restart = makeExec({ matchMenuReply: vi.fn(async () => 'restart') })
    await runWorkflow(wf, { workflowMenu: { nodeId: 'menu', status: 'pending' }, message: '0' }, restart, { startNodeId: 'menu' })
    expect(restart.sendMessage).toHaveBeenCalledWith('Back to menu', expect.any(Object))

    const human = makeExec({ matchMenuReply: vi.fn(async () => 'livechat') })
    await runWorkflow(wf, { workflowMenu: { nodeId: 'menu', status: 'pending' }, message: '1' }, human, { startNodeId: 'menu' })
    expect(human.notifySecretary).toHaveBeenCalled()
  })

  it('falls through default when it cannot pause (no executor)', async () => {
    const exec = makeExec()
    await runWorkflow(wf, {}, exec)
    expect(exec.sendMessage).toHaveBeenCalledWith('Sorry, please choose again', expect.any(Object))
  })

  it('menu context key survives the postgres camel-case JSON transform', async () => {
    // Regression: conversation metadata round-trips through postgres.js
    // `transform: postgres.camel`, which rewrites JSON keys. A leading-
    // underscore key (`__workflowMenu` → `_WorkflowMenu`) lost the pending
    // menu state on resume and the menu was re-sent instead of routing.
    const { WORKFLOW_MENU_CONTEXT_KEY } = await import('../workflows/workflow-engine.js')
    expect(WORKFLOW_MENU_CONTEXT_KEY).toMatch(/^[a-z][a-zA-Z0-9]*$/)
  })
})

describe('runWorkflow — action.offer_slot_menu node', () => {
  const wf = {
    nodes: [
      node('t', 'trigger', 'trigger.message_keyword'),
      node('slots', 'action', 'action.offer_slot_menu', { pickerMode: 'date' }),
      node('picked', 'action', 'action.send_message', { text: 'Got your date' }),
      node('none', 'action', 'action.send_message', { text: 'Nothing available' }),
      node('restart', 'action', 'action.send_message', { text: 'Back to menu' }),
      node('human', 'action', 'action.notify_secretary'),
    ],
    edges: [
      edge('t', 'slots'),
      edge('slots', 'picked', 'selected'),
      edge('slots', 'none', 'empty'),
      edge('slots', 'restart', 'restart'),
      edge('slots', 'human', 'livechat'),
    ],
  }

  it('sends page 0 and pauses on first arrival', async () => {
    const send = vi.fn(async () => true)
    const exec = makeExec({ sendSlotMenu: send })
    const trace = await runWorkflow(wf, {}, exec)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: 'slots' }), expect.any(Object), 0)
    expect(trace.at(-1)).toEqual({ nodeId: 'slots', type: 'action.offer_slot_menu', status: 'paused' })
    expect(exec.sendMessage).not.toHaveBeenCalled()
  })

  it('routes out the selected handle and clears the pending state', async () => {
    const exec = makeExec({ matchSlotMenuReply: vi.fn(async () => 'selected') })
    const ctx = { workflowSlotMenu: { nodeId: 'slots', page: 0, status: 'pending' }, message: '1' }
    await runWorkflow(wf, ctx, exec, { startNodeId: 'slots' })
    expect(exec.sendMessage).toHaveBeenCalledWith('Got your date', expect.any(Object))
    expect((ctx as Record<string, unknown>)['workflowSlotMenu']).toBeUndefined()
  })

  it('routes out the empty handle when nothing is available', async () => {
    const exec = makeExec({ matchSlotMenuReply: vi.fn(async () => 'empty') })
    const ctx = { workflowSlotMenu: { nodeId: 'slots', page: 0, status: 'pending' }, message: 'anything' }
    await runWorkflow(wf, ctx, exec, { startNodeId: 'slots' })
    expect(exec.sendMessage).toHaveBeenCalledWith('Nothing available', expect.any(Object))
  })

  it('routes footer restart / livechat handles', async () => {
    const restart = makeExec({ matchSlotMenuReply: vi.fn(async () => 'restart') })
    await runWorkflow(wf, { workflowSlotMenu: { nodeId: 'slots', page: 0, status: 'pending' }, message: '0' }, restart, {
      startNodeId: 'slots',
    })
    expect(restart.sendMessage).toHaveBeenCalledWith('Back to menu', expect.any(Object))

    const human = makeExec({ matchSlotMenuReply: vi.fn(async () => 'livechat') })
    await runWorkflow(wf, { workflowSlotMenu: { nodeId: 'slots', page: 0, status: 'pending' }, message: '1' }, human, {
      startNodeId: 'slots',
    })
    expect(human.notifySecretary).toHaveBeenCalled()
  })

  it('"more" re-sends the same node at the next page instead of routing through an edge', async () => {
    const send = vi.fn(async () => true)
    const exec = makeExec({ matchSlotMenuReply: vi.fn(async () => 'more'), sendSlotMenu: send })
    const ctx = { workflowSlotMenu: { nodeId: 'slots', page: 0, status: 'pending' }, interactiveReplyId: '__more__' }
    const trace = await runWorkflow(wf, ctx, exec, { startNodeId: 'slots' })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: 'slots' }), expect.any(Object), 1)
    expect(trace.at(-1)).toEqual({ nodeId: 'slots', type: 'action.offer_slot_menu', status: 'paused' })
    expect(exec.sendMessage).not.toHaveBeenCalled()
  })

  it('an unmatched reply re-sends the same page rather than dead-ending', async () => {
    const send = vi.fn(async () => true)
    const exec = makeExec({ matchSlotMenuReply: vi.fn(async () => 'default'), sendSlotMenu: send })
    const ctx = { workflowSlotMenu: { nodeId: 'slots', page: 2, status: 'pending' }, message: 'gibberish' }
    const trace = await runWorkflow(wf, ctx, exec, { startNodeId: 'slots' })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: 'slots' }), expect.any(Object), 2)
    expect(trace.at(-1)).toEqual({ nodeId: 'slots', type: 'action.offer_slot_menu', status: 'paused' })
  })

  it('falls through the empty handle when it cannot pause (no executor)', async () => {
    const exec = makeExec()
    await runWorkflow(wf, {}, exec)
    expect(exec.sendMessage).toHaveBeenCalledWith('Nothing available', expect.any(Object))
  })

  it('falls through the empty handle when a re-send (more/default) cannot pause', async () => {
    const exec = makeExec({ matchSlotMenuReply: vi.fn(async () => 'more'), sendSlotMenu: vi.fn(async () => false) })
    const ctx = { workflowSlotMenu: { nodeId: 'slots', page: 0, status: 'pending' }, interactiveReplyId: '__more__' }
    await runWorkflow(wf, ctx, exec, { startNodeId: 'slots' })
    expect(exec.sendMessage).toHaveBeenCalledWith('Nothing available', expect.any(Object))
  })

  it('slot menu context key survives the postgres camel-case JSON transform', async () => {
    const { WORKFLOW_SLOT_MENU_CONTEXT_KEY } = await import('../workflows/workflow-engine.js')
    expect(WORKFLOW_SLOT_MENU_CONTEXT_KEY).toMatch(/^[a-z][a-zA-Z0-9]*$/)
  })
})

describe('runWorkflow — action.ai_draft node', () => {
  it('passes the full node (not just its prompt) so executors can read queryLimit/responseBuffer', async () => {
    const aiDraft = vi.fn()
    const exec = makeExec({ aiDraft })
    const wf = {
      nodes: [
        node('t', 'trigger', 'trigger.message_keyword'),
        node('draft', 'action', 'action.ai_draft', { prompt: 'answer politely', queryLimit: '300', responseBuffer: '50' }),
      ],
      edges: [edge('t', 'draft')],
    }
    await runWorkflow(wf, {}, exec)
    expect(aiDraft).toHaveBeenCalledTimes(1)
    expect(aiDraft.mock.calls[0]?.[0]).toMatchObject({
      id: 'draft',
      config: { prompt: 'answer politely', queryLimit: '300', responseBuffer: '50' },
    })
  })
})
