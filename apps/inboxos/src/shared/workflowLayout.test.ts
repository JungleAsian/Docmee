import { describe, expect, it } from 'vitest'
import { layoutWorkflow, findFreePosition, nextNodePosition } from './workflowLayout'
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
