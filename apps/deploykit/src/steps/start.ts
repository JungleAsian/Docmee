import { spawn } from 'node:child_process'

export interface CommandOutcome {
  ok: boolean
  detail: string
}

function runInDir(command: string, args: string[], cwd: string): Promise<CommandOutcome> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: string[] = []
    child.stdout?.on('data', (chunk) => chunks.push(String(chunk)))
    child.stderr?.on('data', (chunk) => chunks.push(String(chunk)))
    child.on('error', (error) => resolve({ ok: false, detail: error.message }))
    child.on('close', (code) => resolve({ ok: code === 0, detail: chunks.join('').trim() || (code === 0 ? 'ok' : `exit ${code}`) }))
  })
}

/** Install workspace dependencies against the committed lockfile. */
export function installWorkspace(installDir: string): Promise<CommandOutcome> {
  return runInDir('pnpm', ['install', '--frozen-lockfile'], installDir)
}

/** Compile every workspace package so PM2 has `dist/` entry points to run. */
export function buildWorkspace(installDir: string): Promise<CommandOutcome> {
  return runInDir('pnpm', ['build'], installDir)
}

/**
 * Boot the four Docmee services (api, workers, inboxos, licensekit) via the
 * committed PM2 ecosystem file.
 */
export function startServices(installDir: string): Promise<CommandOutcome> {
  return runInDir('pm2', ['start', 'tools/deploy/ecosystem.config.cjs'], installDir)
}
