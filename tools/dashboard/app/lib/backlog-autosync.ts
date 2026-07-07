import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// Throttled, non-blocking backlog auto-collection. `backlog sync` is idempotent
// (scan dedups by key; staleness guard only closes), so running it on a timer is
// safe. Keeps the board current without manual upkeep.
const toolsRoot = path.resolve(process.cwd(), '..')
const stampFile = path.join(toolsRoot, 'logs', 'backlog-autosync.json')
const INTERVAL_MS = 5 * 60 * 1000

function pnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

export function lastBacklogSyncAt(): number {
  try {
    return Number(JSON.parse(fs.readFileSync(stampFile, 'utf8')).at) || 0
  } catch {
    return 0
  }
}

export function maybeAutoSyncBacklog() {
  try {
    const now = Date.now()
    if (now - lastBacklogSyncAt() < INTERVAL_MS) return
    fs.mkdirSync(path.dirname(stampFile), { recursive: true })
    fs.writeFileSync(stampFile, JSON.stringify({ at: now }))
    const child = spawn(pnpmCommand(), ['tool', 'backlog', 'sync'], {
      cwd: toolsRoot,
      stdio: 'ignore',
      detached: true,
      windowsHide: true
    })
    child.unref()
  } catch {
    // Never let auto-sync break a page render.
  }
}
