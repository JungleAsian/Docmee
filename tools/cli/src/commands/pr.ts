import { Command } from 'commander'
import { spawnSync } from 'node:child_process'
import { log } from '../lib/logger.js'

export const prCmd = new Command('pr').description('Run PR readiness checks')

prCmd.command('check').action(() => {
  const steps = [['typecheck'], ['lint'], ['tool', 'gates', 'check'], ['tool', 'dal', 'check']]
  for (const args of steps) {
    const result = spawnSync('pnpm', args, { stdio: 'inherit', shell: true, windowsHide: true })
    if (result.status !== 0) {
      log('pr', `Failed: pnpm ${args.join(' ')}`, 'error')
      process.exitCode = 1
      return
    }
  }
  log('pr', 'PR checks passed')
})
