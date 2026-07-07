import fs from 'node:fs'
import path from 'node:path'

const toolsRoot = path.resolve(process.cwd(), '..')
const logsRoot = path.join(toolsRoot, 'logs')
const issuesFile = path.join(logsRoot, 'sentinel-issues.json')
const configFile = path.join(logsRoot, 'sentinel-config.json')
const auditFile = path.join(logsRoot, 'sentinel-audit.json')

export type SentinelSeverity = 'info' | 'warning' | 'critical'
export type SentinelStatus = 'detected' | 'assigned' | 'fixing' | 'waiting-approval' | 'resolved' | 'failed' | 'ignored'
export type SentinelRisk = 'low' | 'medium' | 'high'

export type SentinelIssue = {
  id: string
  createdAt: string
  updatedAt: string
  phase: string
  severity: SentinelSeverity
  category: string
  status: SentinelStatus
  diagnosis: string
  evidence: string[]
  sourceSignals: string[]
  suggestedFix: string
  riskLevel: SentinelRisk
  requiresApproval: boolean
  assignedAgent: string
  assignedProvider: string
  attempts: number
  resolution: string
}

export type SentinelConfig = {
  mode: 'observe-only' | 'diagnose-and-assign' | 'auto-fix-safe-issues' | 'approval-required'
  quietHours: { enabled: boolean; start: string; end: string }
  maxRetries: number
  cooldownMinutes: number
  severityThresholds: SentinelSeverity[]
  neverTouch: string[]
  safeFixAllowlist: string[]
  approvalRequired: string[]
  routing: Record<string, { agent: string; provider: string }>
}

type ReadyJson = {
  ready?: boolean
  createdAt?: string
  summary?: { pass?: number; warning?: number; critical?: number }
  categories?: Array<{ label?: string; checks?: Array<{ name?: string; status?: string; message?: string; fix?: string }> }>
}

type BuildRunJson = {
  pid?: number
  phase?: string
  status?: string
  heartbeatAt?: string
  message?: string
}

type GateJson = {
  generatedAt?: string
  ok?: boolean
  results?: Array<{ name?: string; ok?: boolean; detail?: string }>
}

type PostDeploymentRun = {
  createdAt?: string
  summary?: { pass?: number; warning?: number; fail?: number }
  checks?: Array<{ name?: string; status?: string; message?: string }>
}

type BuildControlRow = {
  phaseId?: string
  status?: string
  notes?: string
  updatedAt?: string
}

type IssueDraft = Omit<SentinelIssue, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'attempts' | 'resolution'>

const defaultConfig: SentinelConfig = {
  mode: 'observe-only',
  quietHours: { enabled: false, start: '22:00', end: '07:00' },
  maxRetries: 2,
  cooldownMinutes: 10,
  severityThresholds: ['info', 'warning', 'critical'],
  neverTouch: [
    'active build watcher',
    'phase status',
    'git commit or push',
    'notion build control',
    '.env files',
    'process trees',
    'files outside dashboard cache'
  ],
  safeFixAllowlist: [
    'refresh dashboard status',
    'rerun ready check',
    'restart dashboard process only',
    'clear dashboard .next cache after dashboard process is stopped',
    'create or update sentinel issue records'
  ],
  approvalRequired: [
    'kill active build watcher',
    'restart phase automation',
    'change phase status',
    'git commit or push',
    'mutate Notion build status',
    'edit env files',
    'delete files outside dashboard cache',
    'run destructive commands'
  ],
  routing: {
    'claude-session-limit': { agent: 'Claude account/session agent', provider: 'Claude Code' },
    'dashboard-route-error': { agent: 'Dashboard/UI agent', provider: 'Codex' },
    'stale-heartbeat': { agent: 'Diagnostics agent', provider: 'Codex' },
    'dead-watcher-process': { agent: 'Diagnostics agent', provider: 'Codex' },
    'ready-check-blocker': { agent: 'Diagnostics agent', provider: 'Codex' },
    'gate-failure': { agent: 'CLI/build agent', provider: 'Claude Code' },
    'git-failure': { agent: 'Git/GitHub agent', provider: 'Codex' },
    'deployment-check-failure': { agent: 'Deployment agent', provider: 'Codex' },
    'discord-notification-failure': { agent: 'Notion/Discord integration agent', provider: 'Codex' },
    'notion-sync-failure': { agent: 'Notion integration agent', provider: 'Codex' }
  }
}

function readJson<T>(file: string, fallback: T): T {
  const target = path.isAbsolute(file) ? file : path.join(logsRoot, file)
  if (!fs.existsSync(target)) return fallback
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2))
}

function latestLog(pattern: RegExp) {
  try {
    return fs.readdirSync(logsRoot)
      .filter((name) => pattern.test(name))
      .map((name) => ({ name, mtime: fs.statSync(path.join(logsRoot, name)).mtimeMs }))
      .sort((left, right) => right.mtime - left.mtime)[0]?.name ?? null
  } catch {
    return null
  }
}

function tail(file: string | null, lines = 120) {
  if (!file) return []
  try {
    return fs.readFileSync(path.join(logsRoot, file), 'utf8').split(/\r?\n/).filter(Boolean).slice(-lines)
  } catch {
    return []
  }
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80)
}

function issueId(issue: IssueDraft) {
  return `sentinel-${slug(`${issue.category}-${issue.phase}-${issue.diagnosis}`)}`
}

function routingFor(config: SentinelConfig, category: string) {
  return config.routing[category] ?? { agent: 'Manual queue', provider: 'Manual queue' }
}

function ensureConfig() {
  const config = readJson<SentinelConfig>(configFile, defaultConfig)
  writeJson(configFile, { ...defaultConfig, ...config, routing: { ...defaultConfig.routing, ...(config.routing ?? {}) } })
  return readJson<SentinelConfig>(configFile, defaultConfig)
}

function addIssue(issues: IssueDraft[], config: SentinelConfig, issue: Omit<IssueDraft, 'assignedAgent' | 'assignedProvider'>) {
  const route = routingFor(config, issue.category)
  issues.push({ ...issue, assignedAgent: route.agent, assignedProvider: route.provider })
}

function isProcessAlive(pid?: number) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function mergeIssues(drafts: IssueDraft[]) {
  const now = new Date().toISOString()
  const previous = readJson<SentinelIssue[]>(issuesFile, [])
  const previousById = new Map(previous.map((issue) => [issue.id, issue]))
  const next = drafts.map((draft) => {
    const id = issueId(draft)
    const existing = previousById.get(id)
    return {
      ...draft,
      id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      status: existing?.status && existing.status !== 'resolved' ? existing.status : 'detected',
      attempts: existing?.attempts ?? 0,
      resolution: existing?.resolution ?? ''
    } satisfies SentinelIssue
  })
  const retained = previous.filter((issue) => ['resolved', 'ignored'].includes(issue.status)).slice(0, 100)
  return [...next, ...retained].slice(0, 200)
}

function appendAudit(entry: { action: string; message: string; issueCount?: number }) {
  const audit = readJson<Array<{ createdAt: string; action: string; message: string; issueCount?: number }>>(auditFile, [])
  writeJson(auditFile, [{ createdAt: new Date().toISOString(), ...entry }, ...audit].slice(0, 200))
}

function detectReadyIssues(config: SentinelConfig, issues: IssueDraft[]) {
  const ready = readJson<ReadyJson>('ready.json', {})
  for (const category of ready.categories ?? []) {
    for (const check of category.checks ?? []) {
      if (check.status !== 'critical' && check.status !== 'fail') continue
      const message = `${check.name ?? 'Ready Check'}: ${check.message ?? 'Ready Check found a blocker.'}`
      const lower = message.toLowerCase()
      addIssue(issues, config, {
        phase: 'setup',
        severity: lower.includes('claude') || lower.includes('session limit') ? 'critical' : 'warning',
        category: lower.includes('claude') || lower.includes('session limit') ? 'claude-session-limit' : 'ready-check-blocker',
        diagnosis: message,
        evidence: [check.fix ?? 'Run Ready Check for the exact blocker.'],
        sourceSignals: ['logs/ready.json', 'pnpm tool ready'],
        suggestedFix: check.fix ?? 'Open Ready Check, resolve the listed blocker, then rerun Sentinel Scan.',
        riskLevel: lower.includes('claude') ? 'high' : 'medium',
        requiresApproval: true
      })
    }
  }
}

function detectBuildIssues(config: SentinelConfig, issues: IssueDraft[]) {
  const run = readJson<BuildRunJson>('build-run.json', {})
  const phase = run.phase ?? 'unknown'
  const heartbeatAgeMs = run.heartbeatAt ? Date.now() - new Date(run.heartbeatAt).getTime() : null
  const live = isProcessAlive(run.pid)
  const activeStatus = ['starting', 'running', 'paused'].includes(run.status ?? '')
  if (activeStatus && !live) {
    addIssue(issues, config, {
      phase,
      severity: 'critical',
      category: 'dead-watcher-process',
      diagnosis: `Build watcher is marked ${run.status}, but PID ${run.pid ?? 'unknown'} is not alive.`,
      evidence: [`Message: ${run.message ?? 'none'}`, `Heartbeat: ${run.heartbeatAt ?? 'none'}`],
      sourceSignals: ['logs/build-run.json'],
      suggestedFix: 'Do not auto-kill anything. Review Build Control and restart only after approval.',
      riskLevel: 'high',
      requiresApproval: true
    })
  }
  if (activeStatus && typeof heartbeatAgeMs === 'number' && heartbeatAgeMs > 120000) {
    addIssue(issues, config, {
      phase,
      severity: heartbeatAgeMs > 300000 ? 'critical' : 'warning',
      category: 'stale-heartbeat',
      diagnosis: `Build heartbeat is stale by ${Math.round(heartbeatAgeMs / 1000)} seconds.`,
      evidence: [`Last heartbeat: ${run.heartbeatAt}`, `Status: ${run.status ?? 'unknown'}`],
      sourceSignals: ['logs/build-run.json', '/api/install-monitor/status'],
      suggestedFix: 'Open Install Monitor and Diagnostics. Restart automation only after approval.',
      riskLevel: 'high',
      requiresApproval: true
    })
  }
  const message = `${run.message ?? ''}`.toLowerCase()
  if (message.includes('session limit') || message.includes("you've hit your session limit")) {
    addIssue(issues, config, {
      phase,
      severity: 'critical',
      category: 'claude-session-limit',
      diagnosis: run.message ?? 'Claude Code session limit detected.',
      evidence: [`Status: ${run.status ?? 'unknown'}`],
      sourceSignals: ['logs/build-run.json', 'Claude Code output'],
      suggestedFix: 'Use Claude Switch, verify the active account, then resume after the reset window.',
      riskLevel: 'high',
      requiresApproval: true
    })
  }
}

function detectGateIssues(config: SentinelConfig, issues: IssueDraft[]) {
  const gates = readJson<GateJson>('six-gates.json', {})
  for (const result of gates.results ?? []) {
    if (result.ok !== false) continue
    addIssue(issues, config, {
      phase: 'quality-gates',
      severity: 'critical',
      category: 'gate-failure',
      diagnosis: `${result.name ?? 'Gate'} failed.`,
      evidence: [result.detail?.slice(0, 800) ?? 'Gate reported failure.'],
      sourceSignals: ['logs/six-gates.json', 'pnpm tool gates check'],
      suggestedFix: 'Route to CLI/build agent. Do not auto-fix gate failures without approval.',
      riskLevel: 'high',
      requiresApproval: true
    })
  }
}

function detectDeploymentIssues(config: SentinelConfig, issues: IssueDraft[]) {
  const runs = readJson<PostDeploymentRun[]>('post-deployment.json', [])
  const latest = runs[0]
  if (!latest) return
  for (const check of latest.checks ?? []) {
    if (check.status !== 'fail') continue
    addIssue(issues, config, {
      phase: 'post-deployment',
      severity: 'critical',
      category: 'deployment-check-failure',
      diagnosis: `${check.name ?? 'Deployment check'} failed: ${check.message ?? 'No detail provided.'}`,
      evidence: [`Latest run: ${latest.createdAt ?? 'unknown'}`],
      sourceSignals: ['logs/post-deployment.json', '/post-deployment'],
      suggestedFix: 'Route to Deployment agent. Run the functionality check again after a fix.',
      riskLevel: 'medium',
      requiresApproval: true
    })
  }
}

function detectBuildControlIssues(config: SentinelConfig, issues: IssueDraft[]) {
  const rows = readJson<BuildControlRow[]>('build-control.json', [])
  for (const row of rows) {
    if (row.status !== 'failed') continue
    const notes = row.notes ?? ''
    const lower = notes.toLowerCase()
    const isGit = lower.includes('git') || lower.includes('commit') || lower.includes('push')
    addIssue(issues, config, {
      phase: row.phaseId ?? 'unknown',
      severity: 'critical',
      category: isGit ? 'git-failure' : 'phase-status-mismatch',
      diagnosis: `${row.phaseId ?? 'Phase'} is failed in Build Control.`,
      evidence: [notes || 'Build Control row has failed status.', `Updated: ${row.updatedAt ?? 'unknown'}`],
      sourceSignals: ['logs/build-control.json'],
      suggestedFix: isGit ? 'Route to Git/GitHub agent. Commit or push only after user approval.' : 'Route to CLI/build agent and verify phase status before changing it.',
      riskLevel: 'high',
      requiresApproval: true
    })
  }
}

function detectLogIssues(config: SentinelConfig, issues: IssueDraft[]) {
  const phaseLog = tail(latestLog(/^phase-\d{4}-\d{2}-\d{2}\.log$/))
  const dashboardLog = tail(latestLog(/^dashboard-.*\.(out|err)\.log$/))
  const combined = [...phaseLog, ...dashboardLog].slice(-180)
  const lower = combined.join('\n').toLowerCase()
  if (lower.includes('failed to load chunk') || lower.includes('chunkloaderror') || lower.includes('.next')) {
    addIssue(issues, config, {
      phase: 'dashboard',
      severity: 'warning',
      category: 'dashboard-route-error',
      diagnosis: 'Dashboard build/cache route error detected in recent logs.',
      evidence: combined.filter((line) => /chunk|\.next|route|error/i.test(line)).slice(-4),
      sourceSignals: ['tools/logs/dashboard-*.log', 'tools/logs/phase-*.log'],
      suggestedFix: 'Safe fix can clear dashboard .next only after the dashboard process is stopped, then restart dashboard.',
      riskLevel: 'low',
      requiresApproval: false
    })
  }
  const discordFailureLines = combined.filter((line) => /discord|webhook|notification/i.test(line) && /(failed|failure|unauthorized|forbidden|invalid token|missing token|missing channel|not sent|send failed)/i.test(line))
  if (discordFailureLines.length > 0) {
    addIssue(issues, config, {
      phase: 'notifications',
      severity: 'warning',
      category: 'discord-notification-failure',
      diagnosis: 'Possible Discord notification failure found in recent logs.',
      evidence: discordFailureLines.slice(-4),
      sourceSignals: ['tools/logs/*.log', 'tools/logs/discord-messages.json'],
      suggestedFix: 'Route to Notion/Discord integration agent and test Discord from the Discord Status page.',
      riskLevel: 'medium',
      requiresApproval: true
    })
  }
  const notionFailureLines = combined.filter((line) => /notion|sync/i.test(line) && /(failed|failure|unauthorized|forbidden|invalid token|invalid database|invalid page|sync failed)/i.test(line))
  if (notionFailureLines.length > 0) {
    addIssue(issues, config, {
      phase: 'notion',
      severity: 'warning',
      category: 'notion-sync-failure',
      diagnosis: 'Possible Notion sync failure found in recent logs.',
      evidence: notionFailureLines.slice(-4),
      sourceSignals: ['tools/logs/*.log'],
      suggestedFix: 'Route to Notion integration agent and verify Notion settings before retrying sync.',
      riskLevel: 'medium',
      requiresApproval: true
    })
  }
}

export function readSentinelConfig() {
  return ensureConfig()
}

export function readSentinelIssues() {
  return readJson<SentinelIssue[]>(issuesFile, [])
}

export function readSentinelAudit() {
  return readJson<Array<{ createdAt: string; action: string; message: string; issueCount?: number }>>(auditFile, [])
}

export function scanSentinel() {
  const config = ensureConfig()
  const drafts: IssueDraft[] = []
  detectBuildIssues(config, drafts)
  detectReadyIssues(config, drafts)
  detectGateIssues(config, drafts)
  detectDeploymentIssues(config, drafts)
  detectBuildControlIssues(config, drafts)
  detectLogIssues(config, drafts)
  const issues = mergeIssues(drafts)
  writeJson(issuesFile, issues)
  appendAudit({ action: 'scan', message: `Sentinel scanned DevTools signals and found ${drafts.length} active issue${drafts.length === 1 ? '' : 's'}.`, issueCount: drafts.length })
  return { config, issues, activeIssueCount: drafts.length }
}

export function sentinelSummary(issues = readSentinelIssues()) {
  const active = issues.filter((issue) => !['resolved', 'ignored'].includes(issue.status))
  return {
    active: active.length,
    critical: active.filter((issue) => issue.severity === 'critical').length,
    warning: active.filter((issue) => issue.severity === 'warning').length,
    info: active.filter((issue) => issue.severity === 'info').length,
    approval: active.filter((issue) => issue.requiresApproval).length,
    safe: active.filter((issue) => !issue.requiresApproval).length
  }
}
