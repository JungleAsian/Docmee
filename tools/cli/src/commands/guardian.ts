import { Command } from 'commander'
import { log } from '../lib/logger.js'
import { readJson, writeJson } from '../lib/json-store.js'

type Heartbeat = { timestamp?: string; status?: string; uptimeSeconds?: number; checksPassingCount?: number; checksFailingCount?: number }
type CheckResult = { checkName: string; category: string; status: string; consecutiveFailures: number; lastError?: string }
type Audit = { ts: string; checkName: string; action: string; outcome: string }
type GuardianConfig = { mode?: string; recoveryRules?: Array<{ action: string; enabled: boolean }> }

export const guardianCmd = new Command('guardian').description('Guardian — Sentinel production uptime monitor (reads VPS log files)')

guardianCmd.command('status').description('Show current heartbeat and active issues').action(() => {
  const hb = readJson<Heartbeat>('guardian-heartbeat.json', {})
  if (!hb.timestamp) return log('guardian', 'Guardian heartbeat not found — Guardian may be not-configured or offline.', 'warn')
  log('guardian', `Guardian ${hb.status} — uptime ${hb.uptimeSeconds ?? 0}s, ${hb.checksPassingCount ?? 0} passing / ${hb.checksFailingCount ?? 0} failing (heartbeat ${hb.timestamp})`)
})

guardianCmd.command('checks').description('Show latest result per check').action(() => {
  const checks = readJson<CheckResult[]>('guardian-checks.json', [])
  if (checks.length === 0) return log('guardian', 'No check results recorded yet.')
  for (const c of checks) log('guardian', `[${c.status}] ${c.category}/${c.checkName}${c.lastError ? ` — ${c.lastError}` : ''}`)
})

guardianCmd.command('audit').description('Show last 20 audit entries').action(() => {
  const audit = readJson<Audit[]>('guardian-audit.json', [])
  for (const a of audit.slice(0, 20)) log('guardian', `${a.ts} ${a.action} (${a.outcome}) — ${a.checkName}`)
  if (audit.length === 0) log('guardian', 'No Guardian audit entries yet.')
})

function setMode(mode: 'active' | 'observe-only' | 'paused') {
  const cfg = readJson<GuardianConfig>('guardian-config.json', {})
  writeJson('guardian-config.json', { ...cfg, mode })
  log('guardian', `Guardian mode set to ${mode}. The daemon applies this on its next config reload.`)
}

guardianCmd.command('pause').description('Pause auto-recovery (observe-only mode)').action(() => setMode('observe-only'))
guardianCmd.command('resume').description('Resume auto-recovery').action(() => setMode('active'))

guardianCmd
  .command('reset')
  .argument('<action>', 'Recovery action to unlock (e.g. restart-api)')
  .description('Reset the escalation lock for a recovery action')
  .action((action: string) => {
    // The live lock is held in the daemon; record the reset intent for it to pick up.
    const resets = readJson<Array<{ action: string; ts: string }>>('guardian-resets.json', [])
    writeJson('guardian-resets.json', [{ action, ts: new Date().toISOString() }, ...resets].slice(0, 50))
    log('guardian', `Reset requested for ${action}. The daemon clears the lock on its next supervisor tick.`)
  })

guardianCmd.command('config').description('Show active Guardian config').action(() => {
  log('guardian', JSON.stringify(readJson<GuardianConfig>('guardian-config.json', {}), null, 2))
})
