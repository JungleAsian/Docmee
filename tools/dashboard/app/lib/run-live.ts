// Shared run-liveness helpers for the build lanes. A watcher whose PID is alive
// but hasn't written a heartbeat recently is hung/stale and should NOT count as
// live — otherwise the Start button stays locked forever. Watchers heartbeat
// every 10-15s (even during a Claude session), so 3 minutes is a safe threshold.
// `paused` runs (Claude usage-limit wait) are intentionally idle and never stale.
export const RUNNING_STATUSES = ['starting', 'running', 'paused']

// Is a watcher PID still alive? Shared across the lane pages (server-only).
export function isProcessAlive(pid?: number) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// Human "Xs ago" / "Xm ago" since the last heartbeat (null when unknown).
export function heartbeatAge(heartbeatAt?: string) {
  if (!heartbeatAt) return null
  const ageMs = Date.now() - new Date(heartbeatAt).getTime()
  if (!Number.isFinite(ageMs) || ageMs < 0) return null
  if (ageMs < 60000) return `${Math.max(1, Math.round(ageMs / 1000))}s ago`
  return `${Math.round(ageMs / 60000)}m ago`
}

export function isHeartbeatFresh(heartbeatAt?: string, maxAgeMs = 180000) {
  if (!heartbeatAt) return true // nothing recorded yet — don't force-stale a just-started run
  const stamp = new Date(heartbeatAt).getTime()
  if (Number.isNaN(stamp)) return true
  return Date.now() - stamp <= maxAgeMs
}

// `alive` is the caller's process.kill(pid, 0) result (kept in the server page).
export function runLiveness(run: { status?: string; heartbeatAt?: string }, alive: boolean) {
  const running = alive && RUNNING_STATUSES.includes(run.status ?? '')
  const fresh = run.status === 'paused' || isHeartbeatFresh(run.heartbeatAt)
  return { live: running && fresh, stale: running && !fresh }
}
