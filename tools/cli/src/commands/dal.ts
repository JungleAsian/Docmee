import { Command } from 'commander'
import fs from 'node:fs'
import path from 'node:path'
import { toolsRoot } from '../lib/paths.js'
import { log } from '../lib/logger.js'

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

export const dalCmd = new Command('dal')
  .description('Validate data-access boundaries')
  .command('check')
  .action(() => {
    const root = path.resolve(toolsRoot, '..', 'apps', 'api', 'src')
    const violations = walk(root).filter((file) => /\.(ts|tsx)$/.test(file) && fs.readFileSync(file, 'utf8').includes('@supabase/supabase-js'))
    if (violations.length > 0) {
      violations.forEach((file) => log('dal', `Direct Supabase import: ${file}`, 'error'))
      process.exitCode = 1
    } else {
      log('dal', 'No direct Supabase imports found')
    }
  })
  .parent!
