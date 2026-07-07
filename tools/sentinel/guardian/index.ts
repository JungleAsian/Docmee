import { spawnSync } from 'node:child_process'
import os from 'node:os'
import { guardianHeartbeatFile, guardianChecksFile, guardianAuditFile } from '../lib/paths.js'
import { readJsonFile, writeJsonFile } from '../lib/json-store.js'
import { writeHeartbeat } from '../lib/heartbeat.js'
import { httpProbe, sanitiseError } from '../lib/net.js'
import { mergeIssuesForSource, writeIssues, type IssueDraft } from '../lib/issues.js'
import type { SubsystemDeps } from '../lib/deps.js'
import { loadGuardianConfig, type GuardianConfig } from './config.js'

const VERSION = '1.0.0'

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip'
export type CheckCategory = 'infrastructure' | 'external-deps' | 'business-logic'

export interface CheckResult {
  checkName: string
  category: CheckCategory
  status: CheckStatus
  lastChecked: string
  lastChanged: string
  consecutiveFailures: number
  lastError?: string
  responseTimeMs?: number
  recoveryAttempts: number
  escalated: boolean
}

interface GuardianAuditEntry {
  ts: string
  checkCategory: string
  checkName: string
  trigger: string
  action: string
  outcome: 'success' | 'failed' | 'escalated'
  durationMs: number
}

function commandAvailable(cmd: string) {
  const probe = spawnSync(cmd, ['--version'], { encoding: 'utf8', shell: true, stdio: 'pipe', windowsHide: true })
  return probe.status === 0
}

function dockerStatus(container: string): 'running' | 'stopped' | 'unknown' {
  if (!commandAvailable('docker')) return 'unknown'
  const out = spawnSync('docker', ['inspect', '-f', '{{.State.Status}}', container], { encoding: 'utf8', shell: true, windowsHide: true })
  if (out.status !== 0) return 'unknown'
  return out.stdout.trim() === 'running' ? 'running' : 'stopped'
}

function diskPercentUsed(): number | null {
  if (os.platform() === 'win32') return null // df not applicable; VPS-only check
  const out = spawnSync('df', ['-P', '/'], { encoding: 'utf8' })
  if (out.status !== 0) return null
  const line = out.stdout.trim().split(/\r?\n/).pop() ?? ''
  const match = line.match(/(\d+)%/)
  return match ? Number(match[1]) : null
}

function memoryAvailableMb(): number | null {
  const free = os.freemem()
  return Math.round(free / (1024 * 1024))
}

export class GuardianScanner {
  private deps: SubsystemDeps
  private config: GuardianConfig
  private timers: NodeJS.Timeout[] = []
  private startedAt = Date.now()
  private results = new Map<string, CheckResult>()
  private recoveryAttempts = new Map<string, number[]>() // action -> timestamps
  private lockedActions = new Set<string>()
  private resolvedToday = 0

  constructor(deps: SubsystemDeps) {
    this.deps = deps
    this.config = loadGuardianConfig()
  }

  private configured() {
    const cfg = this.deps.getConfig()
    return cfg.subsystems.guardianEnabled && Boolean(cfg.targets.docmeeApiHealthUrl || cfg.targets.vpsHost)
  }

  start() {
    if (!this.configured()) {
      this.writeNotConfigured()
      // Still emit a heartbeat on the standard cadence so Beacon sees Guardian alive,
      // and report alive to the daemon supervisor so it isn't falsely restarted.
      this.timers.push(
        setInterval(() => {
          this.writeNotConfigured()
          this.deps.reportAlive()
        }, this.config.schedules.heartbeatIntervalSeconds * 1000)
      )
      this.deps.reportAlive()
      return
    }
    this.config = loadGuardianConfig()
    void this.runCategory('infrastructure')
    void this.runCategory('external-deps')
    this.timers.push(setInterval(() => void this.runCategory('infrastructure'), this.config.schedules.infrastructureIntervalSeconds * 1000))
    this.timers.push(setInterval(() => void this.runCategory('external-deps'), this.config.schedules.externalDepsIntervalSeconds * 1000))
    this.timers.push(setInterval(() => this.writeHeartbeatNow(), this.config.schedules.heartbeatIntervalSeconds * 1000))
    this.writeHeartbeatNow()
    this.deps.reportAlive()
  }

  stop() {
    for (const t of this.timers) clearInterval(t)
    this.timers = []
  }

  scanOnce(): IssueDraft[] {
    if (!this.configured()) {
      this.writeNotConfigured()
      return []
    }
    void this.runCategory('infrastructure')
    void this.runCategory('external-deps')
    return this.escalations()
  }

  private record(name: string, category: CheckCategory, status: CheckStatus, detail: string, responseTimeMs?: number) {
    const now = new Date().toISOString()
    const prev = this.results.get(name)
    const changed = !prev || prev.status !== status
    const consecutiveFailures = status === 'fail' ? (prev?.consecutiveFailures ?? 0) + 1 : 0
    this.results.set(name, {
      checkName: name,
      category,
      status,
      lastChecked: now,
      lastChanged: changed ? now : prev?.lastChanged ?? now,
      consecutiveFailures,
      lastError: status === 'fail' || status === 'warn' ? sanitiseError(detail) : undefined,
      responseTimeMs,
      recoveryAttempts: prev?.recoveryAttempts ?? 0,
      escalated: prev?.escalated ?? false
    })
  }

  private async runCategory(category: CheckCategory) {
    if (category === 'infrastructure') {
      for (const [name, container] of [
        ['API container running', 'docmee-api'],
        ['Worker container running', 'docmee-worker'],
        ['Web container running', 'docmee-web'],
        ['Caddy container running', 'docmee-caddy']
      ] as const) {
        const status = dockerStatus(container)
        if (status === 'unknown') this.record(name, 'infrastructure', 'skip', 'docker not available on this host')
        else if (status === 'running') this.record(name, 'infrastructure', 'pass', 'running')
        else {
          this.record(name, 'infrastructure', 'fail', `${container} not running`)
          this.attemptRecovery(category, name, `${container.replace('docmee-', '')}-container-down`, `restart-${container.replace('docmee-', '')}`, container)
        }
      }
      const disk = diskPercentUsed()
      if (disk === null) this.record('Disk space', 'infrastructure', 'skip', 'df not applicable')
      else this.record('Disk space', 'infrastructure', disk >= this.config.thresholds.diskCriticalPercent ? 'fail' : disk >= this.config.thresholds.diskWarningPercent ? 'warn' : 'pass', `${disk}% used`)
      const mem = memoryAvailableMb()
      this.record('Memory pressure', 'infrastructure', mem !== null && mem < this.config.thresholds.memoryAvailableMBWarning ? 'warn' : 'pass', `${mem ?? '?'}MB available`)

      const apiUrl = this.deps.getConfig().targets.docmeeApiHealthUrl
      if (apiUrl) {
        const r = await httpProbe(apiUrl, { expectStatuses: [200] })
        this.record('API health endpoint', 'infrastructure', r.ok ? 'pass' : 'fail', r.ok ? `${r.status}` : r.error ?? `status ${r.status}`, r.responseTimeMs)
      }
    }

    if (category === 'external-deps') {
      const probes: Array<[string, string, number[]]> = [
        ['Anthropic API reachable', 'https://api.anthropic.com', [200, 401, 403, 404]],
        ['Resend reachable', 'https://api.resend.com/v1/domains', [200, 401]]
      ]
      for (const [name, url, expect] of probes) {
        const r = await httpProbe(url, { expectStatuses: expect })
        this.record(name, 'external-deps', r.ok ? 'pass' : 'warn', r.ok ? `${r.status}` : r.error ?? `status ${r.status}`, r.responseTimeMs)
      }
      const tunnelUrl = this.deps.getConfig().targets.cloudflareTunnelHealthUrl
      if (tunnelUrl) {
        const r = await httpProbe(tunnelUrl, { expectStatuses: [200] })
        this.record('Cloudflare Tunnel health', 'external-deps', r.ok ? 'pass' : 'warn', r.ok ? `${r.status}` : r.error ?? 'unreachable', r.responseTimeMs)
      }
    }

    writeJsonFile(guardianChecksFile, Array.from(this.results.values()))
    this.writeIssuesNow()
    this.writeHeartbeatNow()
    this.deps.reportAlive()
  }

  /** Rate-limited recovery within the 5-command blast radius. Escalates after the cap. */
  private attemptRecovery(category: CheckCategory, checkName: string, trigger: string, action: string, container: string) {
    const cfg = this.deps.getConfig()
    if (this.config.mode !== 'active' || cfg.mode === 'observe-only') return
    if (this.isQuietHours()) return
    const rule = this.config.recoveryRules.find((r) => r.action === action)
    if (!rule || !rule.enabled) return
    if (this.lockedActions.has(action)) return

    const now = Date.now()
    const window = (this.recoveryAttempts.get(action) ?? []).filter((t) => now - t < 60 * 60 * 1000)
    if (window.length >= rule.maxAttemptsPerHour) {
      this.escalate(category, checkName, trigger, `${action} exceeded ${rule.maxAttemptsPerHour}/hour`)
      this.lockedActions.add(action)
      return
    }
    // Cooldown
    const last = window[window.length - 1]
    if (last && now - last < rule.cooldownSeconds * 1000) return

    const start = Date.now()
    const ok = this.runDockerRestart(container)
    window.push(now)
    this.recoveryAttempts.set(action, window)
    const result = this.results.get(checkName)
    if (result) result.recoveryAttempts += 1
    this.audit({ checkCategory: category, checkName, trigger, action, outcome: ok ? 'success' : 'failed', durationMs: Date.now() - start })

    if (ok) {
      this.deps.notifyActivity('Guardian recovery', `${container} restart attempted (${window.length}/${rule.maxAttemptsPerHour}).`)
    } else if (window.length >= rule.escalateAfterAttempts) {
      this.escalate(category, checkName, trigger, `${action} failed after ${window.length} attempts (crash loop)`)
      this.lockedActions.add(action)
    }
  }

  private runDockerRestart(container: string): boolean {
    if (!commandAvailable('docker')) return false
    // Mirrors the sudo allowlist: docker restart <container>
    const out = spawnSync('sudo', ['/usr/bin/docker', 'restart', container], { encoding: 'utf8', shell: true })
    return out.status === 0
  }

  private escalate(category: CheckCategory, checkName: string, trigger: string, reason: string) {
    const result = this.results.get(checkName)
    if (result) result.escalated = true
    this.audit({ checkCategory: category, checkName, trigger, action: 'escalate', outcome: 'escalated', durationMs: 0 })
    this.deps.notifyAlert('critical', 'Guardian escalation', `${checkName}: ${reason}. Manual intervention required.`)
    this.writeIssuesNow()
  }

  private escalations(): IssueDraft[] {
    const drafts: IssueDraft[] = []
    for (const result of this.results.values()) {
      if (result.status !== 'fail') continue
      const escalated = result.escalated
      drafts.push({
        source: 'guardian',
        environment: 'production',
        phase: 'runtime',
        severity: 'critical',
        category: result.checkName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        checkCategory: result.category,
        checkName: result.checkName,
        consecutiveFailures: result.consecutiveFailures,
        recoveryAttemptsBeforeEscalation: result.recoveryAttempts,
        diagnosis: `${result.checkName} failing (${result.consecutiveFailures} consecutive).`,
        evidence: [`Recovery attempts: ${result.recoveryAttempts}`, escalated ? 'Locked after escalation cap.' : 'Auto-recovery in progress.'],
        sourceSignals: ['logs/guardian-checks.json'],
        suggestedFix: escalated ? 'Reset the escalation lock after resolving the root cause: pnpm tool guardian reset <action>.' : 'Guardian is attempting deterministic recovery within its blast radius.',
        riskLevel: 'high',
        requiresApproval: false,
        assignedAgent: 'CLI/Build agent',
        assignedProvider: 'global'
      })
    }
    return drafts
  }

  private writeIssuesNow() {
    const merged = mergeIssuesForSource('guardian', this.escalations())
    writeIssues(merged)
  }

  private isQuietHours() {
    if (!this.config.quietHours.enabled) return false
    const hour = new Date().getUTCHours()
    const { startHour, endHour } = this.config.quietHours
    return startHour <= endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour
  }

  private audit(entry: Omit<GuardianAuditEntry, 'ts'>) {
    const log = readJsonFile<GuardianAuditEntry[]>(guardianAuditFile, [])
    writeJsonFile(guardianAuditFile, [{ ts: new Date().toISOString(), ...entry }, ...log].slice(0, 1000))
  }

  private writeHeartbeatNow() {
    const all = Array.from(this.results.values())
    writeHeartbeat(guardianHeartbeatFile, {
      timestamp: new Date().toISOString(),
      status: this.config.mode === 'paused' ? 'paused' : this.config.mode === 'observe-only' ? 'observe-only' : 'running',
      version: VERSION,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      activeIssues: all.filter((r) => r.status === 'fail').length,
      resolvedToday: this.resolvedToday,
      checksPassingCount: all.filter((r) => r.status === 'pass').length,
      checksFailingCount: all.filter((r) => r.status === 'fail').length
    })
  }

  private writeNotConfigured() {
    writeHeartbeat(guardianHeartbeatFile, {
      timestamp: new Date().toISOString(),
      status: 'not-configured',
      version: VERSION,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000)
    })
  }

  resetLock(action: string) {
    this.lockedActions.delete(action)
    this.recoveryAttempts.delete(action)
  }

  status() {
    return { version: VERSION, configured: this.configured(), mode: this.config.mode, checks: Array.from(this.results.values()) }
  }
}
