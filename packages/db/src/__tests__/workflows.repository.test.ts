import { describe, expect, it } from 'vitest'
import { normalizeWorkflowGraph } from '../repositories/workflows.repository.js'
import type { Workflow } from '../types/index.js'

const base: Workflow = {
  id: 'wf-1',
  clinicId: 'c-1',
  name: 'Test',
  status: 'draft',
  nodes: [],
  edges: [],
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as Workflow

describe('normalizeWorkflowGraph', () => {
  it('passes through proper arrays untouched', () => {
    const nodes = [{ id: 'n1', kind: 'trigger', type: 'trigger.message_keyword', config: {}, x: 0, y: 0 }]
    const edges = [{ id: 'e1', source: 'n1', target: 'n2' }]
    const wf = normalizeWorkflowGraph({ ...base, nodes, edges } as Workflow)
    expect(wf.nodes).toBe(nodes)
    expect(wf.edges).toBe(edges)
  })

  it('parses double-encoded jsonb (string) back into arrays', () => {
    const nodes = [{ id: 'n1', kind: 'trigger', type: 'trigger.message_keyword', config: {}, x: 0, y: 0 }]
    const wf = normalizeWorkflowGraph({
      ...base,
      nodes: JSON.stringify(nodes),
      edges: '[]',
    } as unknown as Workflow)
    expect(Array.isArray(wf.nodes)).toBe(true)
    expect(wf.nodes).toEqual(nodes)
    expect(wf.edges).toEqual([])
  })

  it('leaves unparseable strings as-is rather than throwing', () => {
    const wf = normalizeWorkflowGraph({ ...base, nodes: '{oops', edges: 'nope' } as unknown as Workflow)
    expect(wf.nodes).toBe('{oops')
    expect(wf.edges).toBe('nope')
  })
})
