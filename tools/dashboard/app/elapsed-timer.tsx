'use client'

import { useEffect, useState } from 'react'

// Live elapsed-time counter for long-running processes. Ticks every second from
// `startedAt`. If `processed`/`total` are given, also shows an ETA estimated from
// the average time per item so far ("4m 12s · ~5m left").
function fmt(secs: number): string {
  const s = Math.max(0, Math.floor(secs))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export function ElapsedTimer({
  startedAt,
  processed,
  total,
  prefix = '',
  className = ''
}: {
  startedAt?: string
  processed?: number
  total?: number
  prefix?: string
  className?: string
}) {
  // Start null on both server + client so the first render matches (no hydration
  // mismatch); the effect fills it in and ticks every second on the client.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const start = startedAt ? Date.parse(startedAt) : NaN
  if (!Number.isFinite(start)) return null
  const elapsed = ((now ?? start) - start) / 1000

  let eta = ''
  if (typeof processed === 'number' && typeof total === 'number' && processed > 0 && total > processed && elapsed > 2) {
    const remaining = Math.round((elapsed / processed) * (total - processed))
    eta = ` · ~${fmt(remaining)} left`
  }

  return <span className={className} title={`Running for ${fmt(elapsed)}${eta}`}>{prefix}{fmt(elapsed)}{eta}</span>
}
