import { Command } from 'commander'
import { log } from '../lib/logger.js'
import { readJson, writeJson } from '../lib/json-store.js'
import { AegisScanner } from '../../../sentinel/aegis/index.js'
import type { SubsystemDeps } from '../../../sentinel/lib/deps.js'
import { DEFAULT_CONFIG } from '../../../sentinel/config/schema.js'

type Heartbeat = { timestamp?: string; status?: string; uptimeSeconds?: number; checksPassingCount?: number; checksFailingCount?: number }
type CheckResult = { checkName: string; category: string; status: string; metric?: number; note: string }
type Issue = { id: string; source: string; severity: string; status: string; diagnosis: string; clinicId?: string }
type AegisConfig = { mode?: string }

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

export const aegisCmd = new Command('aegis').description('Aegis — Sentinel product integrity monitor')

aegisCmd.command('status').description('Current heartbeat and active issues').action(() => {
  const hb = readJson<Heartbeat>('aegis-heartbeat.json', {})
  if (!hb.timestamp) return log('aegis', 'Aegis heartbeat not found — Aegis may be not-configured or offline.', 'warn')
  log('aegis', `Aegis ${hb.status} — uptime ${hb.uptimeSeconds ?? 0}s, ${hb.checksPassingCount ?? 0} passing / ${hb.checksFailingCount ?? 0} failing`)
})

aegisCmd.command('checks').description('Latest result per check').action(() => {
  const checks = readJson<CheckResult[]>('aegis-checks.json', [])
  if (checks.length === 0) return log('aegis', 'No check results recorded yet.')
  for (const c of checks) log('aegis', `[${c.status}] ${c.category}/${c.checkName} — ${c.note}`)
})

aegisCmd.command('scan').description('Manual scan of all Aegis checks').action(() => {
  const drafts = new AegisScanner(cliDeps).scanOnce()
  log('aegis', `Aegis scan complete — ${drafts.length} active issue${drafts.length === 1 ? '' : 's'} (requires AEGIS_DB_URL + query runner to evaluate checks).`)
})

aegisCmd.command('audit').description('Last 20 audit entries').action(() => {
  const audit = readJson<Array<{ ts: string; checkName: string; action: string; outcome: string }>>('aegis-audit.json', [])
  for (const a of audit.slice(0, 20)) log('aegis', `${a.ts} ${a.action} (${a.outcome}) — ${a.checkName}`)
  if (audit.length === 0) log('aegis', 'No Aegis audit entries yet.')
})

function setMode(mode: 'active' | 'observe-only' | 'paused') {
  const cfg = readJson<AegisConfig>('aegis-config.json', {})
  writeJson('aegis-config.json', { ...cfg, mode })
  log('aegis', `Aegis mode set to ${mode}. The daemon applies this on its next config reload.`)
}

aegisCmd.command('pause').description('Pause auto-recovery (observe-only)').action(() => setMode('observe-only'))
aegisCmd.command('resume').description('Resume auto-recovery').action(() => setMode('active'))
aegisCmd.command('test-canary').description('Manually trigger smoke tests').action(() => {
  log('aegis', 'Canary smoke tests run inside the daemon against the aegis_test clinic. Enable canary in aegis-config.json.')
})

aegisCmd
  .command('issues')
  .option('--clinic <clinicId>', 'Filter to a specific clinic')
  .description('Active Aegis issues, optionally for a clinic')
  .action((opts: { clinic?: string }) => {
    const active = readJson<Issue[]>('sentinel-issues.json', []).filter((i) => i.source === 'aegis' && !['resolved', 'ignored'].includes(i.status) && (!opts.clinic || i.clinicId === opts.clinic))
    if (active.length === 0) return log('aegis', 'No active Aegis issues.')
    for (const i of active) log('aegis', `[${i.severity}] ${i.clinicId ?? 'platform'} — ${i.diagnosis}`)
  })

aegisCmd.command('config').description('Show active Aegis config').action(() => {
  log('aegis', JSON.stringify(readJson<AegisConfig>('aegis-config.json', {}), null, 2))
})
