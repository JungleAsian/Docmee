import { describe, expect, it } from 'vitest'
import { simulateWorkflow } from '../workflows/workflow-simulator.js'
import type { WorkflowEdge, WorkflowNode } from '@docmee/db'

const node = (id: string, kind: WorkflowNode['kind'], type: string, config: Record<string, unknown> = {}): WorkflowNode => ({ id, kind, type, config, x: 0, y: 0 })
const edge = (source: string, target: string, sourceHandle?: string): WorkflowEdge => ({ id: `${source}-${target}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) })

describe('simulateWorkflow', () => {
  it('traces deterministic branches without invoking external effects', async () => {
    const outcome = await simulateWorkflow({
      nodes: [node('start', 'trigger', 'trigger.message_keyword'), node('condition', 'logic', 'logic.condition', { field: 'tier', value: 'vip' }), node('vip', 'action', 'action.send_message'), node('standard', 'action', 'action.send_template')],
      edges: [edge('start', 'condition'), edge('condition', 'vip', 'true'), edge('condition', 'standard', 'false')],
    }, { tier: 'vip' })

    expect(outcome.status).toBe('completed')
    expect(outcome.trace.map((step) => step.nodeId)).toEqual(['start', 'condition', 'vip'])
  })
})
