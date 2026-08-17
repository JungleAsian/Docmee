import { describe, expect, it } from 'vitest'
import { serializeWorkflowExport, parseWorkflowExport } from './workflowImport'
import type { WorkflowNode, WorkflowEdge } from './types'

const nodes: WorkflowNode[] = [
  { id: 'trigger', kind: 'trigger', type: 'trigger.message_keyword', config: { keywords: 'hola' }, x: 0, y: 0 },
  { id: 'end', kind: 'action', type: 'action.end', config: {}, x: 200, y: 0 },
]
const edges: WorkflowEdge[] = [{ id: 'e1', source: 'trigger', target: 'end' }]

describe('serializeWorkflowExport / parseWorkflowExport', () => {
  it('round-trips nodes and edges exactly', () => {
    const raw = serializeWorkflowExport('My workflow', nodes, edges)
    const result = parseWorkflowExport(raw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.name).toBe('My workflow')
      expect(result.nodes).toEqual(nodes)
      expect(result.edges).toEqual(edges)
    }
  })

  it('rejects non-JSON input', () => {
    expect(parseWorkflowExport('not json{{{')).toEqual({ ok: false, error: 'wf.import.invalidJson' })
  })

  it('rejects valid JSON missing the docmeeWorkflowExport marker', () => {
    expect(parseWorkflowExport(JSON.stringify({ nodes: [], edges: [] }))).toEqual({
      ok: false,
      error: 'wf.import.notAWorkflowExport',
    })
  })

  it('rejects a marker from a future/incompatible export version', () => {
    expect(parseWorkflowExport(JSON.stringify({ docmeeWorkflowExport: 2, nodes: [], edges: [] }))).toEqual({
      ok: false,
      error: 'wf.import.notAWorkflowExport',
    })
  })

  it('rejects when nodes/edges are not arrays', () => {
    expect(parseWorkflowExport(JSON.stringify({ docmeeWorkflowExport: 1, nodes: 'nope', edges: [] }))).toEqual({
      ok: false,
      error: 'wf.import.invalidShape',
    })
  })

  it('rejects a node missing a required field rather than silently loading it', () => {
    const raw = JSON.stringify({
      docmeeWorkflowExport: 1,
      nodes: [{ id: 'a', kind: 'action', type: 'action.end', config: {} }], // missing x/y
      edges: [],
    })
    expect(parseWorkflowExport(raw)).toEqual({ ok: false, error: 'wf.import.invalidShape' })
  })

  it('rejects an edge missing a required field', () => {
    const raw = JSON.stringify({
      docmeeWorkflowExport: 1,
      nodes: [],
      edges: [{ id: 'e1', source: 'a' }], // missing target
    })
    expect(parseWorkflowExport(raw)).toEqual({ ok: false, error: 'wf.import.invalidShape' })
  })

  it('rejects a node with an invalid kind', () => {
    const raw = JSON.stringify({
      docmeeWorkflowExport: 1,
      nodes: [{ id: 'a', kind: 'not_a_real_kind', type: 'action.end', config: {}, x: 0, y: 0 }],
      edges: [],
    })
    expect(parseWorkflowExport(raw)).toEqual({ ok: false, error: 'wf.import.invalidShape' })
  })

  it('accepts a minimal valid file with empty nodes/edges arrays', () => {
    const result = parseWorkflowExport(JSON.stringify({ docmeeWorkflowExport: 1, name: '', nodes: [], edges: [] }))
    expect(result).toEqual({ ok: true, name: '', nodes: [], edges: [] })
  })

  it('defaults name to an empty string when absent', () => {
    const result = parseWorkflowExport(JSON.stringify({ docmeeWorkflowExport: 1, nodes: [], edges: [] }))
    expect(result).toEqual({ ok: true, name: '', nodes: [], edges: [] })
  })

  it('excludes clinicId/status from the serialized output (portability + safety)', () => {
    const raw = serializeWorkflowExport('x', nodes, edges)
    expect(raw).not.toContain('clinicId')
    expect(raw).not.toContain('"status"')
  })
})
