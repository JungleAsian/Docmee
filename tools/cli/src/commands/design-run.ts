import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { Command } from 'commander'
import { claudeCodeCommand, claudeCodeEnvironment } from '../lib/claude-code.js'
import { log } from '../lib/logger.js'
import { logsDir, promptsDir, toolsRoot } from '../lib/paths.js'

// Single-shot Claude Code run for one prepared design prompt. Unlike
// ui-development/design-audit (which loop a queue), this runs exactly one Claude
// session and exits, so it can't get into a re-run loop. The dashboard writes the
// prompt to CLAUDE-DESIGN-RUN.md, then spawns `pnpm tool design-run`.
const designRunFile = path.join(logsDir, 'design-run.json')
const uiRunFile = path.join(logsDir, 'ui-run.json')
const designPromptFile = path.join(promptsDir, 'CLAUDE-DESIGN-RUN.md')

function repoRoot() {
  return path.resolve(toolsRoot, '..')
}

function touch(partial: Record<string, unknown>) {
  let current: Record<string, unknown> = {}
  try {
    current = JSON.parse(fs.readFileSync(designRunFile, 'utf8')) as Record<string, unknown>
  } catch {
    current = {}
  }
  fs.mkdirSync(logsDir, { recursive: true })
  fs.writeFileSync(designRunFile, `${JSON.stringify({
    ...current,
    ...partial,
    workflow: 'claude-design',
    heartbeatAt: new Date().toISOString()
  }, null, 2)}\n`)
}

// Mirror lifecycle to the UI heartbeat (ui-run.json) so the header "UI" chip
// shows active during mockup generation and build-to-Docmee, and so the cost
// sync attributes this Claude usage to the UI-DEVELOPMENT phase (it correlates
// requests via ui-run.json + the ui-development log marker written on start).
function touchUi(partial: Record<string, unknown>) {
  let current: Record<string, unknown> = {}
  try {
    current = JSON.parse(fs.readFileSync(uiRunFile, 'utf8')) as Record<string, unknown>
  } catch {
    current = {}
  }
  fs.mkdirSync(logsDir, { recursive: true })
  fs.writeFileSync(uiRunFile, `${JSON.stringify({
    ...current,
    ...partial,
    workflow: 'ui-development',
    phase: 'UI-DEVELOPMENT',
    heartbeatAt: new Date().toISOString()
  }, null, 2)}\n`)
}

function uiTarget() {
  let current: { uiScreenId?: number | string; uiScreen?: string } = {}
  try {
    current = JSON.parse(fs.readFileSync(designRunFile, 'utf8')) as typeof current
  } catch {
    current = {}
  }
  const id = current.uiScreenId ?? 0
  const screen = current.uiScreen ?? 'design run'
  // Format matches the cost timeline parser: "Developing UI screen <id>: <name>".
  return `Developing UI screen ${id}: ${screen}`
}

export const designRunCmd = new Command('design-run')
  .description('Run Claude Code once on the prepared design prompt (CLAUDE-DESIGN-RUN.md)')
  .action(async () => {
    if (!fs.existsSync(designPromptFile)) {
      touch({ status: 'failed', message: 'No design prompt was prepared.' })
      return
    }
    const prompt = fs.readFileSync(designPromptFile, 'utf8')
    const uiMessage = uiTarget()
    const startedAt = new Date().toISOString()
    touch({ pid: process.pid, phase: 'CLAUDE-DESIGN', status: 'running', startedAt, message: 'Claude Design run started.' })
    // Marker line picked up by the cost timeline parser (ui-development-*.log) so
    // this run's Claude usage is attributed to UI-DEVELOPMENT historically.
    log('ui-development', uiMessage)
    touchUi({ pid: process.pid, status: 'running', startedAt, message: uiMessage })

    const code = await new Promise<number>((resolve) => {
      let output = ''
      const child = spawn(claudeCodeCommand(), ['--print', '--dangerously-skip-permissions', '--add-dir', repoRoot()], {
        cwd: repoRoot(),
        env: claudeCodeEnvironment(),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
      const heartbeat = setInterval(() => {
        touch({ pid: child.pid, status: 'running', message: 'Claude Design run in progress.' })
        touchUi({ pid: process.pid, status: 'running', message: uiMessage })
      }, 10000)
      child.stdout.on('data', (chunk) => { output += String(chunk); log('design-run', String(chunk).trim()) })
      child.stderr.on('data', (chunk) => { output += String(chunk); log('design-run', String(chunk).trim(), 'warn') })
      child.on('close', (exit) => {
        clearInterval(heartbeat)
        touch({
          pid: child.pid,
          status: exit === 0 ? 'complete' : 'failed',
          message: exit === 0
            ? `Claude Design run finished. ${output ? 'Review the changes.' : 'No output recorded.'}`
            : `Claude Design run failed with exit code ${exit}.`
        })
        touchUi({
          pid: process.pid,
          status: exit === 0 ? 'complete' : 'failed',
          message: exit === 0
            ? 'UI development run finished — review the screen.'
            : `UI development run failed with exit code ${exit}.`
        })
        resolve(exit ?? 1)
      })
      child.stdin.end(prompt)
    })
    if (code !== 0) process.exitCode = code
  })
