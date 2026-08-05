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
