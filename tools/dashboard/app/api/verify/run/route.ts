import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { NextResponse } from 'next/server'

// Starts the one-click Full Verification run (Readiness -> Six Gates ->
// Pre-deployment) as a detached background process. Mirrors the pre-deployment
// runner pattern; the verify-runner script owns verify-run.json after launch.
const toolsRoot = path.resolve(process.cwd(), '..')
const dashboardRoot = path.join(toolsRoot, 'dashboard')
const logsRoot = path.join(toolsRoot, 'logs')
const stateFile = path.join(logsRoot, 'verify-run.json')

function isProcessAlive(pid?: number) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function isHeartbeatFresh(heartbeatAt?: string, maxAgeMs = 180000) {
  if (!heartbeatAt) return true
  const stamp = new Date(heartbeatAt).getTime()
  if (Number.isNaN(stamp)) return true
  return Date.now() - stamp <= maxAgeMs
}

function alreadyRunning() {
  if (!existsSync(stateFile)) return false
  try {
    const state = JSON.parse(readFileSync(stateFile, 'utf8')) as { pid?: number; status?: string; heartbeatAt?: string }
    return state.status === 'running' && isProcessAlive(state.pid) && isHeartbeatFresh(state.heartbeatAt)
  } catch {
    return false
  }
}

function startBackgroundRun() {
  mkdirSync(logsRoot, { recursive: true })
  const runner = path.join(dashboardRoot, 'scripts', 'verify-runner.ts')
  const tsxCli = path.join(toolsRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const child = spawn(process.execPath, [tsxCli, runner], {
    cwd: dashboardRoot,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env }
  })
  child.unref()
  writeFileSync(stateFile, `${JSON.stringify({
    pid: child.pid,
    status: 'running',
    currentStage: 'ready',
    percent: 0,
    overall: null,
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    stages: [
      { key: 'ready', label: 'Readiness', status: 'running' },
      { key: 'gates', label: 'Six Gates', status: 'pending' },
      { key: 'predeploy', label: 'Pre-deployment', status: 'pending' }
    ]
  }, null, 2)}\n`)
  return child.pid
}

function redirect(request: Request, key: 'message' | 'error', value: string) {
  const referer = request.headers.get('referer') ?? 'http://127.0.0.1:4000/workflow'
  const url = new URL(referer)
  url.searchParams.set(key, value)
  return NextResponse.redirect(url, 303)
}

export async function POST(request: Request) {
  if (alreadyRunning()) {
    return redirect(request, 'error', 'Full verification is already running.')
  }
  const pid = startBackgroundRun()
  return redirect(request, 'message', `Full verification started in the background${pid ? ` (${pid})` : ''} — Readiness, Six Gates, then Pre-deployment.`)
}
