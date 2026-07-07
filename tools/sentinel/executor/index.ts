import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { toolsRoot } from '../lib/paths.js'
import { writeTaskFile, taskLogPath } from './task-writer.js'
import { canInvokeClaude } from './session-guard.js'
import { verifyResolved } from './verifier.js'
import { AGENT_PERMISSIONS } from './permissions.js'
import type { Cortex } from '../cortex/index.js'
import type { SentinelConfig, SentinelAgentRole, ProviderId } from '../config/schema.js'
import type { IssueSource, SentinelIssue, SentinelSeverity } from '../lib/issues.js'

export interface ExecutorDeps {
  getConfig(): SentinelConfig
  cortex: Cortex
  getIssue(id: string): SentinelIssue | null
  updateIssue(id: string, patch: Partial<SentinelIssue>): void
  audit(entry: { subsystem: 'executor'; action: string; outcome: 'success' | 'failed' | 'escalated' | 'info'; message: string; issueId?: string }): void
  notifyActivity(title: string, message: string): void
  notifyAlert(severity: SentinelSeverity, title: string, message: string): void
  rescan(source: IssueSource): void
}

const AGENT_ROLE_BY_LABEL: Record<string, SentinelAgentRole> = {
  'Diagnostics agent': 'diagnostics',
  'Dashboard/UI agent': 'dashboard-ui',
  'CLI/Build agent': 'cli-build',
  'Git/GitHub agent': 'git-github',
  'Claude Session agent': 'claude-session',
  'Notion Integration agent': 'notion-integration',
  'Deployment agent': 'deployment'
}

export class Executor {
  private deps: ExecutorDeps
  private inFlight = new Set<string>()

  constructor(deps: ExecutorDeps) {
    this.deps = deps
  }

  inFlightCount() {
    return this.inFlight.size
  }

  /** Force-interrupt every in-flight execution (used by Cortex force-switch / shutdown). */
  interruptInFlight(reason: string) {
    for (const id of this.inFlight) {
      this.deps.updateIssue(id, { status: 'interrupted', requiresApproval: true, resolution: reason })
      this.deps.audit({ subsystem: 'executor', action: 'interrupt', outcome: 'escalated', message: reason, issueId: id })
    }
    this.inFlight.clear()
  }

  /** Re-point queued (assigned, not running) AI issues to a new provider. Returns count. */
  reassignQueuedIssues(provider: ProviderId, issues: SentinelIssue[]): number {
    let count = 0
    for (const issue of issues) {
      if (issue.status !== 'assigned') continue
      if (issue.assignedProvider === 'Direct Call' || issue.assignedProvider === 'manual') continue
      this.deps.updateIssue(issue.id, { assignedProvider: provider })
      count += 1
    }
    return count
  }

  /**
   * Execute a fix for one issue. Deterministic (direct-call) issues run with zero
   * token cost; AI issues route through Cortex's resolved provider with the session
   * guard enforced. Resolution is only declared after verification.
   */
  async run(issueId: string): Promise<{ ok: boolean; message: string }> {
    const issue = this.deps.getIssue(issueId)
    if (!issue) return { ok: false, message: 'issue not found' }
    if (this.inFlight.has(issueId)) return { ok: false, message: 'already running' }

    const role = AGENT_ROLE_BY_LABEL[issue.assignedAgent] ?? 'cli-build'
    const provider = this.deps.cortex.resolveProviderForAgent(role)

    if (provider === 'manual') {
      this.deps.updateIssue(issueId, { status: 'waiting-approval' })
      return { ok: false, message: 'routed to manual queue' }
    }

    this.inFlight.add(issueId)
    this.deps.updateIssue(issueId, { status: 'fixing', attempts: issue.attempts + 1 })
    this.deps.audit({ subsystem: 'executor', action: 'start', outcome: 'info', message: `Running ${role} via ${provider}`, issueId })

    try {
      if (provider === 'direct') {
        return this.finishVerify(issue, () => this.runDirect(role))
      }
      if (provider === 'claude-code') {
        const cfg = this.deps.getConfig()
        if (cfg.providers.claudeCode.sessionGuardEnabled) {
          const guard = canInvokeClaude(cfg.providers.claudeCode.sessionGuardThresholdPct)
          if (!guard.ok) {
            this.deps.updateIssue(issueId, { status: 'waiting-approval', resolution: guard.reason })
            this.deps.notifyAlert('warning', 'Session guard blocked fix', guard.reason)
            return { ok: false, message: guard.reason }
          }
        }
      }
      return this.finishVerify(issue, () => this.runProvider(issue, role, provider))
    } finally {
      this.inFlight.delete(issueId)
    }
  }

  private finishVerify(issue: SentinelIssue, action: () => boolean): { ok: boolean; message: string } {
    const ran = action()
    if (!ran) {
      this.deps.updateIssue(issue.id, { status: 'failed', resolution: 'Execution failed (see task log).' })
      return { ok: false, message: 'execution failed' }
    }
    const resolved = verifyResolved(issue.id, issue.source, (s) => this.deps.rescan(s))
    if (resolved) {
      this.deps.updateIssue(issue.id, { status: 'resolved', resolution: 'Signal cleared after fix.' })
      this.deps.audit({ subsystem: 'executor', action: 'resolved', outcome: 'success', message: 'Verified resolved', issueId: issue.id })
      this.deps.notifyActivity('Issue resolved', `${issue.diagnosis}`)
      return { ok: true, message: 'resolved' }
    }
    this.deps.updateIssue(issue.id, { status: 'failed', resolution: 'Signal still active after fix.' })
    this.deps.audit({ subsystem: 'executor', action: 'verify-failed', outcome: 'failed', message: 'Signal still active', issueId: issue.id })
    return { ok: false, message: 'not resolved' }
  }

  /** Deterministic agents (Diagnostics/Session/Notion) — call DevTools modules directly. */
  private runDirect(role: SentinelAgentRole): boolean {
    if (role === 'diagnostics') {
      const r = spawnSync('pnpm', ['tool', 'diagnose', '--quick'], { cwd: toolsRoot, encoding: 'utf8', shell: true, windowsHide: true })
      return r.status === 0 || r.status === 1 // diagnose exits 1 on criticals but still ran
    }
    // session / notion direct calls: no destructive action — report-only here.
    return true
  }

  private runProvider(issue: SentinelIssue, role: SentinelAgentRole, provider: Exclude<ProviderId, 'manual'>): boolean {
    const cfg = this.deps.getConfig()
    const file = writeTaskFile(issue, AGENT_PERMISSIONS[role])
    const logPath = taskLogPath(issue.id)
    let result
    if (provider === 'claude-code') {
      result = spawnSync(cfg.providers.claudeCode.command, ['--print', '--task-file', file], { encoding: 'utf8', shell: true, timeout: 10 * 60 * 1000, windowsHide: true })
    } else if (provider === 'codex') {
      result = spawnSync(cfg.providers.codex.command, ['--task-file', file], { encoding: 'utf8', shell: true, timeout: 10 * 60 * 1000, windowsHide: true })
    } else {
      // local-model: best-effort POST of the task file content.
      const r = spawnSync('node', ['-e', localPostScript(cfg.providers.localModel.endpoint, cfg.providers.localModel.model, file)], { encoding: 'utf8', shell: true, timeout: 10 * 60 * 1000, windowsHide: true })
      result = r
    }
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
    fs.writeFileSync(logPath, output || `Provider ${provider} produced no output (status ${result.status}).\n`)
    return result.status === 0
  }
}

function localPostScript(endpoint: string, model: string, taskFile: string) {
  // Minimal inline script so we don't add an HTTP-client dependency to the daemon.
  return `const fs=require('fs');const body=JSON.stringify({model:${JSON.stringify(model)},prompt:fs.readFileSync(${JSON.stringify(taskFile)},'utf8'),stream:false});fetch(${JSON.stringify(endpoint)}+'/api/generate',{method:'POST',headers:{'content-type':'application/json'},body}).then(r=>r.text()).then(t=>{process.stdout.write(t);process.exit(0)}).catch(e=>{process.stderr.write(String(e));process.exit(1)})`
}
