import fs from 'node:fs'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { daemonPidFile, configDefaultsFile, configLocalFile } from './lib/paths.js'
import { loadConfig, updateLocalConfig, redactConfig, ensureLocalConfigExists } from './config/index.js'
import { validateConfig, type SentinelConfig } from './config/schema.js'
import { configureLogger, logEvent, writeDailySummary } from './lib/logger.js'
import { syncBacklog } from '../cli/src/commands/backlog.js'
import { appendAudit, auditSize, detectAuditTamper } from './lib/audit.js'
import { readSessionStatus } from './executor/session-guard.js'
import {
  readIssues,
  writeIssues,
  mergeIssuesForSource,
  updateIssue,
  issueSummary,
  type IssueSource,
  type IssueDraft,
  type SentinelSeverity
} from './lib/issues.js'
import { registerWindowsTaskOnce } from './lib/windows-task.js'
import { BeaconWatcher } from './beacon/index.js'
import { ForgeScanner } from './forge/index.js'
import { GuardianScanner } from './guardian/index.js'
import { AegisScanner } from './aegis/index.js'
import { Cortex } from './cortex/index.js'
import { Executor } from './executor/index.js'
import { DevToolsHealer } from './healer/index.js'
import { Notifier } from './notifications/discord.js'
import { PushNotifier } from './notifications/push.js'
import { writeTray, type TraySubsystem } from './tray/index.js'
import { taskLogPath } from './executor/task-writer.js'
import { SentinelApi, type ApiContext, type DaemonStatusView } from './api/index.js'

type SubName = 'beacon' | 'forge' | 'guardian' | 'aegis' | 'cortex'

const VERSION = '1.0.0'

export class SentinelDaemon {
  private config: SentinelConfig
  private startedAt = Date.now()
  private aliveAt: Record<SubName, number> = { beacon: 0, forge: 0, guardian: 0, aegis: 0, cortex: 0 }
  private restartCounts: Record<SubName, number[]> = { beacon: [], forge: [], guardian: [], aegis: [], cortex: [] }
  private subsystemStatus: Record<string, string> = { beacon: 'starting', forge: 'starting', guardian: 'starting', aegis: 'starting', cortex: 'starting', api: 'starting' }
  private lastAuditSize = 0
  private metrics = { agentInvocations: 0, healerActivations: 0, resolvedToday: 0 }

  private notifier: Notifier
  private push: PushNotifier
  private beacon!: BeaconWatcher
  private forge!: ForgeScanner
  private guardian!: GuardianScanner
  private aegis!: AegisScanner
  private cortex!: Cortex
  private executor!: Executor
  private healer!: DevToolsHealer
  private api!: SentinelApi

  private timers: NodeJS.Timeout[] = []
  private watchers: fs.FSWatcher[] = []
  private shuttingDown = false

  constructor() {
    const result = loadConfig()
    this.config = result.config
    this.notifier = new Notifier(() => this.config)
    this.push = new PushNotifier(() => this.config)
  }

  // --- lifecycle ----------------------------------------------------------

  async start() {
    ensureLocalConfigExists()
    configureLogger({ level: this.config.logging.level, rotationSizeMb: this.config.logging.rotationSizeMb, rotationsKept: this.config.logging.rotationsKept })
    fs.writeFileSync(daemonPidFile, String(process.pid))
    registerWindowsTaskOnce()
    this.lastAuditSize = auditSize()
    logEvent('daemon', 'info', 'startup.begin', `Sentinel daemon ${VERSION} starting (pid ${process.pid})`)
    this.recomputeTray(true)

    this.buildSubsystems()

    // Step 1 — Beacon first.
    this.beacon.start()
    this.subsystemStatus.beacon = 'online'
    this.markAlive('beacon')

    // Step 2 — Forge + Guardian + Aegis simultaneously.
    this.forge.start(this.config.beacon.standardIntervalSeconds * 1000)
    this.subsystemStatus.forge = 'online'
    this.markAlive('forge')
    this.guardian.start()
    this.subsystemStatus.guardian = this.config.subsystems.guardianEnabled ? 'online' : 'not-configured'
    this.markAlive('guardian')
    this.aegis.start()
    this.subsystemStatus.aegis = this.config.subsystems.aegisEnabled ? 'online' : 'not-configured'
    this.markAlive('aegis')

    // Step 3 — Cortex.
    this.subsystemStatus.cortex = 'online'
    this.markAlive('cortex')

    // Step 4 — API.
    try {
      await this.api.start()
      this.subsystemStatus.api = 'online'
    } catch (err) {
      this.subsystemStatus.api = 'offline'
      logEvent('api', 'critical', 'api.start-failed', `Sentinel API failed to start: ${(err as Error).message}`)
      void this.notifier.alert('critical', 'Sentinel API failed', 'PWA cannot reach Sentinel directly until the API recovers.')
    }

    this.startSupervisor()
    this.startConfigWatch()
    this.startDailySummary()
    this.startCortexAutoFallback()
    this.startBacklogAutoSync()
    this.recomputeTray(false)
    logEvent('daemon', 'info', 'startup.complete', 'Sentinel daemon ready')
    this.installSignalHandlers()
  }

  private buildSubsystems() {
    this.beacon = new BeaconWatcher({
      getConfig: () => this.config,
      writeHeartbeatIssues: (drafts) => this.writeSourceIssues('heartbeat', drafts),
      notifyAlert: (sev, title, msg) => void this.notifier.alert(sev, title, msg),
      notifyActivity: (title, msg) => void this.notifier.activity(title, msg),
      push: (sev, title, msg) => this.push.send(sev, title, msg),
      recomputeTray: () => this.recomputeTray(false),
      triggerHealer: (targetId) => this.onHealerTrigger(targetId),
      reportAlive: () => this.markAlive('beacon')
    })

    const subDeps = (name: SubName) => ({
      getConfig: () => this.config,
      writeIssues: (drafts: IssueDraft[]) => this.writeSourceIssues(name as IssueSource, drafts),
      notifyAlert: (sev: SentinelSeverity, title: string, msg: string) => void this.notifier.alert(sev, title, msg),
      notifyActivity: (title: string, msg: string) => void this.notifier.activity(title, msg),
      push: (sev: SentinelSeverity, title: string, msg: string) => this.push.send(sev, title, msg),
      recomputeTray: () => this.recomputeTray(false),
      reportAlive: () => this.markAlive(name),
      refreshDerivedDeploymentRecords: name === 'forge' ? () => this.healer.refreshDerivedDeploymentRecords() : undefined
    })

    this.cortex = new Cortex({
      getConfig: () => this.config,
      applyGlobalProvider: (provider) => this.applyConfigPatch({ providers: { globalDefault: provider } }) ?? this.config,
      inFlightCount: () => this.executor.inFlightCount(),
      interruptInFlight: (reason) => this.executor.interruptInFlight(reason),
      reassignQueuedIssues: (provider) => this.executor.reassignQueuedIssues(provider, readIssues()),
      audit: (e) => appendAudit({ subsystem: e.subsystem, action: e.action, outcome: e.outcome, message: e.message }),
      notifyActivity: (title, msg) => void this.notifier.activity(title, msg)
    })

    this.executor = new Executor({
      getConfig: () => this.config,
      cortex: this.cortex,
      getIssue: (id) => readIssues().find((i) => i.id === id) ?? null,
      updateIssue: (id, patch) => void updateIssue(id, patch),
      audit: (e) => appendAudit({ subsystem: e.subsystem, action: e.action, outcome: e.outcome, message: e.message, issueId: e.issueId }),
      notifyActivity: (title, msg) => void this.notifier.activity(title, msg),
      notifyAlert: (sev, title, msg) => void this.notifier.alert(sev, title, msg),
      rescan: (source) => this.rescan(source)
    })

    this.healer = new DevToolsHealer({
      getConfig: () => this.config,
      audit: (e) => appendAudit({ subsystem: e.subsystem, action: e.action, outcome: e.outcome, message: e.message, durationMs: e.durationMs }),
      notifyAlert: (sev, title, msg) => void this.notifier.alert(sev, title, msg),
      notifyActivity: (title, msg) => void this.notifier.activity(title, msg),
      push: (sev, title, msg) => this.push.send(sev, title, msg),
      recomputeTray: () => this.recomputeTray(false),
      resolveHeartbeatTarget: (targetId, message) => this.resolveHeartbeatTarget(targetId, message),
      escalateIssue: (draft) => this.writeSourceIssues('devtools-healer', [draft])
    })

    this.forge = new ForgeScanner(subDeps('forge'))
    this.guardian = new GuardianScanner(subDeps('guardian'))
    this.aegis = new AegisScanner(subDeps('aegis'))

    this.api = new SentinelApi(this.buildApiContext())
  }

  // --- issue helpers ------------------------------------------------------

  private writeSourceIssues(source: IssueSource, drafts: IssueDraft[]) {
    if (detectAuditTamper(this.lastAuditSize)) this.raiseAuditTamper()
    this.lastAuditSize = auditSize()
    writeIssues(mergeIssuesForSource(source, drafts))
    this.recomputeTray(false)
  }

  private raiseAuditTamper() {
    const draft: IssueDraft = {
      source: 'guardian',
      environment: 'production',
      phase: 'security',
      severity: 'critical',
      category: 'audit-tampered',
      checkName: 'audit-trail',
      diagnosis: 'Sentinel audit log shrank — possible tampering.',
      evidence: ['Audit file size decreased vs last known size.'],
      sourceSignals: ['logs/sentinel-audit.json'],
      suggestedFix: 'Investigate immediately. The audit trail is append-only.',
      riskLevel: 'high',
      requiresApproval: true,
      assignedAgent: 'Diagnostics agent',
      assignedProvider: 'Direct Call'
    }
    writeIssues(mergeIssuesForSource('guardian', [draft]))
    void this.notifier.alert('critical', 'Audit tampered', 'The append-only audit log shrank. Investigate immediately.')
  }

  private resolveHeartbeatTarget(targetId: string, message: string) {
    for (const issue of readIssues()) {
      if (issue.source === 'heartbeat' && issue.checkName === targetId && !['resolved', 'ignored'].includes(issue.status)) {
        updateIssue(issue.id, { status: 'resolved', resolution: message })
      }
    }
    this.recomputeTray(false)
  }

  private onHealerTrigger(targetId: string) {
    this.metrics.healerActivations += 1
    void this.healer.heal(targetId)
    this.recomputeTray(false)
  }

  private rescan(source: IssueSource) {
    if (source === 'forge') this.forge.scanOnce()
    else if (source === 'guardian') this.guardian.scanOnce()
    else if (source === 'aegis') this.aegis.scanOnce()
  }

  // --- supervision --------------------------------------------------------

  private markAlive(name: SubName) {
    this.aliveAt[name] = Date.now()
  }

  private startSupervisor() {
    const timer = setInterval(() => this.superviseOnce(), 60_000)
    this.timers.push(timer)
  }

  private superviseOnce() {
    const now = Date.now()
    const subs: SubName[] = ['beacon', 'forge', 'guardian', 'aegis', 'cortex']
    for (const name of subs) {
      const silentMs = now - (this.aliveAt[name] || this.startedAt)
      if (silentMs > 5 * 60 * 1000) this.restartSubsystem(name)
    }
  }

  private restartSubsystem(name: SubName) {
    const now = Date.now()
    const window = this.restartCounts[name].filter((t) => now - t < 60 * 60 * 1000)
    if (window.length >= 3) {
      this.subsystemStatus[name] = 'offline'
      logEvent('daemon', 'critical', 'subsystem.offline', `${name} offline after 3 restart attempts`)
      void this.notifier.alert('critical', `${name} offline`, `${name} stopped reporting and could not be restarted.`)
      this.recomputeTray(false)
      return
    }
    window.push(now)
    this.restartCounts[name] = window
    logEvent('daemon', 'warn', 'subsystem.restart', `Restarting ${name} (silent > 5m)`)
    try {
      if (name === 'beacon') {
        this.beacon.stop()
        this.beacon.start()
      } else if (name === 'forge') {
        this.forge.stop()
        this.forge.start(this.config.beacon.standardIntervalSeconds * 1000)
      } else if (name === 'guardian') {
        this.guardian.stop()
        this.guardian.start()
      } else if (name === 'aegis') {
        this.aegis.stop()
        this.aegis.start()
      }
      this.markAlive(name)
      this.subsystemStatus[name] = name === 'guardian' && !this.config.subsystems.guardianEnabled ? 'not-configured' : name === 'aegis' && !this.config.subsystems.aegisEnabled ? 'not-configured' : 'online'
    } catch (err) {
      logEvent('daemon', 'error', 'subsystem.restart-failed', `${name} restart threw: ${(err as Error).message}`)
    }
  }

  // --- config hot-reload --------------------------------------------------

  private startConfigWatch() {
    let debounce: NodeJS.Timeout | null = null
    const onChange = () => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => this.reloadConfig(), 1000)
    }
    for (const file of [configDefaultsFile, configLocalFile]) {
      try {
        if (fs.existsSync(file)) this.watchers.push(fs.watch(file, onChange))
      } catch {
        // watching is best-effort
      }
    }
  }

  private reloadConfig() {
    const result = loadConfig()
    if (!result.ok) {
      logEvent('daemon', 'error', 'config.invalid', `Rejected config change: ${result.errors.join('; ')}`)
      return
    }
    this.config = result.config
    configureLogger({ level: this.config.logging.level, rotationSizeMb: this.config.logging.rotationSizeMb, rotationsKept: this.config.logging.rotationsKept })
    this.beacon.reload(this.config)
    logEvent('daemon', 'info', 'config.reloaded', 'Config reloaded and applied')
    this.recomputeTray(false)
  }

  /** Persist a patch to local config and adopt it if valid. Returns the new config or null. */
  private applyConfigPatch(patch: Record<string, unknown>): SentinelConfig | null {
    const result = updateLocalConfig(patch)
    if (!result.ok) {
      logEvent('daemon', 'error', 'config.invalid', `Rejected config patch: ${result.errors.join('; ')}`)
      return null
    }
    this.config = result.config
    this.beacon.reload(this.config)
    this.recomputeTray(false)
    return this.config
  }

  // --- daily summary ------------------------------------------------------

  private startDailySummary() {
    const tick = () => {
      const now = new Date()
      if (now.getHours() === 23 && now.getMinutes() === 59) {
        const s = issueSummary()
        writeDailySummary({
          resolved: this.metrics.resolvedToday,
          warnings: s.warning,
          approvalPending: s.approval,
          uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
          providerUsed: this.config.providers.globalDefault,
          agentInvocations: this.metrics.agentInvocations,
          healerActivations: this.metrics.healerActivations
        })
        void this.notifier.activity('Daily summary', `${this.metrics.resolvedToday} resolved, ${s.warning} warnings active, ${s.approval} approval pending.`)
        this.metrics = { agentInvocations: 0, healerActivations: 0, resolvedToday: 0 }
      }
    }
    this.timers.push(setInterval(tick, 60_000))
  }

  private startBacklogAutoSync() {
    // Auto-collect TODO/FIXME and close shipped items every 10 minutes, even when
    // the dashboard is closed. In-process; backlog sync is idempotent.
    const run = () => {
      try {
        const result = syncBacklog()
        logEvent('daemon', 'info', 'backlog.sync', `Backlog sync: +${result.added} new, -${result.removed} resolved, ${result.flagged} flagged, ${result.advanced} advanced`)
      } catch (err) {
        logEvent('daemon', 'warn', 'backlog.sync-failed', `Backlog sync failed: ${(err as Error).message}`)
      }
    }
    run()
    this.timers.push(setInterval(run, 10 * 60_000))
  }

  private startCortexAutoFallback() {
    // Cortex is passive (no scan loop) — heartbeat it here so the supervisor
    // doesn't falsely flag it offline, and run the optional auto-fallback check.
    this.timers.push(
      setInterval(() => {
        this.markAlive('cortex')
        void this.cortex.autoFallbackTick()
      }, 60_000)
    )
  }

  // --- tray ---------------------------------------------------------------

  private recomputeTray(starting: boolean) {
    const s = issueSummary()
    const subsystems: TraySubsystem[] = [
      { name: 'Beacon', status: trayStatus(this.subsystemStatus.beacon) },
      { name: 'Forge', status: trayStatus(this.subsystemStatus.forge) },
      { name: 'Guardian', status: trayStatus(this.subsystemStatus.guardian) },
      { name: 'Aegis', status: trayStatus(this.subsystemStatus.aegis) },
      { name: 'Cortex', status: trayStatus(this.subsystemStatus.cortex), detail: `${this.config.providers.globalDefault}` }
    ]
    writeTray({
      starting,
      agentRunning: this.executor?.inFlightCount() > 0 || this.healer?.isHealing() === true,
      critical: s.critical,
      warning: s.warning,
      activeIssues: s.active,
      subsystems
    })
  }

  // --- API context --------------------------------------------------------

  private buildApiContext(): ApiContext {
    return {
      version: VERSION,
      startedAt: this.startedAt,
      getConfig: () => this.config,
      redactedConfig: () => redactConfig(this.config),
      updateConfig: (patch) => {
        const result = validateConfig(this.config, patch)
        if (!result.ok) return { ok: false, errors: result.errors }
        const applied = this.applyConfigPatch(patch)
        return applied ? { ok: true, errors: [] } : { ok: false, errors: ['failed to persist'] }
      },
      listIssues: (filter) =>
        readIssues().filter(
          (i) => (!filter.source || i.source === filter.source) && (!filter.status || i.status === filter.status) && (!filter.severity || i.severity === filter.severity)
        ),
      getIssue: (id) => readIssues().find((i) => i.id === id) ?? null,
      approveIssue: (id) => {
        const issue = readIssues().find((i) => i.id === id)
        if (!issue) return { ok: false, message: 'not-found' }
        updateIssue(id, { status: 'assigned', requiresApproval: false })
        this.metrics.agentInvocations += 1
        void this.executor.run(id).then((r) => {
          if (r.ok) this.metrics.resolvedToday += 1
        })
        return { ok: true, message: 'approved — execution started' }
      },
      dismissIssue: (id) => {
        const updated = updateIssue(id, { status: 'ignored', resolution: 'Dismissed by operator.' })
        this.recomputeTray(false)
        return updated ? { ok: true, message: 'dismissed' } : { ok: false, message: 'not-found' }
      },
      assignIssue: (id, agent, provider) => {
        const updated = updateIssue(id, { status: 'assigned', ...(agent ? { assignedAgent: agent } : {}), ...(provider ? { assignedProvider: provider } : {}) })
        return updated ? { ok: true, message: 'assigned' } : { ok: false, message: 'not-found' }
      },
      cortexStatus: () => {
        const s = this.cortex.status()
        return { globalDefault: s.globalDefault, overrides: s.overrides as Record<string, string>, agents: this.cortex.agentTable() }
      },
      cortexCards: () => this.cortex.cards(),
      cortexSwitch: (provider, force) => this.cortex.switchProvider(provider, { force }),
      cortexSession: () => {
        const s = readSessionStatus()
        return { pct: s.pct, paused: s.paused, resumeAt: s.resumeAt }
      },
      beaconStatuses: () => this.beacon.getStatuses(),
      taskLog: (issueId, lines) => {
        try {
          return fs.readFileSync(taskLogPath(issueId), 'utf8').split(/\r?\n/).slice(-lines)
        } catch {
          return []
        }
      },
      daemonStatus: (): DaemonStatusView => {
        const s = issueSummary()
        return {
          status: this.shuttingDown ? 'stopping' : 'running',
          uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
          version: VERSION,
          subsystems: Object.entries(this.subsystemStatus).map(([name, status]) => ({ name, status })),
          tray: 'see sentinel-tray.json',
          provider: this.config.providers.globalDefault,
          issues: { active: s.active, critical: s.critical, warning: s.warning, approval: s.approval }
        }
      }
    }
  }

  // --- shutdown -----------------------------------------------------------

  private installSignalHandlers() {
    const onSignal = (signal: string) => {
      logEvent('daemon', 'info', 'shutdown.signal', `Received ${signal}`)
      void this.shutdown()
    }
    process.on('SIGINT', () => onSignal('SIGINT'))
    process.on('SIGTERM', () => onSignal('SIGTERM'))
  }

  async shutdown() {
    if (this.shuttingDown) return
    this.shuttingDown = true
    logEvent('daemon', 'info', 'shutdown.begin', 'Stopping sub-systems (Aegis → Guardian → Forge → Cortex → Beacon → API)')

    if (this.executor.inFlightCount() > 0) {
      // Drain up to 30s, then interrupt remaining.
      const deadline = Date.now() + 30_000
      while (this.executor.inFlightCount() > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000))
      }
      if (this.executor.inFlightCount() > 0) this.executor.interruptInFlight('Daemon shutdown drain timeout.')
    }

    this.aegis.stop()
    this.guardian.stop()
    this.forge.stop()
    // Cortex has no loop of its own beyond auto-fallback timer (cleared below).
    this.beacon.stop()
    for (const t of this.timers) clearInterval(t)
    for (const w of this.watchers) w.close()
    await this.api.stop()
    try {
      if (fs.existsSync(daemonPidFile)) fs.unlinkSync(daemonPidFile)
    } catch {
      // ignore
    }
    logEvent('daemon', 'info', 'shutdown.complete', 'Sentinel daemon stopped')
    process.exit(0)
  }
}

function trayStatus(status: string): TraySubsystem['status'] {
  if (status === 'online') return 'online'
  if (status === 'not-configured') return 'not-configured'
  if (status === 'paused') return 'paused'
  return 'offline'
}

// Entry point — only auto-start when run directly (not when imported).
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  const daemon = new SentinelDaemon()
  daemon.start().catch((err) => {
    logEvent('daemon', 'critical', 'startup.failed', `Daemon failed to start: ${(err as Error).message}`)
    process.exitCode = 1
  })
}

export { VERSION }
