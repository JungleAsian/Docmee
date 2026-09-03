import { describe, expect, it } from 'vitest'
import {
  countWorkflowCrossings,
  findFreePosition,
  getSelectedWorkflowPath,
  layoutSelectedBranch,
  layoutWorkflow,
  nextNodePosition,
  routeWorkflowEdges,
} from './workflowLayout'
import type { WorkflowEdge, WorkflowNode } from './types'

const node = (id: string, kind: WorkflowNode['kind'] = 'action', type = 'action.send_message'): WorkflowNode => ({
  id,
  kind,
  type,
  config: {},
  x: 999,
  y: 999,
})
const edge = (id: string, source: string, target: string): WorkflowEdge => ({ id, source, target })

const menu = (id: string, optionCount: number): WorkflowNode => ({
  ...node(id, 'action', 'action.interactive_menu'),
  config: {
    options: Array.from({ length: optionCount }, (_, index) => ({
      optionId: `option_${index + 1}`,
      title: `Option ${index + 1}`,
    })),
  },
})

describe('layoutWorkflow', () => {
  it('lays a linear chain out left-to-right in edge order', () => {
    const laid = layoutWorkflow(
      [node('t', 'trigger', 'trigger.message_keyword'), node('a'), node('b'), node('c', 'action', 'action.end')],
      [edge('e1', 't', 'a'), edge('e2', 'a', 'b'), edge('e3', 'b', 'c')],
    )
    const x = new Map(laid.map((n) => [n.id, n.x]))
    expect(x.get('t')!).toBeLessThan(x.get('a')!)
    expect(x.get('a')!).toBeLessThan(x.get('b')!)
    expect(x.get('b')!).toBeLessThan(x.get('c')!)
    // Linear chain: single row.
    for (const n of laid) expect(n.y).toBe(0)
  })

  it('puts branch children in the same deeper layer on separate rows', () => {
    const laid = layoutWorkflow(
      [node('t', 'trigger', 'trigger.message_keyword'), node('cond', 'logic', 'logic.condition'), node('yes'), node('no')],
      [edge('e1', 't', 'cond'), edge('e2', 'cond', 'yes'), edge('e3', 'cond', 'no')],
    )
    const x = new Map(laid.map((n) => [n.id, n.x]))
    const y = new Map(laid.map((n) => [n.id, n.y]))
    expect(x.get('yes')).toBe(x.get('no'))
    expect(x.get('cond')!).toBeLessThan(x.get('yes')!)
    expect(y.get('yes')).not.toBe(y.get('no'))
  })

  it('orders children by their logical branch rows instead of node declaration order', () => {
    const laid = layoutWorkflow(
      [node('t', 'trigger', 'trigger.message_keyword'), node('cond', 'logic', 'logic.condition'), node('no'), node('yes')],
      [edge('e1', 't', 'cond'), { ...edge('yes-edge', 'cond', 'yes'), sourceHandle: 'true' }, { ...edge('no-edge', 'cond', 'no'), sourceHandle: 'false' }],
    )
    const y = new Map(laid.map((n) => [n.id, n.y]))
    expect(y.get('yes')!).toBeLessThan(y.get('no')!)
  })

  it('derives layer and row spacing from the rendered node sizes', () => {
    const laid = layoutWorkflow(
      [node('t', 'trigger', 'trigger.message_keyword'), menu('menu-a', 6), menu('menu-b', 6)],
      [edge('e1', 't', 'menu-a'), edge('e2', 't', 'menu-b')],
    )
    const positioned = new Map(laid.map((n) => [n.id, n]))

    expect(positioned.get('menu-a')!.x - positioned.get('t')!.x).toBeGreaterThanOrEqual(340)
    expect(Math.abs(positioned.get('menu-b')!.y - positioned.get('menu-a')!.y)).toBeGreaterThanOrEqual(400)
  })

  it('prefers measured React Flow dimensions when they are available', () => {
    const laid = layoutWorkflow(
      [node('t', 'trigger', 'trigger.message_keyword'), node('a'), node('b')],
      [edge('ta', 't', 'a'), edge('tb', 't', 'b')],
      { sizes: { t: { width: 500, height: 300 }, a: { width: 260, height: 180 }, b: { width: 260, height: 180 } } },
    )
    const positioned = new Map(laid.map((n) => [n.id, n]))

    expect(positioned.get('a')!.x).toBeGreaterThanOrEqual(620)
    expect(positioned.get('b')!.y - positioned.get('a')!.y).toBeGreaterThanOrEqual(228)
  })

  it('ignores self-loops and terminates on conversational cycles', () => {
    const laid = layoutWorkflow(
      [node('t', 'trigger', 'trigger.message_keyword'), node('menu', 'action', 'action.interactive_menu'), node('end', 'action', 'action.end')],
      [edge('e1', 't', 'menu'), edge('e2', 'menu', 'menu'), edge('e3', 'menu', 'end'), edge('e4', 'end', 'menu')],
    )
    const x = new Map(laid.map((n) => [n.id, n.x]))
    expect(x.get('menu')!).toBeGreaterThan(x.get('t')!)
    // Every node got a finite position.
    for (const n of laid) {
      expect(Number.isFinite(n.x)).toBe(true)
      expect(Number.isFinite(n.y)).toBe(true)
    }
  })

  it('does not let loop and back edges inflate forward layers', () => {
    const inputNodes = [
      node('t', 'trigger', 'trigger.message_keyword'),
      node('menu', 'action', 'action.interactive_menu'),
      node('confirm'),
      node('end', 'action', 'action.end'),
    ]
    const inputEdges = [
      edge('e1', 't', 'menu'),
      edge('e2', 'menu', 'confirm'),
      edge('e3', 'confirm', 'end'),
      edge('retry', 'confirm', 'menu'),
      edge('repeat', 'menu', 'menu'),
    ]

    const laid = layoutWorkflow(inputNodes, inputEdges)
    const x = new Map(laid.map((n) => [n.id, n.x]))
    expect(x.get('t')!).toBeLessThan(x.get('menu')!)
    expect(x.get('menu')!).toBeLessThan(x.get('confirm')!)
    expect(x.get('confirm')!).toBeLessThan(x.get('end')!)
    expect(Math.max(...laid.map((n) => n.x))).toBeLessThan(1_200)
    expect(layoutWorkflow(inputNodes, inputEdges)).toEqual(laid)
  })

  it('parks unreachable nodes in trailing layers instead of dropping them', () => {
    const laid = layoutWorkflow(
      [node('t', 'trigger', 'trigger.message_keyword'), node('a'), node('stray')],
      [edge('e1', 't', 'a')],
    )
    expect(laid).toHaveLength(3)
    const stray = laid.find((n) => n.id === 'stray')!
    const a = laid.find((n) => n.id === 'a')!
    expect(stray.x).toBeGreaterThan(a.x)
  })

  it('lays out 100 nodes without measurable cost', () => {
    const nodes = [node('t', 'trigger', 'trigger.message_keyword')]
    const edges: WorkflowEdge[] = []
    for (let i = 1; i <= 99; i++) {
      nodes.push(node(`n${i}`))
      edges.push(edge(`e${i}`, i === 1 ? 't' : `n${i - 1}`, `n${i}`))
    }
    // Add some cross edges to make it branchy.
    for (let i = 10; i <= 90; i += 10) edges.push(edge(`x${i}`, `n${i}`, `n${i + 5}`))

    const start = performance.now()
    const laid = layoutWorkflow(nodes, edges)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(200)
    expect(laid).toHaveLength(100)
    expect(new Set(laid.map((n) => `${n.x},${n.y}`)).size).toBe(100) // no overlaps
  })
})

function overlaps(a: { x: number; y: number }, b: { x: number; y: number }, w = 220, h = 130): boolean {
  return a.x < b.x + w && a.x + w > b.x && a.y < b.y + h && a.y + h > b.y
}

describe('findFreePosition', () => {
  it('returns the desired spot untouched when nothing is there', () => {
    expect(findFreePosition([], { x: 100, y: 100 })).toEqual({ x: 100, y: 100 })
  })

  it('nudges away from a single occupying node', () => {
    const existing = [node('a')]
    existing[0]!.x = 100
    existing[0]!.y = 100
    const at = findFreePosition(existing, { x: 100, y: 100 })
    expect(overlaps(at, existing[0]!)).toBe(false)
  })

  it('clears a dense cluster of existing nodes instead of landing inside it', () => {
    const existing: WorkflowNode[] = []
    for (let i = 0; i < 10; i++) {
      const n = node(`n${i}`)
      n.x = 100 + i * 30 // deliberately tighter than the 220px collision box — a real cluster
      n.y = 100
      existing.push(n)
    }
    const at = findFreePosition(existing, { x: 100, y: 100 })
    for (const n of existing) expect(overlaps(at, n)).toBe(false)
  })
})

describe('nextNodePosition', () => {
  it('starts a blank canvas at a fixed origin', () => {
    expect(nextNodePosition([])).toEqual({ x: 60, y: 40 })
  })

  it('lands below the lowest existing node without overlapping anything', () => {
    const existing = [node('a'), node('b'), node('c')]
    existing[0]!.x = 60; existing[0]!.y = 40
    existing[1]!.x = 340; existing[1]!.y = 40
    existing[2]!.x = 60; existing[2]!.y = 190
    const at = nextNodePosition(existing)
    expect(at.y).toBeGreaterThan(Math.max(...existing.map((n) => n.y)))
    for (const n of existing) expect(overlaps(at, n)).toBe(false)
  })

  it('never lands on top of an existing node across repeated adds (the reported overlap bug)', () => {
    // Simulates clicking "+ Send message" from the palette 8 times in a row —
    // the old `nodes.length % 4/8` placement wrapped back over itself well
    // before this many adds and guaranteed a visible overlap.
    let nodes: WorkflowNode[] = []
    for (let i = 0; i < 8; i++) {
      const at = nextNodePosition(nodes)
      const n = node(`n${i}`)
      n.x = at.x
      n.y = at.y
      for (const existing of nodes) expect(overlaps(at, existing)).toBe(false)
      nodes = [...nodes, n]
    }
  })
})

describe('routeWorkflowEdges', () => {
  it('uses orthogonal forward corridors and stable external lanes for loops and back edges', () => {
    const nodes = layoutWorkflow(
      [node('t', 'trigger', 'trigger.message_keyword'), node('menu'), node('end', 'action', 'action.end')],
      [edge('forward', 't', 'menu'), edge('next', 'menu', 'end'), edge('back', 'end', 'menu'), edge('loop', 'menu', 'menu')],
    )
    const routes = new Map(routeWorkflowEdges(nodes, [
      edge('forward', 't', 'menu'),
      edge('next', 'menu', 'end'),
      edge('back', 'end', 'menu'),
      edge('loop', 'menu', 'menu'),
    ]).map((route) => [route.edgeId, route]))

    expect(routes.get('forward')!.kind).toBe('forward')
    for (const [from, to] of routes.get('forward')!.points.slice(1).map((point, index) => [routes.get('forward')!.points[index]!, point] as const)) {
      expect(from.x === to.x || from.y === to.y).toBe(true)
    }
    expect(routes.get('forward')!.label.x - routes.get('forward')!.points[0]!.x).toBeLessThanOrEqual(72)

    const top = Math.min(...nodes.map((n) => n.y))
    const bottom = Math.max(...nodes.map((n) => n.y)) + 130
    for (const id of ['back', 'loop']) {
      const route = routes.get(id)!
      expect(['back', 'loop']).toContain(route.kind)
      expect(route.lane).not.toBeNull()
      expect(route.points.some((point) => point.y < top || point.y > bottom)).toBe(true)
    }
    expect(routeWorkflowEdges(nodes, [edge('back', 'end', 'menu'), edge('loop', 'menu', 'menu')]))
      .toEqual(routeWorkflowEdges(nodes, [edge('back', 'end', 'menu'), edge('loop', 'menu', 'menu')]))
  })

  it('moves a forward skip edge into an external lane instead of drawing through an intermediate node', () => {
    const nodes = [
      { ...node('start', 'trigger', 'trigger.message_keyword'), x: 0, y: 0 },
      { ...node('between'), x: 340, y: 0 },
      { ...node('end', 'action', 'action.end'), x: 680, y: 0 },
    ]

    const route = routeWorkflowEdges(nodes, [edge('skip', 'start', 'end')])[0]!

    expect(route.kind).toBe('forward')
    expect(route.lane).not.toBeNull()
    expect(route.points.some((point) => point.y < 0 || point.y > 130)).toBe(true)
  })
})

describe('layoutSelectedBranch', () => {
  it('repositions only the selected node and its forward descendants', () => {
    const nodes = [
      { ...node('t', 'trigger', 'trigger.message_keyword'), x: 10, y: 10 },
      { ...node('a'), x: 300, y: 300 },
      { ...node('a1'), x: 900, y: 900 },
      { ...node('b'), x: 310, y: 20 },
      { ...node('b1'), x: 620, y: 20 },
    ]
    const edges = [edge('ta', 't', 'a'), edge('aa1', 'a', 'a1'), edge('tb', 't', 'b'), edge('bb1', 'b', 'b1')]
    const laid = layoutSelectedBranch(nodes, edges, 'a')
    const before = new Map(nodes.map((n) => [n.id, n]))
    const after = new Map(laid.map((n) => [n.id, n]))

    for (const id of ['t', 'b', 'b1']) expect(after.get(id)).toEqual(before.get(id))
    expect(after.get('a')!.x).toBe(before.get('a')!.x)
    expect(after.get('a')!.y).toBe(before.get('a')!.y)
    expect(after.get('a1')).not.toEqual(before.get('a1'))
  })
})

describe('workflow path and crossing analysis', () => {
  it('includes ancestors and descendants in the selected path without including sibling branches', () => {
    const edges = [edge('ta', 't', 'a'), edge('aa1', 'a', 'a1'), edge('tb', 't', 'b')]
    const path = getSelectedWorkflowPath(edges, 'a')
    expect([...path.nodeIds].sort()).toEqual(['a', 'a1', 't'])
    expect([...path.edgeIds].sort()).toEqual(['aa1', 'ta'])
  })

  it('reports a manual crossing and the deterministic layout removes it', () => {
    const nodes = [
      { ...node('a'), x: 0, y: 0 },
      { ...node('b'), x: 0, y: 220 },
      { ...node('c'), x: 500, y: 0 },
      { ...node('d'), x: 500, y: 220 },
    ]
    const edges = [edge('ad', 'a', 'd'), edge('bc', 'b', 'c')]
    expect(countWorkflowCrossings(nodes, edges)).toBe(1)
    expect(countWorkflowCrossings(layoutWorkflow(nodes, edges), edges)).toBe(0)
  })
})
