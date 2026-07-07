import fs from 'node:fs'
import path from 'node:path'
import { logsDir } from './paths.js'

// Per-run token/cost metering for backlog AI runs, so model-tiering savings are
// measurable instead of assumed. Cost is the provider's API-equivalent estimate
// (notional on a Claude Max subscription) — the token counts are the real signal.
export type UsagePhase = 'plan' | 'verify' | 'implement'

export type UsageRecord = {
  ts: string
  phase: UsagePhase
  model?: string
  taskId?: number
  costUSD?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
}

const file = path.join(logsDir, 'backlog-usage.json')
const MAX = 2000

export function readUsage(): UsageRecord[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as UsageRecord[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function logUsage(record: Omit<UsageRecord, 'ts'>): void {
  let list = readUsage()
  list.push({ ts: new Date().toISOString(), ...record })
  if (list.length > MAX) list = list.slice(list.length - MAX)
  try {
    fs.mkdirSync(logsDir, { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`)
  } catch {
    // best-effort telemetry
  }
}
