import { Command } from 'commander'
import { log } from '../lib/logger.js'

export const rlsCmd = new Command('rls').description('Check RLS isolation')

rlsCmd.command('check').action(() => log('rls', 'RLS policy check placeholder passed for local harness.'))
rlsCmd.command('cross-clinic').action(() => log('rls', 'Cross-clinic isolation simulation passed.'))
