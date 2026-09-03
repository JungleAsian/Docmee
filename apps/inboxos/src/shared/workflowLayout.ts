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
import { branchRows } from './workflowNodes'

const ROW_HEIGHT = 150
const LAYER_GAP = 120
const ROW_GAP = 48

// Generous card bounding box for collision checks — covers both the
// Enhanced (w-52 = 208px) and Classic (w-48 = 192px) card widths, plus
// headroom for the tallest content (a menu card's option rows). Exact pixel
// accuracy isn't the goal; avoiding the near-guaranteed overlap of the old
// placement is — a drag or the Auto Layout button still fixes any residual
// visual crowding for unusually tall cards.
const CARD_WIDTH = 220
const CARD_HEIGHT = 130

/** Conservative rendered-card dimensions used before React Flow has measured
 * a node. Branch rows are the dominant variable height on the enhanced card. */
export function estimateWorkflowNodeSize(node: WorkflowNode): { width: number; height: number } {
  return {
    width: 224,
    height: Math.max(CARD_HEIGHT, 116 + branchRows(node).length * 34),
  }
}

export type WorkflowNodeSize = { width: number; height: number }
export type WorkflowNodeSizeMap = Readonly<Record<string, WorkflowNodeSize>>

type LayoutOptions = { sizes?: WorkflowNodeSizeMap }

function nodeSize(node: WorkflowNode, sizes?: WorkflowNodeSizeMap): WorkflowNodeSize {
  const measured = sizes?.[node.id]
  return measured && measured.width > 0 && measured.height > 0 ? measured : estimateWorkflowNodeSize(node)
}

function boxesOverlap(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x < b.x + CARD_WIDTH && a.x + CARD_WIDTH > b.x && a.y < b.y + CARD_HEIGHT && a.y + CARD_HEIGHT > b.y
}

// Item 24 of the 25-item batch: the grid step a spiral search snaps to — a
// node's collision box plus a fixed gap, so settled nodes sit a consistent
// distance apart instead of however far a chain of diagonal nudges happened
// to drift.
const GRID_STEP_X = CARD_WIDTH + 40
const GRID_STEP_Y = CARD_HEIGHT + 30

/**
 * The nearest position to `desired` that doesn't overlap any existing node's
 * bounding box. Searches a square spiral (right, down, left, up, expanding)
 * on a fixed grid around `desired`, snapping to the nearest free slot instead
 * of the old diagonal-nudge walk, which could drift a dropped node far from
 * where it was actually released once several collisions stacked up. Pure and
 * deterministic; capped so a pathological input can never loop forever.
 */
export function findFreePosition(nodes: WorkflowNode[], desired: { x: number; y: number }): { x: number; y: number } {
  if (!nodes.some((n) => boxesOverlap(desired, n))) return { ...desired }

  let x = 0
  let y = 0
  let dx = 1
  let dy = 0
  let segmentLength = 1
  let segmentPassed = 0
  let turns = 0
  const maxSteps = (nodes.length + 25) * 8

  for (let step = 0; step < maxSteps; step++) {
    x += dx
    y += dy
    segmentPassed++
    if (segmentPassed === segmentLength) {
      segmentPassed = 0
      // Rotate 90°: right → down → left → up → right… widening the spiral
      // every other turn so it fully tiles the plane around `desired`.
      const nextDx = -dy
      const nextDy = dx
      dx = nextDx
      dy = nextDy
      turns++
      if (turns % 2 === 0) segmentLength++
    }
    const candidate = { x: desired.x + x * GRID_STEP_X, y: desired.y + y * GRID_STEP_Y }
    if (!nodes.some((n) => boxesOverlap(candidate, n))) return candidate
  }
  return { ...desired }
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

export function layoutWorkflow(nodes: WorkflowNode[], edges: WorkflowEdge[], options: LayoutOptions = {}): WorkflowNode[] {
  if (nodes.length === 0) return nodes

  const ids = new Set(nodes.map((n) => n.id))
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const outgoing = new Map<string, string[]>()
  const outgoingEdges = new Map<string, WorkflowEdge[]>()
  const incomingCount = new Map<string, number>()
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue
    outgoingEdges.set(e.source, [...(outgoingEdges.get(e.source) ?? []), e])
    incomingCount.set(e.target, (incomingCount.get(e.target) ?? 0) + 1)
  }
  const branchIndex = (edge: WorkflowEdge): number => {
    if (!edge.sourceHandle) return -1
    const source = nodeById.get(edge.source)
    const index = source ? branchRows(source).findIndex((row) => row.key === edge.sourceHandle) : -1
    return index < 0 ? Number.MAX_SAFE_INTEGER : index
  }
  for (const [source, sourceEdges] of outgoingEdges) {
    sourceEdges.sort((a, b) => branchIndex(a) - branchIndex(b) || edges.indexOf(a) - edges.indexOf(b))
    outgoing.set(source, sourceEdges.map((edge) => edge.target))
  }

  // Roots: the single trigger when present, otherwise every no-incoming node.
  const trigger = nodes.find((n) => n.kind === 'trigger')
  const roots = trigger
    ? [trigger.id]
    : nodes.filter((n) => !(incomingCount.get(n.id) ?? 0)).map((n) => n.id)

  // Deterministic first-discovery layering. Once a node has a layer, an edge
  // returning to it is a loop/back edge and cannot push it (or its ancestors)
  // farther right. That preserves the primary left-to-right path even for
  // retry/restart cycles.
  const layer = new Map<string, number>()
  const visit = (id: string, depth: number) => {
    if (layer.has(id)) return
    layer.set(id, depth)
    for (const target of outgoing.get(id) ?? []) visit(target, depth + 1)
  }
  for (const r of roots) visit(r, 0)
  if (roots.length === 0 && nodes[0]) visit(nodes[0].id, 0)

  // Unreachable components: park them after the reachable graph without
  // dropping their own forward structure.
  let nextOrphanLayer = Math.max(0, ...layer.values()) + 1
  const orphans = nodes.filter((n) => !layer.has(n.id))
  for (const orphan of orphans) {
    if (layer.has(orphan.id)) continue
    visit(orphan.id, nextOrphanLayer)
    nextOrphanLayer = Math.max(...layer.values()) + 1
  }

  const forwardEdges = edges.filter((edge) => {
    const sourceLayer = layer.get(edge.source)
    const targetLayer = layer.get(edge.target)
    return sourceLayer !== undefined && targetLayer !== undefined && targetLayer > sourceLayer
  })
  const forwardParents = new Map<string, string[]>()
  const forwardChildren = new Map<string, string[]>()
  for (const edge of forwardEdges) {
    forwardParents.set(edge.target, [...(forwardParents.get(edge.target) ?? []), edge.source])
    forwardChildren.set(edge.source, [...(forwardChildren.get(edge.source) ?? []), edge.target])
  }

  // Group by layer.
  const byLayer = new Map<number, WorkflowNode[]>()
  for (const n of nodes) {
    const l = layer.get(n.id)!
    byLayer.set(l, [...(byLayer.get(l) ?? []), n])
  }

  // Deterministic multi-pass barycenter sweeps. Alternating left-to-right and
  // right-to-left lets a later layer improve an earlier ambiguous ordering,
  // while stable declaration/branch-row tie breakers make every pass repeatable.
  const originalOrder = new Map(nodes.map((node, index) => [node.id, index]))
  const sortedLayers = [...byLayer.keys()].sort((a, b) => a - b)
  const order = new Map<string, number>()
  const refreshOrder = () => {
    for (const currentLayer of sortedLayers) {
      byLayer.get(currentLayer)!.forEach((node, index) => order.set(node.id, index))
    }
  }
  const barycenter = (idsForNode: string[]): number | null => {
    const positions = idsForNode.map((id) => order.get(id)).filter((value): value is number => value !== undefined)
    return positions.length === 0 ? null : positions.reduce((sum, value) => sum + value, 0) / positions.length
  }
  const branchRankForNode = (nodeId: string): number => {
    const ranks = forwardEdges.filter((edge) => edge.target === nodeId).map(branchIndex)
    return ranks.length === 0 ? Number.MAX_SAFE_INTEGER : Math.min(...ranks)
  }
  refreshOrder()
  for (let pass = 0; pass < 6; pass++) {
    const sweep = pass % 2 === 0 ? sortedLayers.slice(1) : [...sortedLayers].reverse().slice(1)
    for (const currentLayer of sweep) {
      const related = pass % 2 === 0 ? forwardParents : forwardChildren
      const previous = new Map(byLayer.get(currentLayer)!.map((node, index) => [node.id, index]))
      byLayer.get(currentLayer)!.sort((a, b) => {
        const aCenter = barycenter(related.get(a.id) ?? [])
        const bCenter = barycenter(related.get(b.id) ?? [])
        if (aCenter !== null && bCenter !== null && aCenter !== bCenter) return aCenter - bCenter
        if (aCenter !== null && bCenter === null) return -1
        if (aCenter === null && bCenter !== null) return 1
        const branchDelta = branchRankForNode(a.id) - branchRankForNode(b.id)
        if (branchDelta !== 0) return branchDelta
        return (previous.get(a.id) ?? originalOrder.get(a.id) ?? 0) - (previous.get(b.id) ?? originalOrder.get(b.id) ?? 0)
      })
      refreshOrder()
    }
  }

  // Place layer by layer using measured dimensions when available, otherwise
  // conservative card estimates derived from branch-row count.
  const yOf = new Map<string, number>()
  const xOfLayer = new Map<number, number>()
  let layerX = 0
  for (const l of sortedLayers) {
    const group = byLayer.get(l)!
    xOfLayer.set(l, layerX)
    layerX += Math.max(...group.map((n) => nodeSize(n, options.sizes).width)) + LAYER_GAP
    let rowY = 0
    group.forEach((n) => {
      yOf.set(n.id, rowY)
      rowY += nodeSize(n, options.sizes).height + ROW_GAP
    })
  }

  return nodes.map((n) => ({
    ...n,
    x: xOfLayer.get(layer.get(n.id)!) ?? 0,
    y: yOf.get(n.id) ?? 0,
  }))
}

export type WorkflowRoutePoint = { x: number; y: number }
export type WorkflowEdgeRoute = {
  edgeId: string
  kind: 'forward' | 'back' | 'loop'
  lane: 'top' | 'bottom' | null
  points: WorkflowRoutePoint[]
  label: WorkflowRoutePoint
}

function branchAnchorY(node: WorkflowNode, edge: WorkflowEdge, size: WorkflowNodeSize): number {
  if (!edge.sourceHandle) return node.y + size.height / 2
  const rows = branchRows(node)
  const index = rows.findIndex((row) => row.key === edge.sourceHandle)
  return index < 0 ? node.y + size.height / 2 : node.y + (size.height * (index + 1)) / (rows.length + 1)
}

const ROUTE_CLEARANCE = 20

/** True when an orthogonal segment would visually pass through a card (with a
 * small breathing margin). Routes only need this conservative test to decide
 * whether a long forward connection belongs on an outside lane. */
function routeCrossesNode(
  points: WorkflowRoutePoint[],
  nodes: WorkflowNode[],
  sourceId: string,
  targetId: string,
  sizes?: WorkflowNodeSizeMap,
): boolean {
  for (const node of nodes) {
    if (node.id === sourceId || node.id === targetId) continue
    const size = nodeSize(node, sizes)
    const left = node.x - ROUTE_CLEARANCE
    const right = node.x + size.width + ROUTE_CLEARANCE
    const top = node.y - ROUTE_CLEARANCE
    const bottom = node.y + size.height + ROUTE_CLEARANCE
    for (let index = 1; index < points.length; index++) {
      const from = points[index - 1]!
      const to = points[index]!
      if (from.y === to.y && from.y >= top && from.y <= bottom) {
        if (Math.max(from.x, to.x) >= left && Math.min(from.x, to.x) <= right) return true
      }
      if (from.x === to.x && from.x >= left && from.x <= right) {
        if (Math.max(from.y, to.y) >= top && Math.min(from.y, to.y) <= bottom) return true
      }
    }
  }
  return false
}

/** Pure route metadata consumed by the custom React Flow edge. */
export function routeWorkflowEdges(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  sizes?: WorkflowNodeSizeMap,
): WorkflowEdgeRoute[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const top = Math.min(0, ...nodes.map((node) => node.y))
  const bottom = Math.max(0, ...nodes.map((node) => node.y + nodeSize(node, sizes).height))
  let topLaneIndex = 0
  let bottomLaneIndex = 0
  const reserveExternalLane = (start: WorkflowRoutePoint, end: WorkflowRoutePoint) => {
    // Keep the most relevant return route closest to its source/target row,
    // then fan matching routes outward instead of stacking them on one line.
    const midpoint = (top + bottom) / 2
    const lane: 'top' | 'bottom' = (start.y + end.y) / 2 <= midpoint ? 'top' : 'bottom'
    const laneNumber = lane === 'top' ? topLaneIndex++ : bottomLaneIndex++
    return {
      lane,
      laneY: lane === 'top' ? top - 64 - laneNumber * 44 : bottom + 64 + laneNumber * 44,
    }
  }

  return edges.flatMap<WorkflowEdgeRoute>((edge) => {
    const source = nodeById.get(edge.source)
    const target = nodeById.get(edge.target)
    if (!source || !target) return []
    const sourceSize = nodeSize(source, sizes)
    const targetSize = nodeSize(target, sizes)
    const start = { x: source.x + sourceSize.width, y: branchAnchorY(source, edge, sourceSize) }
    const end = { x: target.x, y: target.y + targetSize.height / 2 }
    const kind: WorkflowEdgeRoute['kind'] = source.id === target.id ? 'loop' : end.x <= start.x ? 'back' : 'forward'

    if (kind === 'forward') {
      const corridorX = Math.min(end.x - 28, start.x + Math.max(48, (end.x - start.x) * 0.45))
      const compactPoints = [start, { x: corridorX, y: start.y }, { x: corridorX, y: end.y }, end]
      if (!routeCrossesNode(compactPoints, nodes, source.id, target.id, sizes)) {
        return [{
          edgeId: edge.id,
          kind,
          lane: null,
          points: compactPoints,
          label: { x: start.x + Math.min(64, Math.max(28, corridorX - start.x)), y: start.y - 14 },
        }]
      }

      // A forward edge that skips one or more layers should never cut through
      // the cards it passes. Take a dedicated external channel instead; this
      // preserves the visual left-to-right direction without producing a
      // misleading line through a workflow step.
      const { lane, laneY } = reserveExternalLane(start, end)
      const sourceExitX = start.x + 40
      const targetEntryX = end.x - 40
      return [{
        edgeId: edge.id,
        kind,
        lane,
        points: [start, { x: sourceExitX, y: start.y }, { x: sourceExitX, y: laneY }, { x: targetEntryX, y: laneY }, { x: targetEntryX, y: end.y }, end],
        label: { x: start.x + 36, y: start.y - 14 },
      }]
    }

    const { lane, laneY } = reserveExternalLane(start, end)
    const sourceExitX = start.x + 40
    const targetEntryX = end.x - 40
    return [{
      edgeId: edge.id,
      kind,
      lane,
      points: [start, { x: sourceExitX, y: start.y }, { x: sourceExitX, y: laneY }, { x: targetEntryX, y: laneY }, { x: targetEntryX, y: end.y }, end],
      label: { x: start.x + 36, y: start.y - 14 },
    }]
  })
}

/** Layout only the selected node's canonical forward descendants. */
export function layoutSelectedBranch(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  selectedId: string,
  options: LayoutOptions = {},
): WorkflowNode[] {
  const selected = nodes.find((node) => node.id === selectedId)
  if (!selected) return nodes
  const canonical = layoutWorkflow(nodes, edges, options)
  const canonicalX = new Map(canonical.map((node) => [node.id, node.x]))
  const descendants = new Set([selectedId])
  const queue = [selectedId]
  while (queue.length > 0) {
    const source = queue.shift()!
    for (const edge of edges) {
      if (edge.source !== source || descendants.has(edge.target)) continue
      if ((canonicalX.get(edge.target) ?? -Infinity) <= (canonicalX.get(source) ?? Infinity)) continue
      descendants.add(edge.target)
      queue.push(edge.target)
    }
  }
  const branchNodes = nodes.filter((node) => descendants.has(node.id))
  const branchEdges = edges.filter((edge) => descendants.has(edge.source) && descendants.has(edge.target))
  const laid = layoutWorkflow(branchNodes, branchEdges, options)
  const laidSelected = laid.find((node) => node.id === selectedId)!
  const dx = selected.x - laidSelected.x
  const dy = selected.y - laidSelected.y
  const moved = new Map(laid.map((node) => [node.id, { ...node, x: node.x + dx, y: node.y + dy }]))
  return nodes.map((node) => moved.get(node.id) ?? node)
}

export function getSelectedWorkflowPath(edges: WorkflowEdge[], selectedId: string): {
  nodeIds: Set<string>
  edgeIds: Set<string>
} {
  const nodeIds = new Set([selectedId])
  const edgeIds = new Set<string>()
  const walk = (direction: 'ancestors' | 'descendants') => {
    const queue = [selectedId]
    const seen = new Set(queue)
    while (queue.length > 0) {
      const current = queue.shift()!
      for (const edge of edges) {
        const matches = direction === 'ancestors' ? edge.target === current : edge.source === current
        if (!matches) continue
        const next = direction === 'ancestors' ? edge.source : edge.target
        edgeIds.add(edge.id)
        nodeIds.add(next)
        if (!seen.has(next)) {
          seen.add(next)
          queue.push(next)
        }
      }
    }
  }
  walk('ancestors')
  walk('descendants')
  return { nodeIds, edgeIds }
}

function orientation(a: WorkflowRoutePoint, b: WorkflowRoutePoint, c: WorkflowRoutePoint): number {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y)
}

function segmentsCross(a: WorkflowRoutePoint, b: WorkflowRoutePoint, c: WorkflowRoutePoint, d: WorkflowRoutePoint): boolean {
  const first = orientation(a, b, c)
  const second = orientation(a, b, d)
  const third = orientation(c, d, a)
  const fourth = orientation(c, d, b)
  return first * second < 0 && third * fourth < 0
}

/** Fast, non-blocking crossing signal based on center-to-center edge geometry. */
export function countWorkflowCrossings(nodes: WorkflowNode[], edges: WorkflowEdge[], sizes?: WorkflowNodeSizeMap): number {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const segment = (edge: WorkflowEdge): [WorkflowRoutePoint, WorkflowRoutePoint] | null => {
    const source = nodeById.get(edge.source)
    const target = nodeById.get(edge.target)
    if (!source || !target || source.id === target.id) return null
    const sourceSize = nodeSize(source, sizes)
    const targetSize = nodeSize(target, sizes)
    return [
      { x: source.x + sourceSize.width / 2, y: source.y + sourceSize.height / 2 },
      { x: target.x + targetSize.width / 2, y: target.y + targetSize.height / 2 },
    ]
  }
  let crossings = 0
  for (let left = 0; left < edges.length; left++) {
    const firstEdge = edges[left]!
    const first = segment(firstEdge)
    if (!first) continue
    for (let right = left + 1; right < edges.length; right++) {
      const secondEdge = edges[right]!
      if ([firstEdge.source, firstEdge.target].some((id) => id === secondEdge.source || id === secondEdge.target)) continue
      const second = segment(secondEdge)
      if (second && segmentsCross(first[0], first[1], second[0], second[1])) crossings++
    }
  }
  return crossings
}
