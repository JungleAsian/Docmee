'use client'

import { memo } from 'react'
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'
import type { WorkflowEdgeRoute } from '../../workflowLayout'
import { GRID } from './LayoutUtils'
import { useSemanticZoom } from './SemanticZoom'

type Point = { x: number; y: number }
export type RoutedEdgeData = {
  route: WorkflowEdgeRoute
  label?: string
  color: string
  dimmed: boolean
  emphasized: boolean
  hovered: boolean
}

export function orthogonalPath(points: Point[]): string {
  const normalized: Point[] = []
  for (const point of points) {
    const last = normalized.at(-1)
    if (last?.x === point.x && last.y === point.y) continue
    if (last && last.x !== point.x && last.y !== point.y) normalized.push({ x: point.x, y: last.y })
    const before = normalized.at(-2), previous = normalized.at(-1)
    if (before && previous && ((before.x === previous.x && previous.x === point.x) || (before.y === previous.y && previous.y === point.y))) {
      normalized[normalized.length - 1] = point
    } else normalized.push(point)
  }
  return normalized.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
}

export function gridRoute(source: Point, target: Point, template: Point[]): Point[] {
  const snap = (n: number) => Math.round(n / GRID) * GRID
  const exitX = Math.max(Math.ceil((source.x + GRID) / GRID) * GRID, snap(template[1]?.x ?? source.x + 32))
  const enterX = Math.min(Math.floor((target.x - GRID) / GRID) * GRID, snap(template.at(-2)?.x ?? target.x - 32))
  const sourceY = snap(source.y), targetY = snap(target.y)
  const interior = template.slice(2, -2).map((point) => ({ x: snap(point.x), y: snap(point.y) }))
  // Only the short port stubs leave the grid; all routing corridors snap to it.
  // Backward links and self-loops get an outer lane instead of cutting a card.
  if (!interior.length && enterX < exitX) {
    const lane = Math.floor((Math.min(source.y, target.y) - 128) / GRID) * GRID
    interior.push({ x: exitX, y: lane }, { x: enterX, y: lane })
  }
  return [source, { x: exitX, y: source.y }, { x: exitX, y: sourceY }, ...interior,
    { x: enterX, y: targetY }, { x: enterX, y: target.y }, target]
}

export const OrthogonalEdge = memo(function OrthogonalEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, style, data }: EdgeProps) {
  const tier = useSemanticZoom()
  const routed = data as RoutedEdgeData | undefined
  const path = orthogonalPath(gridRoute({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, routed?.route.points ?? []))
  return <>
    {/* A canvas-colored casing makes crossing routes readable without curves. */}
    <path d={path} fill="none" stroke="var(--crm-workflow-canvas-bg, #1f2937)" strokeWidth={Number(style?.strokeWidth ?? 2) + 4} style={{ pointerEvents: 'none' }} />
    <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ ...style, strokeLinejoin: 'miter' }} />
    {tier === 'full' && routed?.label && <EdgeLabelRenderer>
      <span className="pointer-events-none absolute rounded bg-gray-950/90 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm"
        style={{ transform: `translate(-50%, -50%) translate(${sourceX + 40}px, ${sourceY - 14}px)`, opacity: routed.dimmed ? 0.45 : 1, zIndex: routed.hovered ? 10001 : 1 }}>
        {routed.label}
      </span>
    </EdgeLabelRenderer>}
  </>
})
