const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

try {
  const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim()
  const source = path.join(root, 'tools', 'hooks', 'pre-commit')
  const target = path.join(root, '.git', 'hooks', 'pre-commit')
  fs.copyFileSync(source, target)
  fs.chmodSync(target, 0o755)
} catch {
  // Hook installation is best-effort for non-git environments.
}
