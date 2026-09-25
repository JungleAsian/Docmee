'use client'

import { useStore } from '@xyflow/react'

export type ZoomTier = 'full' | 'balanced' | 'macro'
export const zoomTier = (zoom: number): ZoomTier => zoom > 0.75 ? 'full' : zoom >= 0.4 ? 'balanced' : 'macro'

// Subscribe to a primitive tier, not the transform: panning and zooming within
// a tier do not re-render node content or recompute graph layout.
const selectTier = (state: { transform: [number, number, number] }) => zoomTier(state.transform[2])
export function useSemanticZoom(): ZoomTier {
  return useStore(selectTier)
}
