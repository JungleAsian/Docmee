import { spawnSync } from 'node:child_process'
import { httpProbe } from '../lib/net.js'
import { readSessionStatus } from '../executor/session-guard.js'
import {
  DIRECT_CALL_AGENTS,
  SENTINEL_AGENT_ROLES,
  type ProviderId,
  type SentinelAgentRole,
  type SentinelConfig
} from '../config/schema.js'

export type ConnectionStatus = 'connected' | 'degraded' | 'unconfigured'

export interface ProviderCard {
  id: ProviderId
  name: string
  model: string
  status: ConnectionStatus
  detail: string
  session?: { pct: number | null; paused: boolean; resumeAt: string | null; recommendation: 'ok' | 'consider-switch' | 'switch-now' }
}

export interface SwitchResult {
  ok: boolean
  blocked?: string
  changes: string[]
  reassigned: number
}

export interface CortexDeps {
  getConfig(): SentinelConfig
  /** Persist providers.globalDefault to local config and return the reloaded config. */
  applyGlobalProvider(provider: ProviderId): SentinelConfig
  inFlightCount(): number
  interruptInFlight(reason: string): void
  reassignQueuedIssues(provider: ProviderId): number
  audit(entry: { subsystem: string; action: string; outcome: 'success' | 'failed' | 'info'; message: string }): void
  notifyActivity(title: string, message: string): void
}

function commandVersion(command: string): { ok: boolean; out: string } {
  const r = spawnSync(command, ['--version'], { encoding: 'utf8', shell: true, stdio: 'pipe', windowsHide: true })
  return { ok: r.status === 0, out: `${r.stdout ?? ''}`.trim() }
}

export class Cortex {
  private deps: CortexDeps

  constructor(deps: CortexDeps) {
    this.deps = deps
  }

  /** Provider this agent role will actually use, honouring pins + direct-call agents. */
  resolveProviderForAgent(role: SentinelAgentRole): ProviderId | 'direct' {
    if (DIRECT_CALL_AGENTS.includes(role)) return 'direct'
    const cfg = this.deps.getConfig()
    const override = cfg.providers.perAgentOverrides[role]
    if (!override || override === 'global') return cfg.providers.globalDefault
    return override
  }

  async testProvider(provider: ProviderId): Promise<{ status: ConnectionStatus; detail: string }> {
    const cfg = this.deps.getConfig()
    if (provider === 'manual') return { status: 'connected', detail: 'Manual queue — no AI provider.' }
    if (provider === 'claude-code') {
      const v = commandVersion(cfg.providers.claudeCode.command)
      if (!v.ok) return { status: 'unconfigured', detail: 'claude CLI not found on PATH.' }
      const s = readSessionStatus()
      return { status: s.paused ? 'degraded' : 'connected', detail: s.paused ? `paused, resume ${s.resumeAt}` : v.out || 'ready' }
    }
    if (provider === 'codex') {
      const v = commandVersion(cfg.providers.codex.command)
      return v.ok ? { status: 'connected', detail: v.out || 'ready' } : { status: 'unconfigured', detail: 'codex CLI not found on PATH.' }
    }
    // local-model
    const r = await httpProbe(cfg.providers.localModel.endpoint, { expectStatuses: [200, 404] })
    return r.ok ? { status: 'connected', detail: `endpoint up (${r.status})` } : { status: 'unconfigured', detail: r.error ?? 'endpoint unreachable' }
  }

  async cards(): Promise<ProviderCard[]> {
    const cfg = this.deps.getConfig()
    const session = readSessionStatus()
    const threshold = cfg.providers.claudeCode.sessionGuardThresholdPct
    const recommendation = session.paused || (session.pct ?? 0) >= 95 ? 'switch-now' : (session.pct ?? 0) >= threshold ? 'consider-switch' : 'ok'
    const [claude, codex, local] = await Promise.all([this.testProvider('claude-code'), this.testProvider('codex'), this.testProvider('local-model')])
    return [
      { id: 'claude-code', name: 'Claude Code', model: 'Claude Max session', status: claude.status, detail: claude.detail, session: { pct: session.pct, paused: session.paused, resumeAt: session.resumeAt, recommendation } },
      { id: 'codex', name: 'Codex', model: cfg.providers.codex.model, status: codex.status, detail: codex.detail },
      { id: 'local-model', name: 'Local Model', model: cfg.providers.localModel.model, status: local.status, detail: local.detail }
    ]
  }

  agentTable() {
    const cfg = this.deps.getConfig()
    return SENTINEL_AGENT_ROLES.map((role) => {
      const resolved = this.resolveProviderForAgent(role)
      const override = cfg.providers.perAgentOverrides[role]
      return {
        role,
        direct: DIRECT_CALL_AGENTS.includes(role),
        provider: resolved,
        pinned: override && override !== 'global' ? override : null
      }
    })
  }

  /** Guided switch flow (Cortex spec §Section 3). */
  async switchProvider(provider: ProviderId, opts: { force?: boolean } = {}): Promise<SwitchResult> {
    const cfg = this.deps.getConfig()
    const from = cfg.providers.globalDefault
    const changes: string[] = []

    // Step 1 — in-flight executions
    const inFlight = this.deps.inFlightCount()
    if (inFlight > 0 && !opts.force) {
      return { ok: false, blocked: `${inFlight} agent execution(s) in progress. Re-run with force to interrupt.`, changes: [], reassigned: 0 }
    }
    if (inFlight > 0 && opts.force) {
      this.deps.interruptInFlight('Provider switch forced by operator.')
      changes.push(`${inFlight} in-flight execution(s) interrupted and escalated to manual queue`)
    }

    // Step 2 — validate new provider
    const test = await this.testProvider(provider)
    if (test.status === 'unconfigured') {
      this.deps.audit({ subsystem: 'cortex', action: 'switch.blocked', outcome: 'failed', message: `Validation failed for ${provider}: ${test.detail}` })
      return { ok: false, blocked: `Validation failed for ${provider}: ${test.detail}`, changes: [], reassigned: 0 }
    }

    // Step 3/4/5 — show changes, apply
    changes.push(`Global default: ${from} → ${provider}`)
    const pinned = SENTINEL_AGENT_ROLES.filter((r) => {
      const o = cfg.providers.perAgentOverrides[r]
      return o && o !== 'global'
    })
    for (const r of pinned) changes.push(`${r} pinned to ${cfg.providers.perAgentOverrides[r]} — unaffected`)

    this.deps.applyGlobalProvider(provider)
    const reassigned = this.deps.reassignQueuedIssues(provider)
    changes.push(`${reassigned} queued issue(s) reassigned to ${provider}`)
    this.deps.audit({ subsystem: 'cortex', action: 'switch', outcome: 'success', message: `Switched ${from} → ${provider}, ${reassigned} reassigned` })
    this.deps.notifyActivity('Cortex provider switch', `Switched to ${provider} — ${reassigned} queued issue(s) reassigned.`)
    return { ok: true, changes, reassigned }
  }

  /** Optional auto-fallback when Claude hits the session guard threshold. */
  async autoFallbackTick(): Promise<void> {
    const cfg = this.deps.getConfig()
    const af = cfg.providers.autoFallback
    if (!af.enabled) return
    const session = readSessionStatus()
    const threshold = cfg.providers.claudeCode.sessionGuardThresholdPct
    const overLimit = session.paused || (typeof session.pct === 'number' && session.pct >= threshold)

    if (overLimit && cfg.providers.globalDefault === 'claude-code') {
      await this.switchProvider(af.fallbackProvider, { force: false })
      this.deps.notifyActivity('Cortex auto-fallback', `Claude session limit reached — switched to ${af.fallbackProvider}.`)
    } else if (!overLimit && af.restoreAfterSessionReset && cfg.providers.globalDefault === af.fallbackProvider) {
      // Restore once the session has reset (pct cleared / low).
      if (session.pct === null || session.pct < threshold) {
        await this.switchProvider('claude-code', { force: false })
        this.deps.notifyActivity('Cortex auto-restore', 'Claude session reset — restored Claude Code as default.')
      }
    }
  }

  status() {
    const cfg = this.deps.getConfig()
    return { globalDefault: cfg.providers.globalDefault, overrides: cfg.providers.perAgentOverrides, autoFallback: cfg.providers.autoFallback }
  }
}
