import fs from 'node:fs'
import path from 'node:path'
import { deploymentRecordsFile, featureCoverageFile, startReadinessFile, toolsRoot } from '../lib/paths.js'
import { readJsonFile, writeJsonFile } from '../lib/json-store.js'
import { httpProbe } from '../lib/net.js'
import { findPidsOnPort, killPid, spawnDetached } from '../lib/proc.js'
import { HEALER_PERMISSIONS, isActionAllowed } from '../executor/permissions.js'
import type { SentinelConfig } from '../config/schema.js'
import type { IssueDraft, SentinelSeverity } from '../lib/issues.js'

export interface HealerDeps {
  getConfig(): SentinelConfig
  audit(entry: { subsystem: 'healer'; action: string; outcome: 'success' | 'failed' | 'escalated' | 'info'; message: string; durationMs?: number }): void
  notifyAlert(severity: SentinelSeverity, title: string, message: string): void
  notifyActivity(title: string, message: string): void
  push(severity: SentinelSeverity, title: string, message: string): void
  recomputeTray(): void
  resolveHeartbeatTarget(targetId: string, message: string): void
  escalateIssue(draft: IssueDraft): void
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

type StageStatus = 'complete' | 'pending' | 'needs-audit'
type DeploymentFeature = {
  id: number
  phase: string
  area: string
  feature: string
  status?: string
  backendStatus?: StageStatus
  frontendStatus?: StageStatus
  priority?: string
  evidence?: string
  nextStep?: string
}
type StartReadiness = {
  createdAt?: string
  phase?: string
  ready?: boolean
  steps?: Array<{ name: string; status: 'pass' | 'fail'; message: string }>
}

function portFromUrl(url: string, fallback: number) {
  try {
    const p = new URL(url).port
    return p ? Number(p) : fallback
  } catch {
    return fallback
  }
}

export class DevToolsHealer {
  private deps: HealerDeps
  private restartTimestamps: number[] = []
  private lockedUntil = 0
  private healing = false

  constructor(deps: HealerDeps) {
    this.deps = deps
  }

  /** Beacon calls this when the DevTools dashboard target goes stale. */
  async heal(targetId: string) {
    if (targetId !== 'devtools-dashboard') return // only the dashboard is auto-recovered
    const cfg = this.deps.getConfig()
    if (!cfg.healer.enabled) return
    if (this.healing) return
    const now = Date.now()
    if (now < this.lockedUntil) return // cooldown / locked

    // Rate limit
    this.restartTimestamps = this.restartTimestamps.filter((t) => now - t < 60 * 60 * 1000)
    if (this.restartTimestamps.length >= cfg.healer.maxRestartsPerHour) {
      this.lockAndEscalate('Rate limit reached — maxRestartsPerHour exceeded.')
      return
    }

    this.healing = true
    this.deps.recomputeTray()
    const start = Date.now()
    const healthUrl = cfg.targets.devtoolsHealthUrl
    const port = portFromUrl(healthUrl, 4000)

    try {
      for (let attempt = 1; attempt <= cfg.healer.escalateAfterAttempts; attempt += 1) {
        this.restartTimestamps.push(Date.now())
        await this.runAttempt(attempt, port)
        const recovered = await this.verifyHealth(healthUrl, 60_000)
        if (recovered) {
          const downtime = Math.round((Date.now() - start) / 1000)
          this.deps.audit({ subsystem: 'healer', action: `recovery.attempt-${attempt}`, outcome: 'success', message: `DevTools restored after attempt ${attempt}`, durationMs: Date.now() - start })
          this.deps.resolveHeartbeatTarget('devtools-dashboard', `DevTools restored — downtime ${downtime}s`)
          this.deps.notifyActivity('DevTools restored', `DevTools dashboard recovered after attempt ${attempt} — downtime ${downtime}s.`)
          this.deps.recomputeTray()
          return
        }
      }
      this.lockAndEscalate(`DevTools unrecoverable after ${cfg.healer.escalateAfterAttempts} attempts.`)
    } finally {
      this.healing = false
    }
  }

  refreshDerivedDeploymentRecords() {
    let ok = false
    this.act('refresh-derived-deployment-records', () => {
      const features = readJsonFile<DeploymentFeature[]>(featureCoverageFile, [])
      if (!features.length) throw new Error('No feature coverage records found.')

      const backend = summarise(features, 'backendStatus')
      const frontend = summarise(features, 'frontendStatus')
      writeJsonFile(deploymentRecordsFile, {
        record: 'Docmee deployment stage grouping',
        updatedAt: new Date().toISOString().slice(0, 10),
        source: 'tools/logs/rev1-feature-coverage.json',
        landingPage: {
          title: 'Docmee Deployment',
          route: '/docmee-deployment',
          purpose: 'User chooses between the Backend deployment lane and the Frontend deployment lane before starting deployment review.'
        },
        sharedWorkflow: {
          enabled: true,
          purpose: 'Backend and Frontend use the same screen arrangement, guided workprocess, workflow steps, progress gauge, grouped records, and heartbeat-style stage monitor.',
          steps: ['Run readiness', 'Review grouped records', 'Verify or launch the stage', 'Deploy or verify VPS', 'Export report']
        },
        groups: [
          {
            id: 'backend',
            title: 'Docmee Deployment - Backend',
            route: '/docmee-deployment-backend',
            statusField: 'backendStatus',
            completeMeaning: 'Backend/local-code implementation is complete. Evidence comes from the completed feature coverage record.',
            detailFields: ['id', 'phase', 'area', 'feature', 'priority', 'backendStatus', 'evidence', 'nextStep'],
            summary: backend
          },
          {
            id: 'frontend',
            title: 'Docmee Deployment - Frontend',
            route: '/docmee-deployment-frontend',
            statusField: 'frontendStatus',
            completeMeaning: 'Frontend/product acceptance is complete only after the running app passes UI, mobile, workflow, language, and design review.',
            detailFields: ['id', 'phase', 'area', 'feature', 'priority', 'frontendStatus', 'evidence', 'nextStep'],
            summary: frontend
          }
        ],
        notes: [
          'Backend and frontend records are intentionally separate so backend completion does not overclaim product/UI readiness.',
          'The full completed item details remain in the feature coverage source record and are rendered by each deployment page.',
          'Frontend records remain incomplete until each visible screen, route, workflow, mobile layout, and EN/ES label set is accepted in the running app.'
        ]
      })

      const readiness = readJsonFile<StartReadiness>(startReadinessFile, { ready: false, steps: [] })
      const openFrontend = frontend.pending + frontend.needsAudit
      const message =
        openFrontend > 0
          ? `${openFrontend} frontend item(s) need audit or acceptance.`
          : 'Frontend acceptance queue is clear.'
      const steps = readiness.steps ?? []
      const idx = steps.findIndex((step) => step.name === 'Frontend Queue')
      const queueStep = { name: 'Frontend Queue', status: 'pass' as const, message }
      if (idx >= 0) steps[idx] = queueStep
      else steps.push(queueStep)
      writeJsonFile(startReadinessFile, { ...readiness, steps })
      ok = true
    })
    return ok
  }

  private async runAttempt(attempt: number, port: number) {
    if (attempt === 1) {
      // Restart dashboard process.
      this.act('kill-dashboard-process', () => this.killDashboard(port))
      await sleep(1500)
      this.act('restart-dashboard-process', () => this.restartDashboard())
    } else if (attempt === 2) {
      // Clear .next cache + restart.
      this.act('kill-dashboard-process', () => this.killDashboard(port))
      this.act('clear-next-cache', () => this.clearNextCache())
      await sleep(1500)
      this.act('restart-dashboard-process', () => this.restartDashboard())
    } else {
      // Kill port conflict + restart.
      this.act('kill-port-conflict', () => this.killDashboard(port))
      await sleep(1500)
      this.act('restart-dashboard-process', () => this.restartDashboard())
    }
  }

  /** Run an action only if the permission envelope allows it. */
  private act(action: string, fn: () => void) {
    if (!isActionAllowed(HEALER_PERMISSIONS, action)) {
      this.deps.audit({ subsystem: 'healer', action, outcome: 'failed', message: `Action ${action} denied by permission envelope` })
      return
    }
    try {
      fn()
      this.deps.audit({ subsystem: 'healer', action, outcome: 'info', message: `Executed ${action}` })
    } catch (err) {
      this.deps.audit({ subsystem: 'healer', action, outcome: 'failed', message: `Action ${action} threw: ${(err as Error).message}` })
    }
  }

  private killDashboard(port: number) {
    for (const pid of findPidsOnPort(port)) killPid(pid, true)
  }

  private clearNextCache() {
    const next = path.join(toolsRoot, 'dashboard', '.next')
    if (fs.existsSync(next)) fs.rmSync(next, { recursive: true, force: true })
  }

  private restartDashboard() {
    // Mirrors `pnpm --dir dashboard dev` from tools/package.json.
    spawnDetached('pnpm', ['--dir', 'dashboard', 'dev'], { cwd: toolsRoot })
  }

  private async verifyHealth(url: string, withinMs: number) {
    const deadline = Date.now() + withinMs
    while (Date.now() < deadline) {
      const r = await httpProbe(url, { expectStatuses: [200], timeoutMs: 4000 })
      if (r.ok) return true
      await sleep(3000)
    }
    return false
  }

  private lockAndEscalate(reason: string) {
    const cfg = this.deps.getConfig()
    this.lockedUntil = Date.now() + cfg.healer.cooldownSeconds * 1000
    this.deps.audit({ subsystem: 'healer', action: 'escalate', outcome: 'escalated', message: reason })
    this.deps.escalateIssue({
      source: 'devtools-healer',
      environment: 'development',
      phase: 'dashboard',
      severity: 'critical',
      category: 'devtools-unrecoverable',
      checkName: 'devtools-dashboard',
      diagnosis: 'DevTools dashboard could not be recovered automatically.',
      evidence: [reason, `Cooldown until ${new Date(this.lockedUntil).toISOString()}`],
      sourceSignals: ['healer'],
      suggestedFix: 'Manual intervention required. Check dashboard logs and port 4000.',
      riskLevel: 'high',
      requiresApproval: true,
      assignedAgent: 'Dashboard/UI agent',
      assignedProvider: 'global'
    })
    this.deps.notifyAlert('critical', 'DevTools unrecoverable', `${reason} Manual intervention required.`)
    this.deps.push('critical', 'DevTools unrecoverable', 'Manual intervention required.')
    this.deps.recomputeTray()
  }

  isHealing() {
    return this.healing
  }
}

function stageFor(item: DeploymentFeature, field: 'backendStatus' | 'frontendStatus'): StageStatus {
  const explicit = item[field]
  if (explicit === 'complete' || explicit === 'pending' || explicit === 'needs-audit') return explicit
  if (field === 'backendStatus') return item.status === 'complete' ? 'complete' : 'pending'
  return item.status === 'complete' ? 'needs-audit' : 'pending'
}

function summarise(features: DeploymentFeature[], field: 'backendStatus' | 'frontendStatus') {
  const counts = features.reduce(
    (acc, item) => {
      const stage = stageFor(item, field)
      if (stage === 'needs-audit') acc.needsAudit += 1
      else acc[stage] += 1
      return acc
    },
    { complete: 0, pending: 0, needsAudit: 0 }
  )
  return { designedFeatures: features.length, ...counts }
}
