import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

function commandWorks(command: string) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', shell: false, stdio: 'pipe', windowsHide: true })
  return result.status === 0
}

export function claudeCodeCommand() {
  if (process.env.CLAUDE_CODE_PATH && fs.existsSync(process.env.CLAUDE_CODE_PATH)) return process.env.CLAUDE_CODE_PATH
  if (commandWorks('claude')) return 'claude'

  if (process.platform !== 'win32') return 'claude'

  const packageRoot = path.join(os.homedir(), 'AppData', 'Local', 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude', 'claude-code')
  if (!fs.existsSync(packageRoot)) return 'claude'

  const versions = fs.readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))

  for (const version of versions) {
    const executable = path.join(packageRoot, version, 'claude.exe')
    if (fs.existsSync(executable)) return executable
  }

  return 'claude'
}

export function claudeCodeEnvironment() {
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  return env
}
