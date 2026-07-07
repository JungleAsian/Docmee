import { Command } from 'commander'
import { envStatus } from '../lib/config.js'
import { log } from '../lib/logger.js'

export const envCmd = new Command('env')
  .description('Check environment configuration')
  .command('check')
  .option('--app', 'Check application env contract')
  .action((opts: { app?: boolean }) => {
    const status = envStatus()
    const missing = status.required.filter((item) => !item.present)
    console.table([...status.required, ...status.optional].map((item) => ({
      name: item.name,
      required: status.required.some((required) => required.name === item.name),
      status: item.present ? 'present' : 'missing'
    })))
    if (opts.app) log('env', 'Application env check is a contract check only; /apps is not touched.', 'warn')
    if (missing.length > 0) {
      log('env', `Missing required vars: ${missing.map((item) => item.name).join(', ')}`, 'error')
      process.exitCode = 1
    } else {
      log('env', 'All required env vars are present')
    }
  })
  .parent!
