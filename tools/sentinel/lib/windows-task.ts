import fs from 'node:fs'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { logFileFor, toolsRoot } from './paths.js'
import { logEvent } from './logger.js'

const REGISTERED_FLAG = logFileFor('.sentinel-task-registered')
const TASK_NAME = 'DocmeeSentinel'

/**
 * Register Sentinel with Windows Task Scheduler on first run so it restarts on
 * boot and on failure even when DevTools is fully closed. Best-effort and guarded
 * — never blocks daemon startup.
 */
export function registerWindowsTaskOnce() {
  if (process.platform !== 'win32') return
  if (fs.existsSync(REGISTERED_FLAG)) return
  try {
    const command = `cmd /c cd /d "${toolsRoot}" && pnpm sentinel:start`
    // Run at logon, restart up to 3 times on failure with a 30s delay.
    const args = ['/Create', '/F', '/TN', TASK_NAME, '/SC', 'ONLOGON', '/RL', 'LIMITED', '/TR', command]
    const out = spawnSync('schtasks', args, { encoding: 'utf8', shell: true, windowsHide: true })
    if (out.status === 0) {
      fs.writeFileSync(REGISTERED_FLAG, new Date().toISOString())
      logEvent('daemon', 'info', 'task.registered', `Registered Windows Task Scheduler entry ${TASK_NAME}`)
    } else {
      logEvent('daemon', 'warn', 'task.register-failed', 'Could not register Windows Task Scheduler entry (non-fatal).')
    }
  } catch {
    logEvent('daemon', 'warn', 'task.register-failed', 'Windows Task Scheduler registration threw (non-fatal).')
  }
}
