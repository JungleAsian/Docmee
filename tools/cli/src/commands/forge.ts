import { Command } from 'commander'
import { log } from '../lib/logger.js'
import { readJson } from '../lib/json-store.js'
import { ForgeScanner } from '../../../sentinel/forge/index.js'
import type { SubsystemDeps } from '../../../sentinel/lib/deps.js'
import { DEFAULT_CONFIG } from '../../../sentinel/config/schema.js'

type Issue = { id: string; source: string; severity: string; status: string; diagnosis: string; category: string; updatedAt: string }
type Audit = { ts: string; subsystem: string; action: string; outcome: string; message: string }

const noop = () => undefined
const cliDeps: SubsystemDeps = {
  getConfig: () => DEFAULT_CONFIG,
  writeIssues: noop,
  notifyAlert: noop,
  notifyActivity: noop,
  push: noop,
  recomputeTray: noop,
  reportAlive: noop
}

function issues() {
  return readJson<Issue[]>('sentinel-issues.json', []).filter((i) => i.source === 'forge')
}

export const forgeCmd = new Command('forge').description('Forge — Sentinel build-time intelligence')

forgeCmd.command('status').description('Current build state and active Forge issues').action(() => {
  const active = issues().filter((i) => !['resolved', 'ignored'].includes(i.status))
  const hb = readJson<{ timestamp?: string; status?: string; uptimeSeconds?: number }>('forge-heartbeat.json', {})
  log('forge', `Forge ${hb.status ?? 'unknown'} — uptime ${hb.uptimeSeconds ?? 0}s, last heartbeat ${hb.timestamp ?? 'never'}`)
  log('forge', `Active Forge issues: ${active.length} (${active.filter((i) => i.severity === 'critical').length} critical, ${active.filter((i) => i.severity === 'warning').length} warning)`)
})

forgeCmd.command('scan').description('Run a manual scan of all Forge signals').action(() => {
  const scanner = new ForgeScanner(cliDeps)
  const drafts = scanner.scanOnce()
  log('forge', `Forge scan complete — ${drafts.length} active issue${drafts.length === 1 ? '' : 's'} written to sentinel-issues.json`)
})

forgeCmd.command('issues').description('List active Forge issues').action(() => {
  const active = issues().filter((i) => !['resolved', 'ignored'].includes(i.status))
  if (active.length === 0) return log('forge', 'No active Forge issues.')
  for (const i of active) log('forge', `[${i.severity}] ${i.category} — ${i.diagnosis}`)
})

forgeCmd.command('audit').description('Last 20 Forge audit entries').action(() => {
  const audit = readJson<Audit[]>('sentinel-audit.json', []).filter((a) => a.subsystem === 'forge' || a.subsystem === 'executor')
  for (const entry of audit.slice(0, 20)) log('forge', `${entry.ts} ${entry.action} (${entry.outcome}) — ${entry.message}`)
  if (audit.length === 0) log('forge', 'No Forge audit entries yet.')
})
