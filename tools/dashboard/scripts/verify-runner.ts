import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

// One-click "Full Verification" orchestrator: runs Readiness -> Six Gates ->
// Pre-deployment sequentially and writes an aggregated verify-run.json that the
// Workflow page polls. Each stage runs as a child process so the event loop stays
// free for the heartbeat interval (the pre-deployment stage can take minutes).
const toolsRoot = path.resolve(process.cwd(), '..')
const repoRoot = path.resolve(toolsRoot, '..')
const dashboardRoot = path.join(toolsRoot, 'dashboard')
const logsRoot = path.join(toolsRoot, 'logs')
const stateFile = path.join(logsRoot, 'verify-run.json')

type StageStatus = 'pending' | 'running' | 'pass' | 'fail' | 'warning'
type Stage = { key: string; label: string; status: StageStatus; message?: string }

const stages: Stage[] = [
  { key: 'ready', label: 'Readiness', status: 'pending' },
  { key: 'gates', label: 'Six Gates', status: 'pending' },
  { key: 'predeploy', label: 'Pre-deployment', status: 'pending' }
]
const startedAt = new Date().toISOString()
let currentStage: string | null = null

function readJson<T>(file: string, fallback: T): T {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback
  } catch {
    return fallback
  }
}

function percent() {
  const done = stages.filter((s) => s.status === 'pass' || s.status === 'fail' || s.status === 'warning').length
  return Math.round((done / stages.length) * 100)
}

function overall(): 'pass' | 'fail' | null {
  if (stages.some((s) => s.status === 'fail')) return 'fail'
  if (stages.every((s) => s.status === 'pass' || s.status === 'warning')) return 'pass'
  return null
}

function writeState(status: 'running' | 'complete' | 'failed', extra: Record<string, unknown> = {}) {
  mkdirSync(logsRoot, { recursive: true })
  writeFileSync(stateFile, `${JSON.stringify({
    pid: process.pid,
    status,
    currentStage,
    percent: percent(),
    overall: overall(),
    startedAt,
    heartbeatAt: new Date().toISOString(),
    stages,
    ...extra
  }, null, 2)}\n`)
}

function setStage(key: string, status: StageStatus, message?: string) {
  const stage = stages.find((s) => s.key === key)
  if (stage) {
    stage.status = status
    if (message) stage.message = message
  }
}

function pnpmCommand() {
  if (process.platform !== 'win32') return 'pnpm'
  const pnpmExe = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'pnpm', 'pnpm.exe') : ''
  return pnpmExe && existsSync(pnpmExe) ? pnpmExe : 'pnpm.exe'
}

function run(command: string, args: string[], cwd: string, timeoutMs: number): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, LLM_STUB: process.env.LLM_STUB || 'true' }
    })
    const timer = setTimeout(() => { try { child.kill() } catch { /* already gone */ } }, timeoutMs)
    child.on('close', (code) => { clearTimeout(timer); resolve(code ?? 1) })
    child.on('error', () => { clearTimeout(timer); resolve(1) })
  })
}

async function main() {
  const beat = setInterval(() => { if (currentStage) writeState('running') }, 10000)

  // Stage 1 - Readiness
  currentStage = 'ready'
  setStage('ready', 'running')
  writeState('running')
  const readyCode = await run(pnpmCommand(), ['tool', 'ready'], repoRoot, 180000)
  const ready = readJson<{ summary?: { critical?: number } }>(path.join(logsRoot, 'ready.json'), {})
  const readyCritical = ready.summary?.critical ?? (readyCode === 0 ? 0 : 1)
  setStage('ready', readyCritical > 0 ? 'fail' : 'pass', readyCritical > 0 ? `${readyCritical} critical setup issue(s)` : 'Environment is ready')
  writeState('running')

  // Stage 2 - Six Gates
  currentStage = 'gates'
  setStage('gates', 'running')
  writeState('running')
  const gatesCode = await run(pnpmCommand(), ['tool', 'gates', 'check'], repoRoot, 240000)
  const gatesStore = readJson<{ ok?: boolean }>(path.join(logsRoot, 'six-gates.json'), {})
  const gatesOk = gatesStore.ok ?? gatesCode === 0
  setStage('gates', gatesOk ? 'pass' : 'fail', gatesOk ? 'All gates passed' : 'One or more gates failed')
  writeState('running')

  // Stage 3 - Pre-deployment (reuses the existing background runner script)
  currentStage = 'predeploy'
  setStage('predeploy', 'running')
  writeState('running')
  const tsxCli = path.join(toolsRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  await run(process.execPath, [tsxCli, path.join(dashboardRoot, 'scripts', 'predeployment-runner.ts')], dashboardRoot, 600000)
  const runs = readJson<Array<{ summary?: { fail?: number; warning?: number; pass?: number } }>>(path.join(logsRoot, 'predeployment.json'), [])
  const last = runs[0]
  const fail = last?.summary?.fail ?? 1
  const warn = last?.summary?.warning ?? 0
  setStage('predeploy', fail > 0 ? 'fail' : warn > 0 ? 'warning' : 'pass', fail > 0 ? `${fail} pre-deployment check(s) failed` : warn > 0 ? `${warn} warning(s) to review` : 'Pre-deployment checks passed')
  writeState('running')

  clearInterval(beat)
  currentStage = null
  writeState(overall() === 'fail' ? 'failed' : 'complete', { finishedAt: new Date().toISOString() })
}

main().catch((error) => {
  currentStage = null
  writeState('failed', { finishedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) })
  process.exitCode = 1
})
