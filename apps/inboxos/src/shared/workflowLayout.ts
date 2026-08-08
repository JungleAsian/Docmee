// Dependency-free layered auto-layout for the workflow canvas (left → right).
//
// Layer assignment is longest-path relaxation from the trigger (or from
// no-incoming-edge roots when there is no trigger). Self-loops are ignored and
// iterations are capped at the node count, so conversational loops (a menu
// re-showing itself) can never hang the pass. Nodes unreachable from any root
// are parked in a trailing layer instead of being dropped. Within a layer,
// nodes are ordered by the average row of their already-placed parents (one
// barycenter sweep) to reduce edge crossings.
//
// Pure function — returns new node objects with updated x/y; callers push the
// result through the undo history as a single step.

import type { WorkflowEdge, WorkflowNode } from './types'

const LAYER_WIDTH = 280
const ROW_HEIGHT = 150

// Generous card bounding box for collision checks — covers both the
// Enhanced (w-52 = 208px) and Classic (w-48 = 192px) card widths, plus
// headroom for the tallest content (a menu card's option rows). Exact pixel
// accuracy isn't the goal; avoiding the near-guaranteed overlap of the old
// placement is — a drag or the Auto Layout button still fixes any residual
// visual crowding for unusually tall cards.
const CARD_WIDTH = 220
const CARD_HEIGHT = 130

function boxesOverlap(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x < b.x + CARD_WIDTH && a.x + CARD_WIDTH > b.x && a.y < b.y + CARD_HEIGHT && a.y + CARD_HEIGHT > b.y
}

/**
 * The nearest position to `desired` that doesn't overlap any existing node's
 * bounding box — cascades diagonally (a common "new item lands offset from a
 * collision" pattern) until it clears every other node. Pure and
 * deterministic; capped so a pathological input can never loop forever.
 */
export function findFreePosition(nodes: WorkflowNode[], desired: { x: number; y: number }): { x: number; y: number } {
  let candidate = { ...desired }
  let guard = 0
  while (nodes.some((n) => boxesOverlap(candidate, n)) && guard < nodes.length + 50) {
    candidate = { x: candidate.x + 40, y: candidate.y + 40 }
    guard++
  }
  return candidate
}

/** Default landing spot for a brand-new, unwired node: below the lowest
 *  existing node, aligned to the leftmost column — grows the canvas
 *  downward instead of scattering through a tiny fixed grid (the old
 *  `nodes.length % 4/8` placement, which wrapped and guaranteed overlap
 *  after only a handful of adds). Still run through findFreePosition in
 *  case that spot happens to be occupied (e.g. an unusually wide layout). */
export function nextNodePosition(nodes: WorkflowNode[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 60, y: 40 }
  const x = Math.min(...nodes.map((n) => n.x))
  const y = Math.max(...nodes.map((n) => n.y)) + ROW_HEIGHT
  return findFreePosition(nodes, { x, y })
}

export function layoutWorkflow(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] {
  if (nodes.length === 0) return nodes

  const ids = new Set(nodes.map((n) => n.id))
  const outgoing = new Map<string, string[]>()
  const incomingCount = new Map<string, number>()
  const parents = new Map<string, string[]>()
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue
    outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e.target])
    incomingCount.set(e.target, (incomingCount.get(e.target) ?? 0) + 1)
    parents.set(e.target, [...(parents.get(e.target) ?? []), e.source])
  }

  // Roots: the single trigger when present, otherwise every no-incoming node.
  const trigger = nodes.find((n) => n.kind === 'trigger')
  const roots = trigger
    ? [trigger.id]
    : nodes.filter((n) => !(incomingCount.get(n.id) ?? 0)).map((n) => n.id)

  // Longest-path layering, capped at |V| relaxation rounds (cycle-safe).
  const layer = new Map<string, number>()
  for (const r of roots) layer.set(r, 0)
  if (roots.length === 0 && nodes[0]) layer.set(nodes[0].id, 0) // fully cyclic graph: seed somewhere
  for (let round = 0; round < nodes.length; round++) {
    let changed = false
    for (const e of edges) {
      const lu = layer.get(e.source)
      if (lu === undefined) continue
      const next = lu + 1
      if ((layer.get(e.target) ?? -1) < next) {
        layer.set(e.target, next)
        changed = true
      }
    }
    if (!changed) break
  }

  // Unreachable nodes: park them in a trailing layer, declaration order.
  const maxReachableLayer = Math.max(0, ...layer.values())
  const orphans = nodes.filter((n) => !layer.has(n.id))
  orphans.forEach((n, i) => layer.set(n.id, maxReachableLayer + 1 + i))

  // Group by layer.
  const byLayer = new Map<number, WorkflowNode[]>()
  for (const n of nodes) {
    const l = layer.get(n.id)!
    byLayer.set(l, [...(byLayer.get(l) ?? []), n])
  }

  // Place layer by layer; order within a layer by average parent row.
  const yOf = new Map<string, number>()
  const sortedLayers = [...byLayer.keys()].sort((a, b) => a - b)
  for (const l of sortedLayers) {
    const group = byLayer.get(l)!
    const rowOf = (n: WorkflowNode): number => {
      const ps = (parents.get(n.id) ?? []).filter((p) => yOf.has(p))
      if (ps.length === 0) return Number.MAX_SAFE_INTEGER / 2 // unpinned: keep declaration order at the end
      return ps.reduce((sum, p) => sum + yOf.get(p)!, 0) / ps.length
    }
    const ordered = [...group].sort((a, b) => rowOf(a) - rowOf(b))
    ordered.forEach((n, idx) => yOf.set(n.id, idx * ROW_HEIGHT))
  }

  return nodes.map((n) => ({
    ...n,
    x: layer.get(n.id)! * LAYER_WIDTH,
    y: yOf.get(n.id) ?? 0,
  }))
}
