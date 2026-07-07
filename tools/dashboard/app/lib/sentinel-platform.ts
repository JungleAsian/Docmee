import fs from 'node:fs'
import path from 'node:path'

const toolsRoot = path.resolve(process.cwd(), '..')
const logsRoot = path.join(toolsRoot, 'logs')

export type IssueSource = 'forge' | 'guardian' | 'aegis' | 'heartbeat' | 'devtools-healer' | 'cortex' | 'tunnel'

export interface PlatformIssue {
  id: string
  source: IssueSource
  environment: 'development' | 'production'
  createdAt: string
  updatedAt: string
  phase: string
  severity: 'info' | 'warning' | 'critical'
  category: string
  status: string
  diagnosis: string
  evidence: string[]
  sourceSignals: string[]
  suggestedFix: string
  riskLevel: 'low' | 'medium' | 'high'
  requiresApproval: boolean
  assignedAgent: string
  assignedProvider: string
  checkCategory?: string
  checkName?: string
  clinicId?: string
  patientImpact?: boolean
  complianceRisk?: boolean
}

export interface Heartbeat {
  timestamp?: string
  status?: string
  version?: string
  uptimeSeconds?: number
  checksPassingCount?: number
  checksFailingCount?: number
  activeIssues?: number
}

export interface TrayModel {
  state?: string
  statusLine?: string
  activeIssues?: number
  subsystems?: Array<{ name: string; status: string; detail?: string }>
  updatedAt?: string
}

export interface AuditEntry {
  createdAt?: string
  ts?: string
  subsystem?: string
  action?: string
  outcome?: string
  message?: string
  issueCount?: number
  durationMs?: number
  issueId?: string
}

export interface FeatureRun {
  pid?: number
  phase?: string
  workflow?: string
  status?: string
  startedAt?: string
  heartbeatAt?: string
  message?: string
  githubStatus?: string
  githubMessage?: string
}

interface FeatureCoverageItem {
  status?: string
  backendStatus?: string
  frontendStatus?: string
}

function read<T>(name: string, fallback: T): T {
  const target = path.join(logsRoot, name)
  if (!fs.existsSync(target)) return fallback
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8')) as T
  } catch {
    return fallback
  }
}

export function readIssues(): PlatformIssue[] {
  return read<PlatformIssue[]>('sentinel-issues.json', [])
}

export function issuesBySource(source: IssueSource): PlatformIssue[] {
  return readIssues().filter((i) => i.source === source)
}

export function activeIssues(issues = readIssues()): PlatformIssue[] {
  return issues.filter((i) => !['resolved', 'ignored'].includes(i.status))
}

export function summarize(issues: PlatformIssue[]) {
  const active = activeIssues(issues)
  return {
    active: active.length,
    critical: active.filter((i) => i.severity === 'critical').length,
    warning: active.filter((i) => i.severity === 'warning').length,
    info: active.filter((i) => i.severity === 'info').length,
    approval: active.filter((i) => i.requiresApproval || i.status === 'waiting-approval').length
  }
}

export function readHeartbeat(name: 'forge' | 'guardian' | 'aegis'): Heartbeat {
  return read<Heartbeat>(`${name}-heartbeat.json`, {})
}

export function heartbeatAgeSeconds(hb: Heartbeat): number | null {
  if (!hb.timestamp) return null
  const t = Date.parse(hb.timestamp)
  return Number.isNaN(t) ? null : Math.round((Date.now() - t) / 1000)
}

export function heartbeatLiveness(hb: Heartbeat): 'running' | 'stale' | 'offline' | 'not-configured' {
  if (hb.status === 'not-configured') return 'not-configured'
  const age = heartbeatAgeSeconds(hb)
  if (age === null) return 'offline'
  if (age > 180) return 'stale'
  return 'running'
}

export function readTray(): TrayModel {
  return read<TrayModel>('sentinel-tray.json', {})
}

export function readAudit(): AuditEntry[] {
  return read<AuditEntry[]>('sentinel-audit.json', [])
}

export function readFeatureRun(): FeatureRun {
  return read<FeatureRun>('feature-run.json', {})
}

export function featureRunProcessState(run = readFeatureRun()): 'alive' | 'not-running' | 'unknown' {
  if (!run.pid) return 'unknown'
  if (!['starting', 'running', 'paused'].includes(run.status ?? '')) return 'not-running'
  try {
    process.kill(run.pid, 0)
    return 'alive'
  } catch {
    return 'not-running'
  }
}

export function frontendCoverageSummary() {
  const features = read<FeatureCoverageItem[]>('rev1-feature-coverage.json', [])
  const open = features.filter((item) => {
    const explicit = item.frontendStatus
    const stage = explicit === 'complete' || explicit === 'pending' || explicit === 'needs-audit' ? explicit : item.status === 'complete' ? 'needs-audit' : 'pending'
    return stage !== 'complete'
  }).length
  return {
    total: features.length,
    complete: Math.max(0, features.length - open),
    open
  }
}

export interface CheckRow {
  checkName: string
  category: string
  status: string
  consecutiveFailures?: number
  lastError?: string
  metric?: number
  note?: string
}

export function readChecks(name: 'guardian' | 'aegis'): CheckRow[] {
  return read<CheckRow[]>(`${name}-checks.json`, [])
}

export interface TunnelView {
  activeMode: string
  appUrl: string
  apiUrl: string
  devtoolsUrl: string
  webhookUrl: string
  lastVerified?: string
  webhookReminderPending?: boolean
}

interface LocalConfig {
  tunnel?: {
    activeMode?: string
    ngrok?: { appUrl?: string }
    cloudflare?: { appUrl?: string; apiUrl?: string; devtoolsUrl?: string }
    permanent?: { appUrl?: string; apiUrl?: string; devtoolsUrl?: string }
    lastVerified?: string
    webhookReminderPending?: boolean
  }
  providers?: { globalDefault?: string }
}

export function readTunnel(): TunnelView {
  const cfg = read<LocalConfig>('sentinel-config.local.json', {})
  const t = cfg.tunnel ?? {}
  const mode = t.activeMode ?? 'none'
  let appUrl = ''
  let apiUrl = ''
  let devtoolsUrl = 'http://127.0.0.1:4000'
  if (mode === 'ngrok') {
    appUrl = apiUrl = devtoolsUrl = t.ngrok?.appUrl ?? ''
  } else if (mode === 'cloudflare') {
    appUrl = t.cloudflare?.appUrl ?? ''
    apiUrl = t.cloudflare?.apiUrl ?? ''
    devtoolsUrl = t.cloudflare?.devtoolsUrl ?? ''
  } else if (mode === 'permanent') {
    appUrl = t.permanent?.appUrl ?? ''
    apiUrl = t.permanent?.apiUrl ?? ''
    devtoolsUrl = t.permanent?.devtoolsUrl ?? ''
  }
  return {
    activeMode: mode,
    appUrl,
    apiUrl,
    devtoolsUrl,
    webhookUrl: apiUrl ? `${apiUrl}/webhook/whatsapp` : '',
    lastVerified: t.lastVerified,
    webhookReminderPending: t.webhookReminderPending
  }
}

export function readProvider(): string {
  return read<LocalConfig>('sentinel-config.local.json', {}).providers?.globalDefault ?? 'claude-code'
}

export function severityClass(sev: string) {
  if (sev === 'critical') return 'border-red-800 bg-red-950/30 text-red-200'
  if (sev === 'warning') return 'border-amber-800 bg-amber-950/30 text-amber-200'
  return 'border-cyan-800 bg-cyan-950/30 text-cyan-200'
}

export function livenessClass(state: string) {
  if (state === 'running') return 'border-emerald-700 bg-emerald-950/30 text-emerald-200'
  if (state === 'stale') return 'border-amber-700 bg-amber-950/30 text-amber-200'
  if (state === 'not-configured') return 'border-slate-700 bg-slate-900 text-slate-300'
  return 'border-red-700 bg-red-950/30 text-red-200'
}
