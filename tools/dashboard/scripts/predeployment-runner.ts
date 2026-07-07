import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { runPredeployment } from '../app/lib/predeployment-runner'

const toolsRoot = path.resolve(process.cwd(), '..')
const logsRoot = path.join(toolsRoot, 'logs')
const runningFile = path.join(logsRoot, 'predeployment-running.json')
const stdoutFile = process.env.PREDEPLOYMENT_RUNNER_OUT ?? path.join(logsRoot, 'predeployment-runner.out.log')
const stderrFile = process.env.PREDEPLOYMENT_RUNNER_ERR ?? path.join(logsRoot, 'predeployment-runner.err.log')

function log(file: string, message: string) {
  mkdirSync(logsRoot, { recursive: true })
  writeFileSync(file, `${new Date().toISOString()} ${message}\n`, { flag: 'a' })
}

async function main() {
  mkdirSync(logsRoot, { recursive: true })
  writeFileSync(runningFile, JSON.stringify({
    pid: process.pid,
    status: 'running',
    startedAt: new Date().toISOString(),
    message: 'Predeployment check is running in the background.'
  }, null, 2))
  log(stdoutFile, 'Predeployment background run started.')
  const run = await runPredeployment()
  log(stdoutFile, `Predeployment background run completed: ${run.summary.pass} pass, ${run.summary.warning} warning, ${run.summary.fail} fail, ${run.summary.manual} manual.`)
  rmSync(runningFile, { force: true })
}

main().catch((error) => {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
  log(stderrFile, message)
  writeFileSync(runningFile, JSON.stringify({
    pid: process.pid,
    status: 'failed',
    finishedAt: new Date().toISOString(),
    message: error instanceof Error ? error.message : String(error)
  }, null, 2))
  process.exitCode = 1
})
