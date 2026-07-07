import { Command } from 'commander'
import { log } from '../lib/logger.js'

export const migrateCmd = new Command('migrate')
  .description('Migration helper')

migrateCmd.command('run').action(() => log('migrate', 'Migration run requested; connect TOOLS_DB_URL before applying real migrations.'))
migrateCmd.command('status').action(() => log('migrate', 'No migration runner is connected yet.'))
migrateCmd.command('rollback').action(() => log('migrate', 'Rollback requested; no migration runner is connected yet.', 'warn'))
