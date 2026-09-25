import type { WorkflowDocument, WorkflowEdge, WorkflowGroup, WorkflowNode } from '../../types'
import { estimateWorkflowNodeSize, layoutWorkflow, routeWorkflowEdges, type WorkflowNodeSizeMap } from '../../workflowLayout'

export const GRID = 16
const GAP = 64
const PAD = 32
const HEADER = 80
export const COLLAPSED_SIZE = { width: 240, height: 96 }
export const snap = (value: number) => Math.round(value / GRID) * GRID
const ceil = (value: number) => Math.ceil(value / GRID) * GRID

export interface WorkflowCanvasGraph {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  groups?: WorkflowGroup[]
}

export function cleanGroups(groups: WorkflowGroup[], nodes: WorkflowNode[]): WorkflowGroup[] {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const claimed = new Set<string>()
  const ids = new Set(nodeIds)
  return groups.flatMap((group) => {
    if (ids.has(group.id)) return []
    ids.add(group.id)
    const nodeIdsInGroup = group.nodeIds.filter((id) => {
      if (!nodeIds.has(id) || claimed.has(id)) return false
      claimed.add(id)
      return true
    })
    return nodeIdsInGroup.length ? [{ ...group, nodeIds: nodeIdsInGroup }] : []
  })
}

export function workflowDocument(graph: WorkflowCanvasGraph, previous?: WorkflowDocument): WorkflowDocument {
  return {
    version: 2,
    definition: {
      nodes: graph.nodes.map(({ x: _x, y: _y, ...node }) => node),
      edges: graph.edges,
    },
    presentation: {
      ...previous?.presentation,
      nodes: Object.fromEntries(graph.nodes.map((node) => [node.id, {
        ...previous?.presentation.nodes[node.id], x: node.x, y: node.y,
      }])),
      groups: cleanGroups(graph.groups ?? [], graph.nodes),
    },
  }
}

export interface Box { id: string; x: number; y: number; width: number; height: number }
export function overlaps(a: Box, b: Box, gap = GAP): boolean {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap && a.y + a.height + gap > b.y
}

export interface ProjectedNode {
  node: WorkflowNode
  parentId?: string
  position: { x: number; y: number }
  absolute: { x: number; y: number }
}
export interface ProjectedGroup extends Box {
  group: WorkflowGroup
  sourceHandles: string[]
  targetHandles: string[]
}
export interface ProjectedEdge extends WorkflowEdge { targetHandle?: string }

/** Derive display coordinates from saved coordinates on every toggle. Never
 * accumulate offsets: collapsing restores the same compact layout each time. */
export function projectWorkflow(nodes: WorkflowNode[], edges: WorkflowEdge[], rawGroups: WorkflowGroup[], sizes: WorkflowNodeSizeMap = {}) {
  const groups = cleanGroups(rawGroups, nodes)
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const membership = new Map(groups.flatMap((group) => group.nodeIds.map((id) => [id, group] as const)))
  const sizeOf = (node: WorkflowNode) => sizes[node.id] ?? estimateWorkflowNodeSize(node)
  const origins = new Map<string, { x: number; y: number }>()
  const collapsedSpace: Box[] = []
  const boxes: Box[] = groups.map((group) => {
    const children = group.nodeIds.map((id) => byId.get(id)!)
    const x = Math.floor((Math.min(...children.map((node) => node.x)) - PAD) / GRID) * GRID
    const y = Math.floor((Math.min(...children.map((node) => node.y)) - HEADER) / GRID) * GRID
    origins.set(group.id, { x, y })
    const width = ceil(Math.max(...children.map((node) => node.x + sizeOf(node).width)) - x + PAD)
    const height = ceil(Math.max(...children.map((node) => node.y + sizeOf(node).height)) - y + PAD)
    if (group.collapsed) collapsedSpace.push({ id: group.id, x, y, width, height })
    return {
      id: group.id, x, y,
      width: group.collapsed ? COLLAPSED_SIZE.width : width,
      height: group.collapsed ? COLLAPSED_SIZE.height : height,
    }
  })
  nodes.filter((node) => !membership.has(node.id)).forEach((node) => {
    origins.set(node.id, { x: node.x, y: node.y })
    boxes.push({ id: node.id, x: node.x, y: node.y, ...sizeOf(node) })
  })
  // Deterministic left-to-right packing preserves row order and moves only
  // colliding containers. Each move clears at least one previously placed box.
  const placed: Box[] = []
  for (const box of boxes.sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id))) {
    // Reclaim space reserved by a previously expanded group to the left.
    // Use saved origins, not already shifted coordinates, to avoid drift.
    const originalX = box.x
    box.x -= collapsedSpace.filter((space) => space.id !== box.id &&
      space.x + space.width <= originalX && box.y < space.y + space.height && box.y + box.height > space.y
    ).reduce((total, space) => total + Math.max(0, space.width - COLLAPSED_SIZE.width), 0)
    let collisions = placed.filter((other) => overlaps(box, other))
    while (collisions.length) {
      box.x = ceil(Math.max(...collisions.map((other) => other.x + other.width + GAP)))
      collisions = placed.filter((other) => overlaps(box, other))
    }
    placed.push(box)
  }
  const boxById = new Map(placed.map((box) => [box.id, box]))
  const projectedNodes: ProjectedNode[] = nodes.flatMap((node) => {
    const group = membership.get(node.id)
    if (group?.collapsed) return []
    const parentId = group?.id
    const id = parentId ?? node.id
    const origin = origins.get(id)!
    const box = boxById.get(id)!
    const absolute = { x: node.x + box.x - origin.x, y: node.y + box.y - origin.y }
    return [{ node, parentId, absolute, position: parentId ? { x: node.x - origin.x, y: node.y - origin.y } : absolute }]
  })
  const projectedEdges: ProjectedEdge[] = edges.flatMap((edge) => {
    const sourceGroup = membership.get(edge.source)
    const targetGroup = membership.get(edge.target)
    if (sourceGroup?.collapsed && sourceGroup === targetGroup) return []
    return [{
      ...edge,
      source: sourceGroup?.collapsed ? sourceGroup.id : edge.source,
      target: targetGroup?.collapsed ? targetGroup.id : edge.target,
      sourceHandle: sourceGroup?.collapsed ? 'out:' + edge.id : edge.sourceHandle,
      targetHandle: targetGroup?.collapsed ? 'in:' + edge.id : undefined,
    }]
  })
  const projectedGroups: ProjectedGroup[] = groups.map((group) => ({
    ...boxById.get(group.id)!, group,
    sourceHandles: projectedEdges.filter((edge) => edge.source === group.id).map((edge) => edge.sourceHandle!),
    targetHandles: projectedEdges.filter((edge) => edge.target === group.id).map((edge) => edge.targetHandle!),
  }))
  return { nodes: projectedNodes, edges: projectedEdges, groups: projectedGroups, boxes: placed }
}

export function routeProjectedWorkflow(projection: ReturnType<typeof projectWorkflow>, sizes: WorkflowNodeSizeMap = {}) {
  // Expanded parents are backgrounds, not obstacles; including them would
  // force every internal connector to detour outside its own group.
  const nodes: WorkflowNode[] = [
    ...projection.nodes.map(({ node, absolute }) => ({ ...node, x: absolute.x, y: absolute.y })),
    ...projection.groups.filter(({ group }) => group.collapsed).map((group) => ({
      id: group.id, kind: 'action' as const, type: 'action.end', config: {}, x: group.x, y: group.y,
    })),
  ]
  const groupSizes = Object.fromEntries(projection.groups.map((group) => [group.id, { width: group.width, height: group.height }]))
  return routeWorkflowEdges(nodes, projection.edges, { ...sizes, ...groupSizes })
}

/** Lay out each subgraph first, then pack its container with the other groups. */
export function layoutGroupedWorkflow(nodes: WorkflowNode[], edges: WorkflowEdge[], groups: WorkflowGroup[], sizes?: WorkflowNodeSizeMap): WorkflowNode[] {
  if (!groups.length) return layoutWorkflow(nodes, edges, { sizes })
  const normalized = cleanGroups(groups, nodes)
  const groupedIds = new Set(normalized.flatMap((group) => group.nodeIds))
  const clusters = normalized.map((group) => ({ id: group.id, nodes: nodes.filter((node) => group.nodeIds.includes(node.id)) }))
  clusters.push(...nodes.filter((node) => !groupedIds.has(node.id)).map((node) => ({ id: node.id, nodes: [node] })))
  const local = clusters.map((cluster) => {
    const ids = new Set(cluster.nodes.map((node) => node.id))
    const laidOut = layoutWorkflow(cluster.nodes, edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)), { sizes })
    const minX = Math.min(...laidOut.map((node) => node.x))
    const minY = Math.min(...laidOut.map((node) => node.y))
    return { ...cluster, nodes: laidOut.map((node) => ({ ...node, x: node.x - minX + PAD, y: node.y - minY + HEADER })) }
  })
  const owner = new Map(local.flatMap((cluster) => cluster.nodes.map((node) => [node.id, cluster.id] as const)))
  const clusterSizes = Object.fromEntries(local.map((cluster) => [cluster.id, {
    width: ceil(Math.max(...cluster.nodes.map((node) => node.x + (sizes?.[node.id] ?? estimateWorkflowNodeSize(node)).width)) + PAD),
    height: ceil(Math.max(...cluster.nodes.map((node) => node.y + (sizes?.[node.id] ?? estimateWorkflowNodeSize(node)).height)) + PAD),
  }]))
  const skeleton = local.map((cluster) => ({ ...cluster.nodes[0]!, id: cluster.id, x: 0, y: 0 }))
  const links = edges.flatMap((edge) => {
    const source = owner.get(edge.source), target = owner.get(edge.target)
    return source && target && source !== target ? [{ ...edge, source, target }] : []
  })
  const positions = new Map(layoutWorkflow(skeleton, links, { sizes: clusterSizes }).map((node) => [node.id, node]))
  const result = new Map(local.flatMap((cluster) => cluster.nodes.map((node) => {
    const position = positions.get(cluster.id)!
    return [node.id, { ...node, x: snap(node.x + position.x), y: snap(node.y + position.y) }] as const
  })))
  return nodes.map((node) => result.get(node.id)!)
}
