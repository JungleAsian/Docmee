import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { Command } from 'commander'
import { claudeCodeCommand, claudeCodeEnvironment } from '../lib/claude-code.js'
import { log } from '../lib/logger.js'
import { logsDir, promptsDir, toolsRoot } from '../lib/paths.js'
import { closeDiscordClient, sendNotification } from '../../../discord/src/bot.js'

type EnhancementStatus = 'complete' | 'planned' | 'missing'
type Enhancement = {
  id: number
  phase: string
  area: string
  enhancement: string
  status: EnhancementStatus
  priority: 'critical' | 'high' | 'medium' | 'low'
  source: string
  nextStep: string
}

const enhancementsFile = path.join(logsDir, 'enhancements.json')
const featureRunFile = path.join(logsDir, 'feature-run.json')

function repoRoot() {
  return path.resolve(toolsRoot, '..')
}

function defaultEnhancements(): Enhancement[] {
  return [
    { id: 1, phase: 'Sentinel Platform', area: 'Navigation', enhancement: 'Rename current Sentinel surface to Forge and make Sentinel the parent platform', status: 'planned', priority: 'critical', source: 'Sentinel Platform restructure', nextStep: 'Add Forge page, update sidebar label, and keep current Sentinel issue scanner behavior under Forge.' },
    { id: 2, phase: 'Sentinel Platform', area: 'Runtime', enhancement: 'Add Sentinel Daemon with independent API, tray indicator, Beacon, Healer, and subsystem startup', status: 'missing', priority: 'critical', source: 'Sentinel Daemon spec', nextStep: 'Build daemon process, health API on port 4001, local config merge, PID/log files, and dashboard self-healing policy.' },
    { id: 3, phase: 'Production Guardian', area: 'VPS uptime', enhancement: 'Add Guardian production uptime monitor as a VPS systemd service', status: 'missing', priority: 'critical', source: 'Guardian Production Uptime Spec V1', nextStep: 'Create Guardian daemon, .env.guardian, heartbeat/audit/check logs, systemd unit, and Sentinel issue handoff.' },
    { id: 4, phase: 'Production Guardian', area: 'Smoke tests', enhancement: 'Add Guardian canary business logic checks for login, inbox, queue, and AI reply flow', status: 'missing', priority: 'high', source: 'Guardian Production Uptime Spec V1', nextStep: 'Create safe test clinic canary flow, cleanup routine, and escalation after repeated failures.' },
    { id: 5, phase: 'Sentinel Platform', area: 'Aegis', enhancement: 'Add Aegis product integrity monitor page and issue source', status: 'missing', priority: 'high', source: 'Sentinel Platform restructure', nextStep: 'Create /aegis dashboard shell, define log schema, and add Aegis heartbeat into Sentinel/Beacon.' },
    { id: 6, phase: 'Deployment', area: 'Public access', enhancement: 'Replace ngrok and Tailscale dependency with Cloudflare Tunnel mode', status: 'planned', priority: 'high', source: 'Cloudflare Tunnel architecture decision', nextStep: 'Add Cloudflare public URL mode, tunnel deployment guide, DevTools Access URL, and Guardian public URL sync.' },
    { id: 7, phase: 'DevTools', area: 'Agents', enhancement: 'Add Sentinel executor with direct-call agents and Claude Code agents behind permission envelopes', status: 'missing', priority: 'medium', source: 'Sentinel Agent Executor spec', nextStep: 'Add task writer, session guard, executor, verifier, audit logging, and task log polling.' },
    { id: 8, phase: 'DevTools', area: 'Deployment', enhancement: 'Add .env readiness gate before VPS .env sync and deploy', status: 'complete', priority: 'medium', source: 'DevTools enhancement', nextStep: 'Keep using Check .env Readiness on the Deploy page before VPS deployment.' }
  ]
}

function readEnhancements() {
  if (!fs.existsSync(enhancementsFile)) return defaultEnhancements()
  try {
    const custom = JSON.parse(fs.readFileSync(enhancementsFile, 'utf8')) as Enhancement[]
    const customIds = new Set(custom.map((item) => item.id))
    return [...defaultEnhancements().filter((item) => !customIds.has(item.id)), ...custom]
  } catch {
    return defaultEnhancements()
  }
}

function touchEnhancementRun(partial: Record<string, unknown>) {
  let current = {}
  if (fs.existsSync(featureRunFile)) {
    try {
      current = JSON.parse(fs.readFileSync(featureRunFile, 'utf8')) as Record<string, unknown>
    } catch {
      current = {}
    }
  }
  fs.mkdirSync(logsDir, { recursive: true })
  fs.writeFileSync(featureRunFile, `${JSON.stringify({
    ...current,
    ...partial,
    pid: partial.pid ?? process.pid,
    workflow: 'enhancements-development',
    heartbeatAt: new Date().toISOString()
  }, null, 2)}\n`)
}

function priorityRank(priority: Enhancement['priority']) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[priority]
}

function openEnhancements() {
  return readEnhancements()
    .filter((item) => item.status !== 'complete')
    .sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority) || left.id - right.id)
}

function writeEnhancementPrompt(items: Enhancement[]) {
  fs.mkdirSync(promptsDir, { recursive: true })
  const promptFile = path.join(promptsDir, 'ENHANCEMENT-DEVELOPMENT-CONTEXT.md')
  const selected = items.slice(0, 8)
  const lines = [
    '# Docmee Enhancement Development',
    '',
    'Continue Docmee enhancement development from the open enhancement queue.',
    '',
    'Rules:',
    '- Work locally first.',
    '- Keep changes focused on the listed enhancement gaps.',
    '- Do not deploy to VPS until local validation passes.',
    '- Update tools/logs/enhancements.json after each completed or materially advanced enhancement.',
    '- Mark an enhancement complete only when code and local verification support it.',
    '- Run the relevant local checks before stopping.',
    '- Commit useful completed work with a clear message.',
    '',
    `Open enhancement count: ${items.length}`,
    '',
    ...selected.flatMap((item) => [
      `## Enhancement ${item.id}: ${item.enhancement}`,
      `Phase: ${item.phase}`,
      `Area: ${item.area}`,
      `Status: ${item.status}`,
      `Priority: ${item.priority}`,
      `Source: ${item.source}`,
      `Next step: ${item.nextStep}`,
      ''
    ])
  ]
  fs.writeFileSync(promptFile, `${lines.join('\n')}\n`)
  return promptFile
}

function runClaudeEnhancement(promptFile: string, item: Enhancement) {
  return new Promise<number>((resolve) => {
    const prompt = fs.readFileSync(promptFile, 'utf8')
    let output = ''
    touchEnhancementRun({
      phase: item.phase,
      status: 'running',
      startedAt: new Date().toISOString(),
      message: `Developing enhancement ${item.id}: ${item.enhancement}`
    })
    const child = spawn(claudeCodeCommand(), ['--print', '--dangerously-skip-permissions', '--add-dir', repoRoot()], {
      cwd: repoRoot(),
      env: claudeCodeEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    const heartbeat = setInterval(() => {
      touchEnhancementRun({
        pid: child.pid,
        phase: item.phase,
        status: 'running',
        message: `Developing enhancement ${item.id}: ${item.enhancement}`
      })
    }, 10000)
    child.stdout.on('data', (chunk) => {
      const text = String(chunk)
      output += text
      log('enhancement', text.trim())
    })
    child.stderr.on('data', (chunk) => {
      const text = String(chunk)
      output += text
      log('enhancement', text.trim(), 'warn')
    })
    child.on('close', (code) => {
      clearInterval(heartbeat)
      touchEnhancementRun({
        pid: child.pid,
        phase: item.phase,
        status: code === 0 ? 'complete' : 'failed',
        message: code === 0 ? `Enhancement session finished. ${output ? 'Review output and queue status.' : 'No output recorded.'}` : `Enhancement session failed with exit code ${code}.`
      })
      resolve(code ?? 1)
    })
    child.stdin.end(prompt)
  })
}

function nextEnhancement(open: Enhancement[], attempted: Set<number>) {
  return open.find((item) => !attempted.has(item.id)) ?? open[0]
}

export const enhancementCmd = new Command('enhancement').description('Manage Docmee enhancement development')

enhancementCmd.command('watch')
  .description('Start automated Claude enhancement development from the open enhancement queue')
  .option('--max-sessions <count>', 'Maximum Claude sessions to run before stopping', '50')
  .action(async (opts: { maxSessions: string }) => {
    const attempted = new Set<number>()
    const maxSessions = Math.max(1, Number(opts.maxSessions) || 50)
    let sessionNumber = 0

    // Loop the open queue (one Claude session per item) so the watcher works the
    // whole backlog instead of re-running the first item; Claude marks items
    // complete in enhancements.json, which shrinks openEnhancements() each pass.
    while (sessionNumber < maxSessions) {
      const open = openEnhancements()
      if (open.length === 0) {
        touchEnhancementRun({ status: 'complete', message: 'All enhancements are complete' })
        await sendNotification('Enhancement automation completed. All enhancements are marked complete.', 'development')
        await closeDiscordClient()
        return
      }

      const item = nextEnhancement(open, attempted)
      const promptFile = writeEnhancementPrompt([item, ...open.filter((other) => other.id !== item.id)])
      sessionNumber += 1
      attempted.add(item.id)
      log('enhancement', `Starting enhancement session ${sessionNumber}/${maxSessions} with ${open.length} open item(s). Working on enhancement ${item.id}.`)
      await sendNotification(`Enhancement automation session ${sessionNumber} started. ${open.length} open item(s). Working on enhancement ${item.id} - ${item.enhancement}.`, 'development')

      const code = await runClaudeEnhancement(promptFile, item)
      if (code !== 0) {
        await sendNotification(`Enhancement automation failed during enhancement ${item.id} - ${item.enhancement}.`, 'critical')
        await closeDiscordClient()
        process.exitCode = code
        return
      }

      const updatedOpen = openEnhancements()
      await sendNotification(`Enhancement automation session ${sessionNumber} finished. ${updatedOpen.length} item(s) remain open.`, 'development')
      if (updatedOpen.length === 0) {
        touchEnhancementRun({ status: 'complete', message: 'All enhancements are complete' })
        await sendNotification('Enhancement automation completed. All enhancements are marked complete.', 'development')
        await closeDiscordClient()
        return
      }

      // Once every open item has had a session attempt without clearing the queue,
      // cycle through again rather than spinning on the same top item forever.
      if (updatedOpen.every((other) => attempted.has(other.id))) {
        attempted.clear()
        log('enhancement', 'All open enhancements have had a session attempt; cycling through the remaining queue again.')
      }

      touchEnhancementRun({ phase: updatedOpen[0]?.phase ?? item.phase, status: 'running', message: `Continuing enhancement queue. ${updatedOpen.length} item(s) remain open.` })
    }

    const remaining = openEnhancements()
    touchEnhancementRun({ status: remaining.length === 0 ? 'complete' : 'stopped', message: remaining.length === 0 ? 'All enhancements are complete' : `Stopped after max session limit. ${remaining.length} item(s) remain open.` })
    await sendNotification(`Enhancement automation stopped after ${maxSessions} session(s). ${remaining.length} item(s) remain open.`, remaining.length === 0 ? 'development' : 'critical')
    await closeDiscordClient()
    process.exitCode = remaining.length === 0 ? 0 : 1
  })
