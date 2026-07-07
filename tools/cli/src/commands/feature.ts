import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { Command } from 'commander'
import { claudeCodeCommand, claudeCodeEnvironment } from '../lib/claude-code.js'
import { log } from '../lib/logger.js'
import { logsDir, promptsDir, toolsRoot } from '../lib/paths.js'
import { closeDiscordClient, sendNotification } from '../../../discord/src/bot.js'

type FeatureStatus = 'complete' | 'partial' | 'missing'
type StageStatus = 'complete' | 'pending' | 'needs-audit'
type FeatureMode = 'backend' | 'frontend'
type Feature = {
  id: number
  phase: string
  area: string
  feature: string
  status: FeatureStatus
  backendStatus?: StageStatus
  frontendStatus?: StageStatus
  priority: 'critical' | 'high' | 'medium' | 'low'
  evidence: string
  nextStep: string
}
type FeatureRunStatus = 'idle' | 'starting' | 'running' | 'paused' | 'stopped' | 'failed' | 'complete'
type GitHubSyncStatus = 'idle' | 'pending' | 'pushed' | 'failed' | 'skipped'
type ClaudeSessionResult = {
  code: number
  output: string
}

const coverageFile = path.join(logsDir, 'rev1-feature-coverage.json')
const featureRunFile = path.join(logsDir, 'feature-run.json')
const frontendRunFile = path.join(logsDir, 'frontend-run.json')
const claudeLimitResumeBufferMs = 2 * 60 * 1000

// Backend (features) and frontend now track independently in separate run files
// so they can run/report at the same time and never share a heartbeat.
function runFileForWorkflow(workflow?: string) {
  return workflow === 'frontend-development' ? frontendRunFile : featureRunFile
}

function repoRoot() {
  return path.resolve(toolsRoot, '..')
}

function readFeatures() {
  if (!fs.existsSync(coverageFile)) return []
  return JSON.parse(fs.readFileSync(coverageFile, 'utf8')) as Feature[]
}

function touchFeatureRun(partial: {
  pid?: number
  phase?: string
  workflow?: string
  status?: FeatureRunStatus
  githubStatus?: GitHubSyncStatus
  githubMessage?: string
  githubBranch?: string
  lastCommitHash?: string
  pushedAt?: string
  startedAt?: string
  heartbeatAt?: string
  resumeAt?: string
  message?: string
}) {
  const workflow = partial.workflow ?? 'features-development'
  const runFile = runFileForWorkflow(workflow)
  let current = {}
  if (fs.existsSync(runFile)) {
    try {
      current = JSON.parse(fs.readFileSync(runFile, 'utf8')) as Record<string, unknown>
    } catch {
      current = {}
    }
  }
  fs.mkdirSync(logsDir, { recursive: true })
  fs.writeFileSync(runFile, `${JSON.stringify({
    ...current,
    ...partial,
    pid: partial.pid ?? process.pid,
    workflow,
    heartbeatAt: new Date().toISOString()
  }, null, 2)}\n`)
}

function runGit(args: string[]) {
  const result = spawnSync('git', args, {
    cwd: repoRoot(),
    encoding: 'utf8',
    shell: false,
    stdio: 'pipe',
    windowsHide: true
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  return { ok: result.status === 0, output }
}

function gitValue(args: string[], fallback = '') {
  const result = runGit(args)
  if (!result.ok) return fallback
  return result.output.split(/\r?\n/).at(-1)?.trim() || fallback
}

function currentHead() {
  return gitValue(['rev-parse', '--short', 'HEAD'])
}

function currentBranch() {
  return gitValue(['branch', '--show-current'], 'unknown')
}

// Local-first: record the local commit but do NOT push. Pushing to the remote
// is the deploy step's job (deploy vps pushes HEAD), aligning backend/frontend
// with the UI lane's build-local-then-deploy model.
async function recordFeatureCommit(beforeHead: string, feature: Feature, mode: FeatureMode) {
  const afterHead = currentHead()
  const branch = currentBranch()
  const workflow = workflowForMode(mode)

  if (!afterHead || afterHead === beforeHead) {
    const message = 'No new commit created in this feature session.'
    touchFeatureRun({
      phase: feature.phase,
      workflow,
      githubStatus: 'skipped',
      githubMessage: message,
      githubBranch: branch,
      lastCommitHash: afterHead
    })
    return { ok: true, status: 'skipped' as GitHubSyncStatus, message, branch, commit: afterHead }
  }

  const message = `Committed locally (${afterHead} on ${branch}). Push happens at deploy.`
  touchFeatureRun({
    phase: feature.phase,
    workflow,
    githubStatus: 'skipped',
    githubMessage: message,
    githubBranch: branch,
    lastCommitHash: afterHead
  })
  return { ok: true, status: 'skipped' as GitHubSyncStatus, message, branch, commit: afterHead }
}

function priorityRank(priority: Feature['priority']) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[priority]
}

function workflowForMode(mode: FeatureMode) {
  return mode === 'frontend' ? 'frontend-development' : 'features-development'
}

function frontendStage(item: Feature): StageStatus {
  if (item.frontendStatus) return item.frontendStatus
  return item.status === 'complete' ? 'needs-audit' : 'pending'
}

function openFeatures(mode: FeatureMode = 'backend') {
  return readFeatures()
    .filter((item) => mode === 'frontend' ? frontendStage(item) !== 'complete' : item.status !== 'complete')
    .sort((left, right) => {
      return priorityRank(left.priority) - priorityRank(right.priority)
        || left.phase.localeCompare(right.phase)
        || left.id - right.id
    })
}

function nextFeature(features: Feature[], attempted: Set<number>) {
  return features.find((item) => !attempted.has(item.id)) ?? features[0]
}

function statusSnapshot(features: Feature[]) {
  return new Map(features.map((item) => [item.id, item.status]))
}

function changedFeatures(before: Map<number, FeatureStatus>, after: Feature[]) {
  return after
    .filter((item) => before.get(item.id) && before.get(item.id) !== item.status)
    .map((item) => `Req ${item.id}: ${before.get(item.id)} -> ${item.status}`)
}

function writeFeaturePrompt(features: Feature[], mode: FeatureMode) {
  fs.mkdirSync(promptsDir, { recursive: true })
  const selected = features.slice(0, 8)
  const promptFile = path.join(promptsDir, mode === 'frontend' ? 'FRONTEND-DEVELOPMENT-CONTEXT.md' : 'FEATURE-DEVELOPMENT-CONTEXT.md')
  const title = mode === 'frontend' ? 'Docmee Frontend Development' : 'Docmee Features Development'
  const summary = mode === 'frontend'
    ? 'Continue Docmee frontend development from the open frontend acceptance queue.'
    : 'Continue Docmee feature development from the open Rev 1 coverage queue.'
  const statusLine = mode === 'frontend' ? 'Frontend status' : 'Current status'
  const updateRule = mode === 'frontend'
    ? '- Update tools/logs/rev1-feature-coverage.json after each completed or materially advanced frontend item. Set frontendStatus to complete only after UI/product acceptance is supported.'
    : '- Update tools/logs/rev1-feature-coverage.json after each completed or materially advanced feature.'
  const lines = [
    `# ${title}`,
    '',
    summary,
    '',
    'Rules:',
    '- Work locally first.',
    '- Keep changes focused on the listed feature gaps.',
    '- Do not mark a feature complete unless the code and local verification support it.',
    updateRule,
    '- Run the relevant local checks before stopping.',
    '- Commit useful completed work with a clear message.',
    '- After completing one feature, stop cleanly; DevTools will automatically launch the next session for the next open feature.',
    '',
    `Open feature count: ${features.length}`,
    '',
    'Start with these highest-priority items:',
    '',
    ...selected.flatMap((item) => [
      `## Requirement ${item.id}: ${item.feature}`,
      `Phase: ${item.phase}`,
      `Area: ${item.area}`,
      `${statusLine}: ${mode === 'frontend' ? frontendStage(item) : item.status}`,
      `Priority: ${item.priority}`,
      `Evidence: ${item.evidence}`,
      `Next step: ${item.nextStep}`,
      ''
    ])
  ]
  fs.writeFileSync(promptFile, `${lines.join('\n')}\n`)
  return promptFile
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isClaudeLimitMessage(output: string) {
  return /usage limit|session limit|rate limit|resets?\s+\d/i.test(output)
}

function parseClaudeResetTime(output: string) {
  const match = output.match(/resets?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i)
  if (!match) return null
  const reset = new Date()
  let hour = Number(match[1])
  const minute = Number(match[2] ?? '0')
  const meridiem = match[3].toLowerCase()
  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  reset.setHours(hour, minute, 0, 0)
  if (reset.getTime() <= Date.now()) reset.setDate(reset.getDate() + 1)
  return reset
}

async function waitForClaudeRefresh(feature: Feature, output: string, mode: FeatureMode) {
  const workflow = workflowForMode(mode)
  const resetAt = parseClaudeResetTime(output) ?? new Date(Date.now() + 5 * 60 * 60 * 1000)
  const resumeAt = new Date(resetAt.getTime() + claudeLimitResumeBufferMs)
  const message = `${mode === 'frontend' ? 'Frontend development' : 'Feature development'} paused: Claude session limit reached. Resume at ${resumeAt.toLocaleString()}.`
  touchFeatureRun({
    phase: feature.phase,
    workflow,
    status: 'paused',
    resumeAt: resumeAt.toISOString(),
    message
  })
  await sendNotification(message, 'critical')
  while (Date.now() < resumeAt.getTime()) {
    touchFeatureRun({
      phase: feature.phase,
      workflow,
      status: 'paused',
      resumeAt: resumeAt.toISOString(),
      message
    })
    await sleep(Math.min(60_000, Math.max(1_000, resumeAt.getTime() - Date.now())))
  }
  touchFeatureRun({
    phase: feature.phase,
    workflow,
    status: 'running',
    resumeAt: undefined,
    message: 'Claude limit refreshed; resuming feature development.'
  })
  await sendNotification('Claude limit refreshed. Feature development is resuming automatically.', 'development')
}

function runClaudeFeatureDevelopment(promptFile: string, firstFeature: Feature, sessionNumber: number, mode: FeatureMode) {
  return new Promise<ClaudeSessionResult>((resolve) => {
    const prompt = fs.readFileSync(promptFile, 'utf8')
    let output = ''
    const workflow = workflowForMode(mode)
    const label = mode === 'frontend' ? 'frontend item' : 'feature'
    touchFeatureRun({
      phase: firstFeature.phase,
      workflow,
      status: 'running',
      startedAt: new Date().toISOString(),
      message: `Session ${sessionNumber}: developing ${label} ${firstFeature.id}: ${firstFeature.feature}`
    })

    const child = spawn(claudeCodeCommand(), ['--print', '--dangerously-skip-permissions', '--add-dir', repoRoot()], {
      cwd: repoRoot(),
      env: claudeCodeEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })

    const heartbeat = setInterval(() => {
      touchFeatureRun({
        pid: child.pid,
        phase: firstFeature.phase,
        workflow,
        status: 'running',
        message: `Session ${sessionNumber}: developing ${label} ${firstFeature.id}: ${firstFeature.feature}`
      })
    }, 10000)

    child.stdout.on('data', (chunk) => {
      const text = String(chunk)
      output += text
      log('feature', text.trim())
    })
    child.stderr.on('data', (chunk) => {
      const text = String(chunk)
      output += text
      log('feature', text.trim(), 'warn')
    })
    child.on('close', (code) => {
      clearInterval(heartbeat)
      touchFeatureRun({
        pid: child.pid,
        phase: firstFeature.phase,
        workflow,
        status: code === 0 ? 'running' : 'failed',
        message: code === 0
          ? `Session ${sessionNumber} finished; checking queue for next feature.`
          : `Session ${sessionNumber} failed with exit code ${code}`
      })
      resolve({ code: code ?? 1, output })
    })

    child.stdin.end(prompt)
  })
}

export const featureCmd = new Command('feature').description('Manage Docmee feature development')

featureCmd.command('watch')
  .description('Start automated Claude feature development from the open feature coverage queue')
  .option('--max-sessions <count>', 'Maximum Claude sessions to run before stopping', '50')
  .option('--mode <mode>', 'Queue mode: backend or frontend', 'backend')
  .action(async (opts: { maxSessions: string; mode: string }) => {
    const mode = opts.mode === 'frontend' ? 'frontend' : 'backend'
    const workflow = workflowForMode(mode)
    const automationLabel = mode === 'frontend' ? 'Frontend development' : 'Feature development'
    const attempted = new Set<number>()
    const maxSessions = Math.max(1, Number(opts.maxSessions) || 50)
    let sessionNumber = 0

    while (sessionNumber < maxSessions) {
      const features = openFeatures(mode)
      if (features.length === 0) {
        touchFeatureRun({ workflow, status: 'complete', message: mode === 'frontend' ? 'All frontend items are complete' : 'All features are complete' })
        log('feature', mode === 'frontend' ? 'All frontend items are complete.' : 'All features are complete.')
        await sendNotification(`${automationLabel} automation completed. ${mode === 'frontend' ? 'All frontend acceptance items are marked complete.' : 'All Rev 1 features are marked complete.'}`, 'development')
        await closeDiscordClient()
        return
      }

      const feature = nextFeature(features, attempted)
      const before = statusSnapshot(readFeatures())
      const promptFile = writeFeaturePrompt([feature, ...features.filter((item) => item.id !== feature.id)], mode)
      sessionNumber += 1
      attempted.add(feature.id)
      const headBefore = currentHead()
      log('feature', `Starting ${automationLabel.toLowerCase()} session ${sessionNumber}/${maxSessions} with ${features.length} open item(s). Prompt: ${promptFile}`)
      await sendNotification(`${automationLabel} session ${sessionNumber} started. ${features.length} open item(s). Working on Req ${feature.id} - ${feature.feature}.`, 'development')

      const result = await runClaudeFeatureDevelopment(promptFile, feature, sessionNumber, mode)
      const allAfter = readFeatures()
      const updatedOpen = openFeatures(mode)
      const changes = changedFeatures(before, allAfter)

      if (result.code !== 0) {
        if (isClaudeLimitMessage(result.output)) {
          await waitForClaudeRefresh(feature, result.output, mode)
          attempted.delete(feature.id)
          continue
        }
        await sendNotification(`${automationLabel} failed during Req ${feature.id} - ${feature.feature}. Fix the blocker, then resume.`, 'critical')
        await closeDiscordClient()
        process.exitCode = result.code
        return
      }

      const commitRecord = await recordFeatureCommit(headBefore, feature, mode)

      await sendNotification(
        `${automationLabel} session ${sessionNumber} finished. ${updatedOpen.length} item(s) remain open. ${commitRecord.message}${changes.length ? ` Changes: ${changes.join('; ')}` : ' No status change detected; moving to the next open item.'}`,
        'development'
      )

      if (updatedOpen.length === 0) {
        touchFeatureRun({ workflow, status: 'complete', message: mode === 'frontend' ? 'All frontend items are complete' : 'All features are complete' })
        await sendNotification(`${automationLabel} automation completed. ${mode === 'frontend' ? 'All frontend acceptance items are marked complete.' : 'All Rev 1 features are marked complete.'}`, 'development')
        await closeDiscordClient()
        return
      }

      if (attempted.size >= updatedOpen.length && updatedOpen.every((item) => attempted.has(item.id))) {
        attempted.clear()
        log('feature', 'All currently open features have had a session attempt; cycling through the remaining queue again.')
      }

      touchFeatureRun({
        phase: updatedOpen[0]?.phase ?? feature.phase,
        workflow,
        status: 'running',
        message: `Continuing ${mode === 'frontend' ? 'frontend' : 'feature'} queue. ${updatedOpen.length} item(s) remain open.`
      })
    }

    const remaining = openFeatures(mode)
    touchFeatureRun({
      workflow,
      status: remaining.length === 0 ? 'complete' : 'stopped',
      message: remaining.length === 0 ? (mode === 'frontend' ? 'All frontend items are complete' : 'All features are complete') : `Stopped after max session limit. ${remaining.length} item(s) remain open.`
    })
    await sendNotification(`${automationLabel} stopped after ${maxSessions} session(s). ${remaining.length} item(s) remain open.`, remaining.length === 0 ? 'development' : 'critical')
    await closeDiscordClient()
    process.exitCode = remaining.length === 0 ? 0 : 1
  })
