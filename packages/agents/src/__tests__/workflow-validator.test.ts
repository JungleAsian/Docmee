import { describe, expect, it } from 'vitest'
import { validateWorkflowDefinition } from '../workflows/workflow-validator.js'
import type { WorkflowEdge, WorkflowNode } from '@docmee/db'

const node = (id: string, kind: WorkflowNode['kind'], type: string, config: Record<string, unknown> = {}): WorkflowNode => ({ id, kind, type, config, x: 0, y: 0 })
const edge = (id: string, source: string, target: string, sourceHandle?: string): WorkflowEdge => ({ id, source, target, ...(sourceHandle ? { sourceHandle } : {}) })

describe('validateWorkflowDefinition', () => {
  it('accepts a reachable, typed workflow with one trigger', () => {
    expect(validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.message_keyword'),
      node('message', 'action', 'action.send_message', { text: 'Hello' }),
      node('end', 'action', 'action.end'),
    ], [edge('one', 'trigger', 'message'), edge('two', 'message', 'end')], { requireTrigger: true })).toEqual([])
  })

  it('rejects unsupported, dangling, cyclic, and unreachable graphs', () => {
    const errors = validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.message_keyword'),
      node('bad', 'logic', 'action.send_message'),
      node('orphan', 'action', 'action.end'),
    ], [edge('one', 'trigger', 'bad'), edge('two', 'bad', 'trigger'), edge('three', 'bad', 'missing')], { requireTrigger: true })
    expect(errors.join('\n')).toMatch(/requires action/)
    expect(errors.join('\n')).toMatch(/unknown target/)
    expect(errors.join('\n')).toMatch(/Cycle detected/)
    expect(errors.join('\n')).toMatch(/unreachable/)
  })

  it('allows an empty draft but not an active empty workflow', () => {
    expect(validateWorkflowDefinition([], [])).toEqual([])
    expect(validateWorkflowDefinition([], [], { requireTrigger: true })).toContain('An active workflow requires exactly one trigger')
  })

  it('rejects trigger types that have no worker producer', () => {
    const errors = validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.no_show'),
    ], [], { requireTrigger: true })
    expect(errors).toContain('Unsupported node type: trigger.no_show')
  })

  it('rejects ambiguous branches and pause nodes that cannot resume', () => {
    const errors = validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.message_keyword'),
      node('condition', 'logic', 'logic.condition'),
      node('delay', 'logic', 'logic.delay'),
      node('end', 'action', 'action.end'),
    ], [
      edge('one', 'trigger', 'condition'),
      edge('two', 'condition', 'delay', 'true'),
      edge('three', 'condition', 'end', 'true'),
    ], { requireTrigger: true })
    expect(errors.join('\n')).toMatch(/ambiguous true branch/)
    expect(errors.join('\n')).toMatch(/requires true and false successors/)
    expect(errors.join('\n')).toMatch(/must have exactly one successor/)
    expect(errors.join('\n')).toMatch(/requires a positive amount/)
  })
})
