import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// Automatic, workflow-agnostic cost sync. Both `cost dev sync-claude` and
// `cost dev sync-codex` are incremental (add-only), so running them on a timer
// is safe and idempotent — they only pick up usage not yet accounted. This keeps
// Development Cost current without anyone clicking "Sync" or running a CLI.
const toolsRoot = path.resolve(process.cwd(), '..')
const stampFile = path.join(toolsRoot, 'logs', 'cost-autosync.json')
const INTERVAL_MS = 5 * 60 * 1000

function pnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

export function lastAutoSyncAt(): number {
  try {
    return Number(JSON.parse(fs.readFileSync(stampFile, 'utf8')).at) || 0
  } catch {
    return 0
  }
}

// Fire-and-forget: if the last auto-sync was more than INTERVAL_MS ago, spawn the
// two incremental syncs detached (non-blocking) and stamp the time. The stamp is
// written before spawning so concurrent page loads don't double-trigger.
export function maybeAutoSyncCost() {
  try {
    const now = Date.now()
    if (now - lastAutoSyncAt() < INTERVAL_MS) return
    fs.mkdirSync(path.dirname(stampFile), { recursive: true })
    fs.writeFileSync(stampFile, JSON.stringify({ at: now }))
    for (const args of [['cost', 'dev', 'sync-claude'], ['cost', 'dev', 'sync-codex']]) {
      const child = spawn(pnpmCommand(), ['tool', ...args], {
        cwd: toolsRoot,
        stdio: 'ignore',
        detached: true,
        windowsHide: true
      })
      child.unref()
    }
  } catch {
    // Never let cost auto-sync break a page render.
  }
}
