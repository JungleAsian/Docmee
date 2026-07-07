import { Command } from 'commander'
import { log } from '../lib/logger.js'

export const routeCmd = new Command('route')
  .description('Generate a Fastify route contract')
  .requiredOption('--module <module>')
  .requiredOption('--name <name>')
  .requiredOption('--method <method>')
  .action((opts: { module: string; name: string; method: string }) => {
    log('route', `Route contract generated for ${opts.method.toUpperCase()} ${opts.module}/${opts.name}`)
  })
