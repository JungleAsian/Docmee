'use client'

import { useEffect, useMemo, useState } from 'react'

type MonitorData = {
  live: boolean
  run: { status?: string; phase?: string; heartbeatAt?: string; message?: string }
  heartbeat: { status: string }
  progress: { done: number; total: number; percent: number; failed: number }
  active?: { id: string; name: string; buildStatus?: string; phaseStatus?: string }
  phases: Array<{ id: string; name: string; phaseStatus: string; buildStatus: string }>
}

type GaugeState = 'progressing' | 'halted' | 'stopped' | 'complete'

type Props = {
  phaseId?: string
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  percent?: number
  state?: GaugeState
  label?: string
  message?: string
  centerText?: string
}

let sharedData: MonitorData | null = null
let sharedTimer: ReturnType<typeof setInterval> | null = null
let inFlight = false
const listeners = new Set<(data: MonitorData | null) => void>()

async function refreshSharedData() {
  if (inFlight) return
  inFlight = true
  try {
    const response = await fetch('/api/install-monitor/status', { cache: 'no-store' })
    if (!response.ok) return
    sharedData = await response.json() as MonitorData
    for (const listener of listeners) listener(sharedData)
  } catch {
    // Keep the last known gauge state on transient dashboard polling failures.
  } finally {
    inFlight = false
  }
}

function subscribe(listener: (data: MonitorData | null) => void) {
  listeners.add(listener)
  listener(sharedData)
  if (!sharedData) void refreshSharedData()
  if (!sharedTimer) sharedTimer = setInterval(refreshSharedData, 3000)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && sharedTimer) {
      clearInterval(sharedTimer)
      sharedTimer = null
    }
  }
}

function gaugeState(data: MonitorData, phaseId?: string): GaugeState {
  const heartbeat = data.heartbeat.status
  if (phaseId) {
    const phase = data.phases.find((item) => item.id === phaseId)
    if (phase?.phaseStatus === 'done' || phase?.buildStatus === 'complete') return 'complete'
    if (phase?.buildStatus === 'failed') return 'halted'
    if (phaseId === data.run.phase && data.live && ['normal', 'sentinel'].includes(heartbeat)) return 'progressing'
    if (phaseId === data.run.phase && ['paused', 'delayed', 'lost', 'dead'].includes(heartbeat)) return 'halted'
    if (phase?.buildStatus === 'paused') return 'halted'
    return 'stopped'
  }
  if (data.progress.done >= data.progress.total && data.progress.total > 0) return 'complete'
  if (data.live && ['normal', 'sentinel'].includes(heartbeat)) return 'progressing'
  if (data.live || ['paused', 'delayed', 'lost', 'dead'].includes(heartbeat)) return 'halted'
  return 'stopped'
}

function percentFor(data: MonitorData, state: GaugeState, phaseId?: string) {
  if (!phaseId) return data.progress.percent
  if (state === 'complete') return 100
  if (state === 'progressing') return Math.max(8, data.progress.percent)
  return 0
}

function colorFor(state: GaugeState) {
  if (state === 'progressing') return '#34d399'
  if (state === 'halted') return '#f59e0b'
  if (state === 'complete') return '#14b8a6'
  return '#64748b'
}

function labelFor(state: GaugeState) {
  if (state === 'progressing') return 'Progressing'
  if (state === 'halted') return 'Halted'
  if (state === 'complete') return 'Complete'
  return 'Stopped'
}

function sizeClass(size: Props['size']) {
  if (size === 'sm') return 'h-10 w-10 text-[10px]'
  if (size === 'lg') return 'h-24 w-24 text-sm'
  return 'h-16 w-16 text-xs'
}

export function BuildProgressGauge({ phaseId, size = 'md', showLabel = true, percent: percentOverride, state: stateOverride, label: labelOverride, message, centerText }: Props) {
  // A gauge with explicit percent + state is fully controlled by props, so it
  // never needs live monitor data. Skipping the subscription avoids a fetch per
  // instance — pages that render dozens of gauges (e.g. the deployment lanes)
  // would otherwise stampede /api/install-monitor/status on mount.
  const controlled = percentOverride !== undefined && stateOverride !== undefined
  const [data, setData] = useState<MonitorData | null>(null)

  useEffect(() => {
    if (controlled) return
    return subscribe(setData)
  }, [controlled])

  const state = stateOverride ?? (data ? gaugeState(data, phaseId) : 'stopped')
  const percent = percentOverride ?? (data ? percentFor(data, state, phaseId) : 0)
  const color = colorFor(state)
  const label = labelOverride ?? labelFor(state)
  const pulse = state === 'progressing' ? 'animate-pulse' : ''
  const background = useMemo(() => `conic-gradient(${color} ${percent * 3.6}deg, rgba(100,116,139,.28) 0deg)`, [color, percent])

  return (
    <div className="flex min-w-0 items-center gap-3">
      <div
        className={`${sizeClass(size)} ${pulse} grid shrink-0 place-items-center rounded-full p-1`}
        style={{ background }}
        aria-label={`${label}${phaseId ? ` ${phaseId}` : ''}`}
        title={`${label}${phaseId ? ` ${phaseId}` : ''}`}
      >
        <div className="grid h-full w-full place-items-center rounded-full bg-slate-950 font-semibold text-slate-100">
          {centerText ?? (phaseId ? phaseId.replace('P', '') : `${percent}%`)}
        </div>
      </div>
      {showLabel && (
        <div className="min-w-0">
          <div className="text-sm font-medium" style={{ color }}>{label}</div>
          <div className="truncate text-xs text-slate-500">{message ?? data?.run.message ?? 'Waiting for heartbeat'}</div>
        </div>
      )}
    </div>
  )
}
