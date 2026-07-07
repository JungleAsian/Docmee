import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { daemonPidFile, sentinelRoot, toolsRoot, configLocalFile } from './lib/paths.js'
import { readJsonFile } from './lib/json-store.js'
import { isProcessAlive, killPid } from './lib/proc.js'
import { loadConfig } from './config/index.js'

function pid(): number | null {
  if (!fs.existsSync(daemonPidFile)) return null
  const n = Number(fs.readFileSync(daemonPidFile, 'utf8').trim())
  return Number.isInteger(n) ? n : null
}

function token(): string {
  const local = readJsonFile<{ api?: { token?: string } }>(configLocalFile, {})
  return local.api?.token ?? ''
}

async function apiCall(method: string, route: string, body?: unknown): Promise<unknown> {
  const { config } = loadConfig()
  const url = `http://127.0.0.1:${config.api.port}${route}`
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  return res.json()
}

function startDaemon() {
  if (isProcessAlive(pid() ?? undefined)) {
    console.log('Sentinel is already running (pid ' + pid() + ').')
    return
  }
  const daemonEntry = path.join(sentinelRoot, 'daemon.ts')
  // Spawn node + the tsx CLI directly. The previous `pnpm exec tsx` variant ran
  // through a shell wrapper whose exit killed the detached child on Windows, so
  // the daemon never stayed up. node+tsx detached+unref keeps it alive.
  const tsxCli = path.join(toolsRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const child = spawn(process.execPath, [tsxCli, daemonEntry], { cwd: toolsRoot, detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  console.log('Sentinel daemon starting…')
}

function stopDaemon() {
  const p = pid()
  if (!p || !isProcessAlive(p)) {
    console.log('Sentinel is not running.')
    return
  }
  killPid(p, false)
  console.log('Sent stop signal to Sentinel (pid ' + p + ').')
}

async function status() {
  const p = pid()
  if (!p || !isProcessAlive(p)) {
    console.log('Sentinel: stopped')
    return
  }
  try {
    const data = (await apiCall('GET', '/api/status')) as Record<string, unknown>
    console.log(JSON.stringify(data, null, 2))
  } catch {
    console.log('Sentinel: running (pid ' + p + ') — API not reachable yet.')
  }
}

async function cortex(args: string[]) {
  const sub = args[0]
  if (sub === 'switch') {
    const provider = args[1]
    const result = await apiCall('POST', '/api/cortex/switch', { provider, force: args.includes('--force') })
    console.log(JSON.stringify(result, null, 2))
  } else if (sub === 'session') {
    console.log(JSON.stringify(await apiCall('GET', '/api/cortex/session'), null, 2))
  } else if (sub === 'test' || sub === 'status' || !sub) {
    console.log(JSON.stringify(await apiCall('GET', '/api/cortex'), null, 2))
  } else {
    console.log('Usage: pnpm sentinel cortex [status|switch <provider>|session|test]')
  }
}

async function main() {
  const [, , command, ...rest] = process.argv
  switch (command) {
    case 'start':
      startDaemon()
      break
    case 'stop':
      stopDaemon()
      break
    case 'restart':
      stopDaemon()
      setTimeout(startDaemon, 1500)
      break
    case 'status':
      await status()
      break
    case 'cortex':
      await cortex(rest)
      break
    default:
      console.log('Usage: pnpm sentinel <start|stop|restart|status|cortex ...>')
  }
}

void main()
