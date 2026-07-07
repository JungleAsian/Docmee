import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { ProgressEmitter } from './progress-emitter.js'
import { preflight } from './steps/preflight.js'
import { downloadLatest } from './steps/download.js'
import { installDependencies } from './steps/install-deps.js'
import { buildWorkspace, installWorkspace, startServices } from './steps/start.js'
import { verifyHealth } from './steps/verify.js'
import { emptyConfig, missingRequiredKeys, writeEnvFile, type InstallerConfig } from './steps/configure.js'

export type InstallerStep =
  | 'welcome'
  | 'system-check'
  | 'configuration'
  | 'downloading'
  | 'installing'
  | 'configuring'
  | 'starting'
  | 'verifying'
  | 'complete'
  | 'error'

export interface InstallerState {
  step: InstallerStep
  progress: number // 0–100
  message: string
  error?: string
  config: InstallerConfig
}

export interface InstallerOptions {
  repo?: string
  installDir?: string
  dashboardUrl?: string
  config?: Partial<InstallerConfig>
  openBrowser?: boolean
}

const DEFAULT_REPO = process.env['GITHUB_REPO'] ?? 'docmee/docmee'
const DEFAULT_DASHBOARD = 'http://localhost:3000'

function defaultInstallDir(): string {
  return path.join(os.homedir(), 'Docmee')
}

/** Open the dashboard in the operator's default browser (best effort). */
export function openDashboard(url: string): void {
  const command =
    process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(command, args, { stdio: 'ignore', detached: true, shell: false })
  child.on('error', () => {
    /* a failed browser launch must not fail the install */
  })
  child.unref()
}

/**
 * End-to-end installer orchestration. Drives the seven install steps, pushing a
 * fresh {@link InstallerState} to `onProgress` after every meaningful change so
 * the Tauri UI can render a live progress bar. Throws are caught and surfaced as
 * an `error` step rather than rejecting, so the UI always sees a final state.
 */
export async function runInstaller(
  onProgress: (state: InstallerState) => void,
  options: InstallerOptions = {},
): Promise<void> {
  const repo = options.repo ?? DEFAULT_REPO
  const installDir = options.installDir ?? defaultInstallDir()
  const dashboardUrl = options.dashboardUrl ?? DEFAULT_DASHBOARD
  const config: InstallerConfig = { ...emptyConfig(), ...options.config }

  const state: InstallerState = { step: 'welcome', progress: 0, message: 'Ready to install Docmee', config }
  const emit = (next: Partial<InstallerState>): void => {
    Object.assign(state, next)
    onProgress({ ...state, config: { ...state.config } })
  }

  const emitter = new ProgressEmitter()
  emitter.on('progress', (_step, percent, message) => emit({ progress: percent, message }))

  try {
    // 1. Preflight — Node 20+, disk space, internet
    emit({ step: 'system-check', progress: 5, message: 'Checking system requirements…' })
    const checks = await preflight(installDir)
    if (!checks.ok) {
      const failed = checks.checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`)
      throw new Error(`System check failed — ${failed.join('; ')}`)
    }

    // 2. Configuration — ensure the operator supplied the required secrets
    emit({ step: 'configuration', progress: 10, message: 'Validating configuration…' })
    const missing = missingRequiredKeys(config)
    if (missing.length > 0) throw new Error(`Missing required configuration: ${missing.join(', ')}`)

    // 3. Download — latest release from GitHub
    emit({ step: 'downloading', progress: 15, message: `Downloading latest release from ${repo}…` })
    const { release } = await downloadLatest(repo, installDir, (percent) =>
      emitter.progress('downloading', 15 + Math.round(percent * 0.25), `Downloading release… ${percent}%`),
    )
    emit({ progress: 40, message: `Downloaded ${release.version}` })

    // 4. Install deps — Node, Redis, PM2 + workspace install/build
    emit({ step: 'installing', progress: 45, message: 'Installing dependencies…' })
    const deps = await installDependencies((name, message) => emitter.progress('installing', 50, `${name}: ${message}`))
    const failedDep = deps.find((dep) => !dep.present && dep.name !== 'Redis')
    if (failedDep) throw new Error(`Dependency install failed — ${failedDep.name}: ${failedDep.detail}`)

    emit({ progress: 60, message: 'Installing workspace packages…' })
    const installed = await installWorkspace(installDir)
    if (!installed.ok) throw new Error(`pnpm install failed: ${installed.detail}`)

    emit({ progress: 70, message: 'Building Docmee services…' })
    const built = await buildWorkspace(installDir)
    if (!built.ok) throw new Error(`Build failed: ${built.detail}`)

    // 5. Configure — write the .env file
    emit({ step: 'configuring', progress: 78, message: 'Writing configuration…' })
    const envPath = await writeEnvFile(installDir, config)
    emit({ message: `Wrote ${envPath}` })

    // 6. Start — boot the four services under PM2
    emit({ step: 'starting', progress: 85, message: 'Starting Docmee services…' })
    const started = await startServices(installDir)
    if (!started.ok) throw new Error(`Could not start services: ${started.detail}`)

    // 7. Verify — wait for the API to report healthy
    emit({ step: 'verifying', progress: 92, message: 'Waiting for services to come online…' })
    const healthy = await verifyHealth(dashboardUrl)
    if (!healthy) throw new Error('Services started but the health check never returned 200')

    emit({ step: 'complete', progress: 100, message: 'Docmee is installed and running' })
    if (options.openBrowser !== false) openDashboard(dashboardUrl)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emitter.error(error instanceof Error ? error : new Error(message))
    emit({ step: 'error', message: 'Installation failed', error: message })
  }
}
