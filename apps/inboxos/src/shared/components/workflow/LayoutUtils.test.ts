import { describe, expect, it } from 'vitest'
import { cleanGroups, layoutGroupedWorkflow, overlaps, projectWorkflow, routeProjectedWorkflow, workflowDocument } from './LayoutUtils'
import { createHugeWorkflow } from './MockData'
import { parseWorkflowExport, serializeWorkflowExport } from '../../workflowImport'
import { gridRoute, orthogonalPath } from './OrthogonalEdge'
import { zoomTier } from './SemanticZoom'

describe('large workflow presentation', () => {
  it('preserves all 36 executable nodes and edges while projecting 3 collapsed cards', () => {
    const graph = createHugeWorkflow()
    const before = JSON.stringify(graph)
    const view = projectWorkflow(graph.nodes, graph.edges, graph.groups)
    expect(view.groups).toHaveLength(3)
    expect(view.nodes).toHaveLength(0)
    expect(view.edges).toHaveLength(2)
    expect(view.edges[0]).toMatchObject({ id: 'bridge-0', source: 'demo-group-0', target: 'demo-group-1', sourceHandle: 'out:bridge-0', targetHandle: 'in:bridge-0' })
    const document = workflowDocument(graph)
    expect(document.definition.nodes).toHaveLength(36)
    expect(document.definition.edges).toEqual(graph.edges)
    expect(document.definition.nodes.some((node) => node.id.startsWith('demo-group'))).toBe(false)
    expect(JSON.stringify(graph)).toBe(before)
  })
  it('expands without container overlaps and reverses offsets without drift', () => {
    const graph = createHugeWorkflow()
    const compact = projectWorkflow(graph.nodes, graph.edges, graph.groups)
    for (let mask = 0; mask < 8; mask++) {
      const groups = graph.groups.map((group, index) => ({ ...group, collapsed: !(mask & (1 << index)) }))
      const expanded = projectWorkflow(graph.nodes, graph.edges, groups)
      expanded.boxes.forEach((box, i) => expanded.boxes.slice(i + 1).forEach((other) => expect(overlaps(box, other, 0)).toBe(false)))
      expect(expanded.nodes).toHaveLength(groups.filter((group) => !group.collapsed).length * 12)
      expanded.nodes.forEach((node) => {
        const parent = expanded.groups.find((group) => group.id === node.parentId)!
        expect(node.absolute.x).toBe(parent.x + node.position.x)
        expect(node.absolute.y).toBe(parent.y + node.position.y)
        expect(node.position.x).toBeGreaterThanOrEqual(0)
        expect(node.position.y).toBeGreaterThanOrEqual(80)
      })
    }
    const expanded = projectWorkflow(graph.nodes, graph.edges, graph.groups.map((group) => ({ ...group, collapsed: false })))
    expect(expanded.groups[1]!.x).toBeGreaterThan(compact.groups[1]!.x)
    expect(projectWorkflow(graph.nodes, graph.edges, graph.groups)).toEqual(compact)
  })
  it('keeps groups through export/import, document serialization, and grouped auto-layout', () => {
    const graph = createHugeWorkflow()
    const imported = parseWorkflowExport(serializeWorkflowExport('Demo', graph.nodes, graph.edges, graph.groups))
    expect(imported.ok && imported.groups).toEqual(graph.groups)
    const document = workflowDocument(graph)
    const updated = workflowDocument({ ...graph, groups: graph.groups.map((group) => ({ ...group, collapsed: false })) }, document)
    expect(updated.definition).toEqual(document.definition)
    const nodes = layoutGroupedWorkflow(graph.nodes, graph.edges, graph.groups)
    expect(nodes.map((node) => node.id)).toEqual(graph.nodes.map((node) => node.id))
    expect(nodes.every((node) => node.x % 16 === 0 && node.y % 16 === 0)).toBe(true)
  })
  it('rejects invalid memberships on import and cleans up deleted nodes', () => {
    const graph = createHugeWorkflow()
    const malformed = serializeWorkflowExport('Demo', graph.nodes, graph.edges, [{ ...graph.groups[0]!, nodeIds: ['missing'] }])
    expect(parseWorkflowExport(malformed)).toMatchObject({ ok: false })
    expect(cleanGroups(graph.groups, graph.nodes.filter((node) => !graph.groups[0]!.nodeIds.includes(node.id)))).toHaveLength(2)
  })
  it('routes within an expanded group without treating the parent as an obstacle', () => {
    const graph = createHugeWorkflow()
    const view = projectWorkflow(graph.nodes, graph.edges, graph.groups.map((group) => ({ ...group, collapsed: false })))
    expect(routeProjectedWorkflow(view).find((route) => route.edgeId === 'demo-edge-0-0')).toMatchObject({ kind: 'forward', lane: null })
  })
  it('pulls surrounding groups back after collapsing an auto-laid-out workflow', () => {
    const graph = createHugeWorkflow()
    const nodes = layoutGroupedWorkflow(graph.nodes, graph.edges, graph.groups)
    const expanded = projectWorkflow(nodes, graph.edges, graph.groups.map((group) => ({ ...group, collapsed: false })))
    const compact = projectWorkflow(nodes, graph.edges, graph.groups)
    expect(compact.groups[1]!.x).toBeLessThan(expanded.groups[1]!.x)
    compact.boxes.forEach((box, index) => compact.boxes.slice(index + 1).forEach((other) => expect(overlaps(box, other, 0)).toBe(false)))
  })
})

describe('semantic zoom and Manhattan routing', () => {
  it.each([[0.3999, 'macro'], [0.4, 'balanced'], [0.75, 'balanced'], [0.7501, 'full']])('maps zoom %s to %s', (zoom, expected) => {
    expect(zoomTier(Number(zoom))).toBe(expected)
  })
  it.each([
    [{ x: 208, y: 85 }, { x: 512, y: 230 }],
    [{ x: 720, y: 97 }, { x: 64, y: 311 }],
    [{ x: 208, y: 85 }, { x: 0, y: 85 }],
  ])('uses finite sharp right-angle segments with grid corridors', (source, target) => {
    const points = gridRoute(source, target, [])
    expect(points.slice(2, -2).every((point) => point.x % 16 === 0 && point.y % 16 === 0)).toBe(true)
    const path = orthogonalPath(points)
    expect(path).not.toMatch(/NaN|Q|C/)
    const coords = [...path.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }))
    coords.slice(1).forEach((point, index) => expect(point.x === coords[index]!.x || point.y === coords[index]!.y).toBe(true))
    expect(coords[0]).toEqual(source)
    expect(coords.at(-1)).toEqual(target)
  })
})
