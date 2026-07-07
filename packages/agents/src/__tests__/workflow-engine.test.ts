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
