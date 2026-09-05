import { describe, expect, it } from 'vitest'
import { canConnectWorkflow } from './workflowConnections'
import type { WorkflowNode } from './types'

const nodes: WorkflowNode[] = [
  { id: 'start', kind: 'trigger', type: 'trigger.message_keyword', config: {}, x: 0, y: 0 },
  { id: 'condition', kind: 'logic', type: 'logic.condition', config: {}, x: 0, y: 0 },
  { id: 'end', kind: 'action', type: 'action.end', config: {}, x: 0, y: 0 },
]
describe('safe canvas connections', () => {
  it('allows one destination per outcome without blocking different outcomes', () => {
    const edges = [{ id: 'one', source: 'condition', target: 'end', sourceHandle: 'true' }]
    expect(canConnectWorkflow(nodes, edges, { source: 'condition', target: 'end', sourceHandle: 'true' })).toBe(false)
    expect(canConnectWorkflow(nodes, edges, { source: 'condition', target: 'end', sourceHandle: 'false' })).toBe(true)
  })
  it('rejects impossible ports and stale branches', () => {
    for (const connection of [
      { source: 'end', target: 'condition' },
      { source: 'condition', target: 'start', sourceHandle: 'true' },
      { source: 'condition', target: 'end', sourceHandle: 'removed' },
      { source: 'condition', target: 'condition', sourceHandle: 'true' },
    ]) expect(canConnectWorkflow(nodes, [], connection)).toBe(false)
  })
})
