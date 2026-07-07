import { spawn } from 'node:child_process'

export interface DependencyStatus {
  name: string
  present: boolean
  version?: string
  installed: boolean
  detail: string
}

interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
}

function execCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    const out: string[] = []
    const err: string[] = []
    child.stdout?.on('data', (chunk) => out.push(String(chunk)))
    child.stderr?.on('data', (chunk) => err.push(String(chunk)))
    child.on('error', (error) => resolve({ code: 1, stdout: '', stderr: error.message }))
    child.on('close', (code) => resolve({ code, stdout: out.join('').trim(), stderr: err.join('').trim() }))
  })
}

async function probeVersion(command: string, args: string[]): Promise<string | null> {
  const result = await execCommand(command, args)
  if (result.code !== 0) return null
  return result.stdout.split(/\r?\n/)[0]?.trim() || 'installed'
}

/**
 * Ensure Node, Redis and PM2 are available. Node is required up front (the
 * installer itself runs on it), so it is only reported. Redis and PM2 are
 * installed via npm/winget-style commands when missing. Every action is
 * reported through `onProgress` for the Installing screen.
 */
export async function installDependencies(
  onProgress: (name: string, message: string) => void,
): Promise<DependencyStatus[]> {
  const statuses: DependencyStatus[] = []

  const nodeVersion = await probeVersion('node', ['--version'])
  statuses.push({
    name: 'Node.js',
    present: nodeVersion !== null,
    version: nodeVersion ?? undefined,
    installed: false,
    detail: nodeVersion ? `Found ${nodeVersion}` : 'Node.js is required and must be installed manually',
  })

  statuses.push(await ensurePm2(onProgress))
  statuses.push(await ensureRedis(onProgress))

  return statuses
}

async function ensurePm2(onProgress: (name: string, message: string) => void): Promise<DependencyStatus> {
  const existing = await probeVersion('pm2', ['--version'])
  if (existing) {
    onProgress('PM2', `PM2 ${existing} already installed`)
    return { name: 'PM2', present: true, version: existing, installed: false, detail: `Found ${existing}` }
  }
  onProgress('PM2', 'Installing PM2 globally via npm…')
  const result = await execCommand('npm', ['install', '-g', 'pm2'])
  if (result.code === 0) {
    const version = await probeVersion('pm2', ['--version'])
    return { name: 'PM2', present: true, version: version ?? undefined, installed: true, detail: 'Installed via npm' }
  }
  return { name: 'PM2', present: false, installed: false, detail: `npm install -g pm2 failed: ${result.stderr || 'unknown error'}` }
}

async function ensureRedis(onProgress: (name: string, message: string) => void): Promise<DependencyStatus> {
  const existing = await probeVersion('redis-server', ['--version'])
  if (existing) {
    onProgress('Redis', 'Redis already installed')
    return { name: 'Redis', present: true, version: existing, installed: false, detail: `Found ${existing}` }
  }
  onProgress('Redis', 'Installing Redis…')
  const command = redisInstallCommand()
  if (!command) {
    return {
      name: 'Redis',
      present: false,
      installed: false,
      detail: 'Install Redis manually, or point REDIS_URL at a managed instance',
    }
  }
  const result = await execCommand(command.command, command.args)
  if (result.code === 0) {
    const version = await probeVersion('redis-server', ['--version'])
    return { name: 'Redis', present: version !== null, version: version ?? undefined, installed: true, detail: 'Installed via package manager' }
  }
  return { name: 'Redis', present: false, installed: false, detail: `Redis install failed: ${result.stderr || 'unknown error'}` }
}

function redisInstallCommand(): { command: string; args: string[] } | null {
  switch (process.platform) {
    case 'darwin':
      return { command: 'brew', args: ['install', 'redis'] }
    case 'win32':
      return { command: 'winget', args: ['install', '--silent', '--accept-package-agreements', 'Redis.Redis'] }
    case 'linux':
      return { command: 'sudo', args: ['apt-get', 'install', '-y', 'redis-server'] }
    default:
      return null
  }
}
