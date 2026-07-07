'use client'

import { useEffect, useMemo, useState } from 'react'

type MonitorData = {
  generatedAt: string
  live: boolean
  run: { pid?: number; status?: string; phase?: string; heartbeatAt?: string; heartbeatAgeMs?: number; resumeAt?: string; message?: string }
  heartbeat: { status: string; samples: Array<{ value: number; status: string }> }
  ready: { ok: boolean; pass: number; warning: number; critical: number }
  startReadiness: { ok: boolean; phase?: string }
  active?: { id: string; name: string; notes?: string }
  progress: { done: number; total: number; percent: number; failed: number }
  claudeUsage: { session: { available: boolean; percent: number; resetAt?: string; tokens: number; messages: number } }
  phases: Array<{ id: string; name: string; phaseStatus: string; buildStatus: string; notes?: string; startedAt?: string; stoppedAt?: string }>
  recentEvents: string[]
}

function duration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return 'not started'
  const seconds = Math.floor(ms / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${rest}s`
  return `${rest}s`
}

function timeAgo(iso?: string) {
  if (!iso) return 'never'
  const delta = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(delta)) return 'unknown'
  if (delta < 60_000) return `${Math.max(0, Math.round(delta / 1000))}s ago`
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`
  return `${Math.round(delta / 3_600_000)}h ago`
}

function timeUntil(iso?: string) {
  if (!iso) return 'unknown'
  const delta = new Date(iso).getTime() - Date.now()
  if (!Number.isFinite(delta)) return 'unknown'
  if (delta <= 0) return 'ready'
  return duration(delta)
}

function compact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`
  return String(value || 0)
}

function sampleAmplitude(status: string) {
  if (status === 'normal') return 34
  if (status === 'sentinel') return 28
  if (status === 'paused') return 22
  if (status === 'delayed') return 18
  if (status === 'lost' || status === 'dead') return 8
  return 14
}

function ecgPath(samples: Array<{ value: number; status?: string }>, status: string) {
  const width = 360
  const baseline = 66
  const recent = samples.slice(-24)
  const trace = recent.length > 0 ? recent : Array.from({ length: 12 }, () => ({ value: status === 'normal' ? 1 : 0.05, status }))
  const beatWidth = width / Math.max(1, trace.length)
  let d = `M0 ${baseline}`
  for (let beat = 0; beat < trace.length; beat += 1) {
    const sample = trace[beat]
    const sampleStatus = sample.status ?? status
    const value = Math.max(0.05, Math.min(1, Number(sample.value) || 0.05))
    const scaled = sampleAmplitude(sampleStatus) * value
    const x = beat * beatWidth
    if (sampleStatus === 'stopped' || sampleStatus === 'dead') {
      d += ` L${Math.round(x + beatWidth)} ${baseline + (beat % 2 === 0 ? 1 : -1)}`
      continue
    }
    d += [
      [x + beatWidth * 0.12, baseline],
      [x + beatWidth * 0.24, baseline - scaled * 0.12],
      [x + beatWidth * 0.34, baseline + scaled * 0.28],
      [x + beatWidth * 0.42, baseline - scaled],
      [x + beatWidth * 0.50, baseline + scaled * 0.46],
      [x + beatWidth * 0.62, baseline],
      [x + beatWidth * 0.84, baseline - scaled * 0.16],
      [x + beatWidth, baseline]
    ].map(([px, py]) => ` L${Math.round(px)} ${Math.round(py)}`).join('')
  }
  return d
}

function statusClass(status: string) {
  if (['complete', 'done'].includes(status)) return 'bg-emerald-900 text-emerald-100'
  if (status === 'paused') return 'bg-amber-900 text-amber-100'
  if (['in-progress', 'running', 'gates-running', 'pushing'].includes(status)) return 'bg-cyan-900 text-cyan-100'
  if (status === 'failed') return 'bg-red-900 text-red-100'
  return 'bg-slate-800 text-slate-300'
}

export function InstallMonitorClient() {
  const [data, setData] = useState<MonitorData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function refresh() {
      try {
        const response = await fetch('/api/install-monitor/status', { cache: 'no-store' })
        if (!response.ok) throw new Error(`Status ${response.status}`)
        const next = await response.json() as MonitorData
        if (active) {
          setData(next)
          setError('')
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err))
      }
    }
    refresh()
    const timer = setInterval(refresh, 3000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])

  const heartbeat = data?.heartbeat.status ?? 'stopped'
  const heartbeatTone = ['normal'].includes(heartbeat) ? 'text-emerald-300' : heartbeat === 'paused' || heartbeat === 'delayed' ? 'text-amber-300' : ['lost', 'dead'].includes(heartbeat) ? 'text-red-300' : 'text-slate-300'
  const path = useMemo(() => ecgPath(data?.heartbeat.samples ?? [], heartbeat), [data?.heartbeat.samples, heartbeat])

  if (!data) {
    return <div className="rounded-md border border-slate-800 bg-slate-900 p-5 text-sm text-slate-400">{error || 'Reading installation monitor status...'}</div>
  }

  return (
    <div className="space-y-6">
      {error && <p className="rounded-md border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
      <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-md border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm text-slate-400">Current step</div>
              <h2 className="mt-1 text-2xl font-semibold">{data.active?.id ?? '--'} - {data.active?.name ?? 'No active phase'}</h2>
              <p className="mt-2 text-sm text-slate-400">{data.active?.notes || data.run.message || 'No current note.'}</p>
            </div>
            <span className={`rounded px-2 py-1 text-xs ${statusClass(data.run.status ?? 'idle')}`}>{data.run.status ?? 'idle'}</span>
          </div>
          <div className="mt-6 h-3 rounded bg-slate-800"><div className="h-3 rounded bg-cyan-500" style={{ width: `${data.progress.percent}%` }} /></div>
          <div className="mt-2 flex justify-between text-xs text-slate-500"><span>{data.progress.done}/{data.progress.total} complete</span><span>Updated {timeAgo(data.generatedAt)}</span></div>
        </div>

        <div className="rounded-md border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Heartbeat</h2>
            <span className={heartbeatTone}>{heartbeat}</span>
          </div>
          <div className="relative mt-4 overflow-hidden rounded-md border border-emerald-900/40 bg-[#04100d]">
            <svg viewBox="0 0 360 120" className="h-32 w-full">
              <defs>
                <pattern id="monitorGridSmall" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="rgba(55,211,153,.08)" /></pattern>
                <pattern id="monitorGridMajor" width="50" height="50" patternUnits="userSpaceOnUse"><rect width="50" height="50" fill="url(#monitorGridSmall)" /><path d="M50 0H0V50" fill="none" stroke="rgba(55,211,153,.16)" /></pattern>
              </defs>
              <rect width="360" height="120" fill="url(#monitorGridMajor)" />
              <path d={path} fill="none" stroke={heartbeat === 'normal' ? '#37d399' : heartbeat === 'paused' || heartbeat === 'delayed' ? '#f4b94f' : '#ff6b6b'} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className={heartbeat === 'normal' ? 'ecg-trace-live' : ''} />
            </svg>
            <span className="absolute right-3 top-3 rounded-full border border-slate-700 bg-slate-950/80 px-2 py-1 text-xs">{heartbeat === 'normal' ? 'Normal' : heartbeat === 'paused' ? 'Paused' : heartbeat}</span>
          </div>
          <p className="mt-3 text-sm text-slate-400">{data.live ? `Last heartbeat ${timeAgo(data.run.heartbeatAt)}` : 'No live process detected'} {data.run.resumeAt ? `· resumes in ${timeUntil(data.run.resumeAt)}` : ''}</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4"><div className="text-xs text-slate-500">Setup Check</div><div className={data.ready.ok ? 'mt-2 text-xl text-emerald-300' : 'mt-2 text-xl text-amber-300'}>{data.ready.ok ? 'Ready' : 'Needs check'}</div><p className="mt-1 text-xs text-slate-500">{data.ready.pass} pass · {data.ready.warning} warning · {data.ready.critical} critical</p></div>
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4"><div className="text-xs text-slate-500">Start Check</div><div className={data.startReadiness.ok ? 'mt-2 text-xl text-emerald-300' : 'mt-2 text-xl text-amber-300'}>{data.startReadiness.ok ? 'Passed' : 'Not passed'}</div><p className="mt-1 text-xs text-slate-500">{data.startReadiness.phase ?? 'No phase'}</p></div>
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4"><div className="text-xs text-slate-500">Failures</div><div className={data.progress.failed > 0 ? 'mt-2 text-xl text-red-300' : 'mt-2 text-xl text-emerald-300'}>{data.progress.failed}</div><p className="mt-1 text-xs text-slate-500">Build control records</p></div>
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4"><div className="text-xs text-slate-500">Claude Session</div><div className="mt-2 text-xl">{data.claudeUsage.session.available ? `${data.claudeUsage.session.percent}% time` : '--'}</div><p className="mt-1 text-xs text-slate-500">{compact(data.claudeUsage.session.tokens)} tokens · reset {timeUntil(data.claudeUsage.session.resetAt)}</p></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-semibold">Phase Timeline</h2>
          <div className="mt-4 grid gap-2">
            {data.phases.map((phase) => {
              const tag = phase.buildStatus !== 'pending' ? phase.buildStatus : phase.phaseStatus
              return <div key={phase.id} className="grid grid-cols-[52px_1fr_auto] items-center gap-3 rounded border border-slate-800 bg-slate-950/40 px-3 py-2"><strong className="text-cyan-300">{phase.id}</strong><div className="min-w-0"><div className="text-sm">{phase.name}</div><div className="truncate text-xs text-slate-500">{phase.notes || 'Waiting'}</div></div><span className={`rounded px-2 py-1 text-xs ${statusClass(tag)}`}>{tag}</span></div>
            })}
          </div>
        </div>
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-semibold">Recent Activity</h2>
          <div className="mt-4 max-h-[620px] space-y-2 overflow-auto">
            {data.recentEvents.length === 0 ? <p className="text-sm text-slate-400">No recent activity.</p> : data.recentEvents.slice().reverse().map((line, index) => <div key={`${index}-${line}`} className="border-l-2 border-slate-700 bg-slate-950/50 px-3 py-2 font-mono text-xs text-slate-300">{line}</div>)}
          </div>
        </div>
      </div>
    </div>
  )
}
