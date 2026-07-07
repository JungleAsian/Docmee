import { aegisHeartbeatFile, aegisChecksFile, aegisAuditFile } from '../lib/paths.js'
import { readJsonFile, writeJsonFile } from '../lib/json-store.js'
import { writeHeartbeat } from '../lib/heartbeat.js'
import { mergeIssuesForSource, writeIssues, type IssueDraft } from '../lib/issues.js'
import type { SubsystemDeps } from '../lib/deps.js'
import { loadAegisConfig, type AegisConfig } from './config.js'

const VERSION = '1.0.0'

export type AegisCategory = 'safety' | 'clinic-ops' | 'ai-quality' | 'integrations' | 'licensing'
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip'

export interface AegisCheckResult {
  checkName: string
  category: AegisCategory
  status: CheckStatus
  severity: 'info' | 'warning' | 'critical'
  lastChecked: string
  lastChanged: string
  consecutiveFailures: number
  clinicId?: string
  patientImpact: boolean
  complianceRisk: boolean
  // PHI-safe evidence: counts/ids/timestamps only.
  metric?: number
  note: string
}

/**
 * Aegis runs scoped, aggregate DB queries — never SELECTs on conversation content,
 * patient names, or notes (Aegis spec — PHI protection). A query runner is injected
 * on the VPS where the read-only connection exists. Returns aggregate rows only.
 */
export type AegisQueryRunner = (sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>

let queryRunner: AegisQueryRunner | null = null
export function setAegisQueryRunner(runner: AegisQueryRunner | null) {
  queryRunner = runner
}

interface AegisAuditEntry {
  ts: string
  category: string
  checkName: string
  action: string
  outcome: 'success' | 'failed' | 'escalated' | 'notify'
}

export class AegisScanner {
  private deps: SubsystemDeps
  private config: AegisConfig
  private timers: NodeJS.Timeout[] = []
  private startedAt = Date.now()
  private results = new Map<string, AegisCheckResult>()

  constructor(deps: SubsystemDeps) {
    this.deps = deps
    this.config = loadAegisConfig()
  }

  private configured() {
    const cfg = this.deps.getConfig()
    return cfg.subsystems.aegisEnabled && Boolean(process.env.AEGIS_DB_URL) && queryRunner !== null
  }

  start() {
    this.config = loadAegisConfig()
    if (!this.configured()) {
      this.writeNotConfigured()
      this.timers.push(
        setInterval(() => {
          this.writeNotConfigured()
          this.deps.reportAlive()
        }, 60_000)
      )
      this.deps.reportAlive()
      return
    }
    void this.runAll('safety')
    this.timers.push(setInterval(() => void this.runAll('safety'), this.config.schedules.safetyRulesIntervalSeconds * 1000))
    this.timers.push(setInterval(() => void this.runAll('clinic-ops'), this.config.schedules.clinicOpsIntervalSeconds * 1000))
    this.timers.push(setInterval(() => void this.runAll('ai-quality'), this.config.schedules.aiQualityIntervalSeconds * 1000))
    this.timers.push(setInterval(() => void this.runAll('integrations'), this.config.schedules.integrationsIntervalSeconds * 1000))
    this.timers.push(setInterval(() => void this.runAll('licensing'), this.config.schedules.licensingIntervalSeconds * 1000))
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
    void this.runAll('safety')
    return this.escalations()
  }

  private record(r: Omit<AegisCheckResult, 'lastChecked' | 'lastChanged' | 'consecutiveFailures'>) {
    const now = new Date().toISOString()
    const prev = this.results.get(r.checkName)
    const changed = !prev || prev.status !== r.status
    this.results.set(r.checkName, {
      ...r,
      lastChecked: now,
      lastChanged: changed ? now : prev?.lastChanged ?? now,
      consecutiveFailures: r.status === 'fail' ? (prev?.consecutiveFailures ?? 0) + 1 : 0
    })
  }

  /**
   * Run a category's checks. Each check uses aggregate queries via the injected
   * runner. Detection rules are encoded here; PHI never enters a result.
   */
  private async runAll(category: AegisCategory) {
    if (!queryRunner) return
    try {
      if (category === 'safety') {
        await this.count('Bot interruption rule', category, 'critical', true, true, 'SELECT count(*)::int AS n FROM conversations WHERE bot_sent_at > human_takeover_at')
        await this.count('Medical safety rule', category, 'critical', true, true, 'SELECT count(*)::int AS n FROM bot_replies WHERE safety_flagged = true AND reviewed = false')
        await this.count('Licensing interruption', category, 'critical', true, false, "SELECT count(*)::int AS n FROM conversations WHERE stopped_reason = 'license_check_failed'")
        await this.count('STOP opt-out compliance', category, 'critical', true, true, 'SELECT count(*)::int AS n FROM outbound_messages om JOIN opt_outs o ON o.phone = om.to_phone WHERE om.sent_at > o.opted_out_at')
        await this.count('24-hour window violation', category, 'critical', true, true, "SELECT count(*)::int AS n FROM outbound_messages WHERE outside_24h_window = true AND template_approved = false")
      } else if (category === 'clinic-ops') {
        await this.count('Unassigned conversation backlog', category, 'warning', true, false, `SELECT count(*)::int AS n FROM conversations WHERE status = 'waiting' AND updated_at < now() - ($1 || ' minutes')::interval`, [this.config.thresholds.unassignedConversationWarningMinutes])
        await this.count('Double-booking detection', category, 'critical', true, false, 'SELECT count(*)::int AS n FROM appointment_overlaps')
      } else if (category === 'ai-quality') {
        await this.count('Transcription failure clustering', category, 'warning', false, false, `SELECT count(*)::int AS n FROM transcription_jobs WHERE status = 'failed' AND created_at > now() - ($1 || ' minutes')::interval`, [this.config.thresholds.transcriptionFailureWindow])
      } else if (category === 'integrations') {
        await this.count('WhatsApp delivery failure clustering', category, 'warning', true, true, `SELECT count(*)::int AS n FROM message_deliveries WHERE status = 'failed' AND updated_at > now() - ($1 || ' minutes')::interval`, [this.config.thresholds.whatsappFailureWindow])
      } else if (category === 'licensing') {
        await this.count('License expiry approach', category, 'warning', false, false, `SELECT count(*)::int AS n FROM licenses WHERE expires_at < now() + ($1 || ' days')::interval`, [this.config.thresholds.licenseExpiryWarningDays])
      }
    } catch (err) {
      this.audit({ category, checkName: `${category}-batch`, action: 'query', outcome: 'failed' })
      this.deps.notifyActivity('Aegis query error', `A ${category} query failed (sanitised). Aegis continues with prior results.`)
      void err
    }
    writeJsonFile(aegisChecksFile, Array.from(this.results.values()))
    this.writeIssuesNow()
    this.writeHeartbeatNow()
    this.deps.reportAlive()
  }

  private async count(checkName: string, category: AegisCategory, severity: 'warning' | 'critical', patientImpact: boolean, complianceRisk: boolean, sql: string, params: unknown[] = []) {
    if (!queryRunner) return
    const rows = await queryRunner(sql, params)
    const n = Number(rows[0]?.n ?? 0)
    const status: CheckStatus = n > 0 ? (severity === 'critical' ? 'fail' : 'warn') : 'pass'
    this.record({ checkName, category, status, severity, patientImpact, complianceRisk, metric: n, note: `${n} matching record(s)` })
  }

  private escalations(): IssueDraft[] {
    const drafts: IssueDraft[] = []
    for (const r of this.results.values()) {
      if (r.status !== 'fail' && r.status !== 'warn') continue
      const neverAuto = this.config.neverAutoRecover.some((k) => r.checkName.toLowerCase().includes(k.replace(/-/g, ' ')) || r.checkName.toLowerCase().replace(/[^a-z]/g, '').includes(k.replace(/[^a-z]/g, '')))
      drafts.push({
        source: 'aegis',
        environment: 'production',
        phase: 'runtime',
        severity: r.severity,
        category: r.checkName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        checkCategory: r.category,
        checkName: r.checkName,
        clinicId: r.clinicId,
        affectedFeature: r.checkName,
        patientImpact: r.patientImpact,
        complianceRisk: r.complianceRisk,
        consecutiveFailures: r.consecutiveFailures,
        // PHI-safe: counts only.
        diagnosis: `${r.checkName} triggered (${r.metric ?? 0} record(s)).`,
        evidence: [`Count: ${r.metric ?? 0}`, `Category: ${r.category}`, `Patient impact: ${r.patientImpact}`],
        sourceSignals: ['logs/aegis-checks.json'],
        suggestedFix: neverAuto ? 'Human review required — never auto-recovered.' : 'Safe auto-recovery may apply (e.g. retry transcription, notify clinic admin).',
        riskLevel: r.severity === 'critical' ? 'high' : 'medium',
        requiresApproval: r.severity === 'critical' || neverAuto,
        assignedAgent: r.category === 'safety' ? 'CLI/Build agent' : 'Diagnostics agent',
        assignedProvider: r.category === 'safety' ? 'global' : 'Direct Call'
      })
    }
    return drafts
  }

  private writeIssuesNow() {
    writeIssues(mergeIssuesForSource('aegis', this.escalations()))
  }

  private audit(entry: Omit<AegisAuditEntry, 'ts'>) {
    const log = readJsonFile<AegisAuditEntry[]>(aegisAuditFile, [])
    writeJsonFile(aegisAuditFile, [{ ts: new Date().toISOString(), ...entry }, ...log].slice(0, 1000))
  }

  private writeHeartbeatNow() {
    const all = Array.from(this.results.values())
    writeHeartbeat(aegisHeartbeatFile, {
      timestamp: new Date().toISOString(),
      status: this.config.mode === 'paused' ? 'paused' : this.config.mode === 'observe-only' ? 'observe-only' : 'running',
      version: VERSION,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      activeIssues: all.filter((r) => r.status === 'fail' || r.status === 'warn').length,
      checksPassingCount: all.filter((r) => r.status === 'pass').length,
      checksFailingCount: all.filter((r) => r.status === 'fail').length
    })
  }

  private writeNotConfigured() {
    writeHeartbeat(aegisHeartbeatFile, {
      timestamp: new Date().toISOString(),
      status: 'not-configured',
      version: VERSION,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000)
    })
  }

  status() {
    return { version: VERSION, configured: this.configured(), mode: this.config.mode, checks: Array.from(this.results.values()) }
  }
}
