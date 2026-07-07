import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import process from 'node:process'

export function isProcessAlive(pid?: number) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Cross-platform: find PID(s) listening on a TCP port. */
export function findPidsOnPort(port: number): number[] {
  if (process.platform === 'win32') {
    const out = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', shell: true, windowsHide: true })
    const pids = new Set<number>()
    for (const line of (out.stdout ?? '').split(/\r?\n/)) {
      // Proto  Local Address  Foreign Address  State  PID
      if (!/LISTENING/i.test(line)) continue
      const cols = line.trim().split(/\s+/)
      const local = cols[1] ?? ''
      if (local.endsWith(`:${port}`)) {
        const pid = Number(cols[cols.length - 1])
        if (Number.isInteger(pid) && pid > 0) pids.add(pid)
      }
    }
    return [...pids]
  }
  const out = spawnSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' })
  return (out.stdout ?? '')
    .split(/\r?\n/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
}

export function killPid(pid: number, force = false): boolean {
  try {
    if (process.platform === 'win32') {
      const args = ['/PID', String(pid), '/T']
      if (force) args.push('/F')
      const out = spawnSync('taskkill', args, { encoding: 'utf8', shell: true, windowsHide: true })
      return out.status === 0
    }
    process.kill(pid, force ? 'SIGKILL' : 'SIGTERM')
    return true
  } catch {
    return false
  }
}

export interface SpawnedProcess {
  child: ChildProcess
  pid?: number
}

/** Detached background spawn used by the launcher/healer to start DevTools. */
export function spawnDetached(command: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): SpawnedProcess {
  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    detached: true,
    stdio: 'ignore',
    shell: process.platform === 'win32',
    windowsHide: true
  })
  child.unref()
  return { child, pid: child.pid }
}
