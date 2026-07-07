import { buildTargets, type BeaconTarget } from './targets.js'
import { resolveConflict } from './conflict-resolver.js'
import { httpProbe, tcpProbe } from '../lib/net.js'
import { heartbeatAgeMs } from '../lib/heartbeat.js'
import { readJsonFile } from '../lib/json-store.js'
import { buildRunFile } from '../lib/paths.js'
import type { SentinelConfig } from '../config/schema.js'
import type { IssueDraft, SentinelSeverity } from '../lib/issues.js'

export interface BeaconTargetStatus {
  id: string
  label: string
  category: string
  state: 'ok' | 'stale' | 'unknown' | 'skipped'
  lastChecked: string | null
  lastOk: string | null
  responseTimeMs: number | null
  failingForSeconds: number | null
  detail: string
  vpsOwned: boolean
}

export interface BeaconDeps {
  getConfig(): SentinelConfig
  /** Replace the heartbeat-source issue set with these drafts. */
  writeHeartbeatIssues(drafts: IssueDraft[]): void
  notifyAlert(severity: SentinelSeverity, title: string, message: string): void
  notifyActivity(title: string, message: string): void
  push(severity: SentinelSeverity, title: string, message: string): void
  recomputeTray(): void
  triggerHealer(targetId: string): void
  reportAlive(): void
}

interface TargetState {
  lastChecked: number | null
  lastOk: number | null
  failingSince: number | null
  responseTimeMs: number | null
  stale: boolean
  detail: string
}

function buildActive() {
  const run = readJsonFile<{ status?: string }>(buildRunFile, {})
  return ['starting', 'running', 'paused'].includes(run.status ?? '')
}

export class BeaconWatcher {
  private deps: BeaconDeps
  private targets: BeaconTarget[] = []
  private states = new Map<string, TargetState>()
  private timers: NodeJS.Timeout[] = []
  private aliveTimer: NodeJS.Timeout | null = null
  private running = false

  constructor(deps: BeaconDeps) {
    this.deps = deps
  }

  start() {
    this.running = true
    this.reload(this.deps.getConfig())
    this.aliveTimer = setInterval(() => this.deps.reportAlive(), 60_000)
    this.deps.reportAlive()
  }

  /** Rebuild the target list + timers. Called on start and on config/tunnel change. */
  reload(config: SentinelConfig) {
    this.clearTimers()
    this.targets = buildTargets(config)
    for (const target of this.targets) {
      if (!this.states.has(target.id)) {
        this.states.set(target.id, { lastChecked: null, lastOk: null, failingSince: null, responseTimeMs: null, stale: false, detail: '' })
      }
      // Stagger nothing fancy — one timer per target at its interval, plus an immediate probe.
      void this.checkTarget(target)
      const timer = setInterval(() => void this.checkTarget(target), Math.max(1, target.intervalSeconds) * 1000)
      this.timers.push(timer)
    }
  }

  stop() {
    this.running = false
    this.clearTimers()
    if (this.aliveTimer) clearInterval(this.aliveTimer)
    this.aliveTimer = null
  }

  private clearTimers() {
    for (const timer of this.timers) clearInterval(timer)
    this.timers = []
  }

  private async checkTarget(target: BeaconTarget) {
    if (!this.running) return
    const state = this.states.get(target.id)!
    const now = Date.now()
    state.lastChecked = now

    if (target.buildOnly && !buildActive()) {
      // Not applicable right now — clear any failing state, mark skipped.
      state.failingSince = null
      state.stale = false
      state.detail = 'idle (no active build)'
      this.evaluateAll()
      return
    }

    let ok = false
    let detail = ''
    let responseTimeMs: number | null = null

    if (target.kind === 'file' && target.file) {
      const age = heartbeatAgeMs(target.file)
      ok = age !== null && age <= target.staleThresholdSeconds * 1000
      detail = age === null ? 'no heartbeat file' : `heartbeat age ${Math.round(age / 1000)}s`
    } else if (target.kind === 'http' && target.url) {
      const r = await httpProbe(target.url, { expectStatuses: target.expectStatuses ?? [200] })
      ok = r.ok
      responseTimeMs = r.responseTimeMs
      detail = r.ok ? `${r.status} ${r.responseTimeMs}ms` : (r.error ?? `status ${r.status}`)
    } else if (target.kind === 'tcp' && target.host && target.port) {
      const r = await tcpProbe(target.host, target.port)
      ok = r.ok
      responseTimeMs = r.responseTimeMs
      detail = r.ok ? `tcp open ${r.responseTimeMs}ms` : (r.error ?? 'tcp closed')
    }

    state.responseTimeMs = responseTimeMs
    state.detail = detail
    if (ok) {
      state.lastOk = now
      state.failingSince = null
    } else if (state.failingSince === null) {
      state.failingSince = now
    }
    this.evaluateAll()
  }

  /** Recompute stale set across all targets, write issues, fire transitions. */
  private evaluateAll() {
    const drafts: IssueDraft[] = []
    const newlyStale: BeaconTarget[] = []
    const recovered: BeaconTarget[] = []

    for (const target of this.targets) {
      const state = this.states.get(target.id)
      if (!state) continue
      const failingMs = state.failingSince === null ? 0 : Date.now() - state.failingSince
      const isStale = state.failingSince !== null && failingMs >= target.staleThresholdSeconds * 1000

      if (isStale && !state.stale) {
        state.stale = true
        newlyStale.push(target)
      } else if (!isStale && state.stale) {
        state.stale = false
        recovered.push(target)
      }

      if (isStale) {
        const decision = resolveConflict(target)
        drafts.push({
          source: 'heartbeat',
          environment: target.vpsOwned ? 'production' : 'development',
          phase: 'runtime',
          severity: target.severity,
          category: `heartbeat-stale-${target.id}`,
          checkName: target.id,
          diagnosis: `${target.label} has been unreachable for ${Math.round(failingMs / 1000)}s.`,
          evidence: [
            `Detail: ${state.detail}`,
            `Stale threshold: ${target.staleThresholdSeconds}s`,
            decision === 'corroborate' ? 'Guardian is authoritative for this VPS service — Beacon reading is corroborating evidence.' : 'Beacon external probe.'
          ],
          sourceSignals: [`beacon:${target.id}`],
          suggestedFix: target.triggersHealer ? 'DevTools Healer will attempt recovery automatically.' : 'Investigate the target; Beacon detects and delegates only.',
          riskLevel: target.severity === 'critical' ? 'high' : 'medium',
          requiresApproval: false,
          assignedAgent: 'Diagnostics agent',
          assignedProvider: 'Direct Call'
        })
      }
    }

    this.deps.writeHeartbeatIssues(drafts)

    for (const target of newlyStale) {
      this.deps.notifyAlert(target.severity, `${target.label} stale`, `Beacon detected ${target.label} unreachable past its ${target.staleThresholdSeconds}s threshold.`)
      this.deps.push(target.severity, `${target.label} stale`, 'Sentinel is investigating.')
      if (target.triggersHealer) this.deps.triggerHealer(target.id)
    }
    for (const target of recovered) {
      this.deps.notifyActivity(`${target.label} recovered`, `${target.label} is responding normally again.`)
    }
    if (newlyStale.length || recovered.length) this.deps.recomputeTray()
  }

  getStatuses(): BeaconTargetStatus[] {
    return this.targets.map((target) => {
      const state = this.states.get(target.id)!
      const failingMs = state.failingSince === null ? null : Date.now() - state.failingSince
      const skipped = target.buildOnly && !buildActive()
      return {
        id: target.id,
        label: target.label,
        category: target.category,
        state: skipped ? 'skipped' : state.stale ? 'stale' : state.lastChecked === null ? 'unknown' : 'ok',
        lastChecked: state.lastChecked ? new Date(state.lastChecked).toISOString() : null,
        lastOk: state.lastOk ? new Date(state.lastOk).toISOString() : null,
        responseTimeMs: state.responseTimeMs,
        failingForSeconds: failingMs === null ? null : Math.round(failingMs / 1000),
        detail: state.detail,
        vpsOwned: Boolean(target.vpsOwned)
      }
    })
  }
}
