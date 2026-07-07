import { claudeUsageGuardFile } from '../lib/paths.js'
import { readJsonFile } from '../lib/json-store.js'

export interface SessionStatus {
  pct: number | null
  paused: boolean
  resumeAt: string | null
  accountMismatch: boolean
}

type UsageGuard = { usagePct?: number; percent?: number; paused?: boolean; resumeAt?: string; accountMismatch?: boolean }

export function readSessionStatus(): SessionStatus {
  const g = readJsonFile<UsageGuard>(claudeUsageGuardFile, {})
  return {
    pct: g.usagePct ?? g.percent ?? null,
    paused: Boolean(g.paused),
    resumeAt: g.resumeAt ?? null,
    accountMismatch: Boolean(g.accountMismatch)
  }
}

/**
 * Session guard — read before every Claude Code invocation (Cortex spec). Blocks
 * when paused or over the configured threshold so we never burn a hard limit mid-fix.
 */
export function canInvokeClaude(thresholdPct: number): { ok: boolean; reason: string; status: SessionStatus } {
  const status = readSessionStatus()
  if (status.accountMismatch) return { ok: false, reason: 'Claude account mismatch — fix in Claude Switch first.', status }
  if (status.paused) return { ok: false, reason: `Claude session paused, resuming at ${status.resumeAt ?? 'unknown'}.`, status }
  if (typeof status.pct === 'number' && status.pct >= thresholdPct) {
    return { ok: false, reason: `Claude usage ${status.pct}% ≥ guard threshold ${thresholdPct}%.`, status }
  }
  return { ok: true, reason: 'ok', status }
}
