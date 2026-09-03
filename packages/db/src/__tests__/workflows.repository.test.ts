import { describe, expect, it } from 'vitest'
import { createWorkflowsRepository, normalizeWorkflowGraph } from '../repositories/workflows.repository.js'
import type { Sql } from '../client.js'
import type { Workflow } from '../types/index.js'

function transactionalSql(results: unknown[][]) {
  const calls: { query: string; values: unknown[] }[] = []
  type FakeSql = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>) & {
    json: (value: unknown) => unknown
    begin: <T>(callback: (transaction: FakeSql) => Promise<T>) => Promise<T>
  }
  const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ query: strings.join(' '), values })
    return Promise.resolve(results.shift() ?? [])
  }) as FakeSql
  tx.json = (value) => value
  tx.begin = async (callback) => callback(tx)

  return { sql: tx as unknown as Sql, calls }
}

const base: Workflow = {
  id: 'wf-1',
  clinicId: 'c-1',
  name: 'Test',
  status: 'draft',
  activeRevisionId: null,
  nodes: [],
  edges: [],
  createdAt: '2026-09-02T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
}

const current: Workflow = {
  id: 'workflow-1',
  clinicId: 'clinic-1',
  name: 'Booking',
  status: 'active' as const,
  activeRevisionId: 'revision-old',
  nodes: [{ id: 'old', kind: 'trigger', type: 'trigger.message_keyword', config: {}, x: 0, y: 0 }],
  edges: [],
  createdAt: '2026-09-02T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
}

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

describe('workflows repository revisions', () => {
  it('snapshots an edited active graph and atomically advances the active revision', async () => {
    const updated: Workflow = {
      ...current,
      nodes: [{ id: 'new', kind: 'trigger', type: 'trigger.message_keyword', config: {}, x: 0, y: 0 }],
    }
    const { sql, calls } = transactionalSql([
      [current],
      [updated],
      [{ id: 'revision-new', clinicId: 'clinic-1', workflowId: 'workflow-1', definition: { nodes: updated.nodes, edges: [] } }],
      [{ ...updated, activeRevisionId: 'revision-new' }],
    ])

    const workflow = await createWorkflowsRepository(sql).update('clinic-1', 'workflow-1', {
      nodes: updated.nodes,
    })

    expect(workflow?.activeRevisionId).toBe('revision-new')
    expect(calls[0]?.query).toContain('FOR UPDATE')
    expect(calls[2]?.query).toContain('INSERT INTO workflow_revisions')
    expect(calls[3]?.query).toContain('SET active_revision_id')
  })
})
