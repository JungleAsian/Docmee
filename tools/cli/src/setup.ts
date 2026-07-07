import { setupCmd } from './commands/setup.js'

setupCmd.parseAsync(['node', 'setup']).catch((error: unknown) => {
  console.error(`Setup error: ${String(error)}`)
  process.exitCode = 0
})
