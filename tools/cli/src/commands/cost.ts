import { Command } from 'commander'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readJson, writeJson } from '../lib/json-store.js'
import { loadConfig } from '../lib/config.js'
import { log } from '../lib/logger.js'
import { closeDiscordClient } from '../../../discord/src/bot.js'
import { notifyCostAlert } from '../../../discord/src/notifications/cost-alert.js'
import { phaseDefinitions, type PhaseState } from '../lib/phases.js'
import { toolsRoot } from '../lib/paths.js'
import { costDisplayCurrency, formatCost, getUsdToCad } from '../lib/exchange-rate.js'

type CostEntry = { provider: string; input: number; output: number; tokens: number; minutes: number; usd: number; createdAt: string }
type DevCostEntry = {
  id: string
  timestamp: string
  phase: string
  feature: string
  tool: string
  model: string
  session_minutes: number
  input_tokens: number
  output_tokens: number
  cached_tokens: number
  cost_usd: number
  capture_method: 'auto' | 'manual' | 'estimated'
  notes: string
}
type CostStore = { runtime: CostEntry[]; development: DevCostEntry[] }
type FeatureRunState = {
  phase?: string
  workflow?: string
  status?: string
  startedAt?: string
  heartbeatAt?: string
  message?: string
}
type FeatureTimelineEntry = {
  timestamp: number
  workflow: 'features-development' | 'frontend-development' | 'ui-development'
  feature?: string
}
type ClaudeUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}
type ClaudeLogEntry = {
  cwd?: string
  requestId?: string
  uuid?: string
  timestamp?: string
  type?: string
  message?: {
    model?: string
    usage?: ClaudeUsage
  }
}

const pricing: Record<string, { input: number; output: number; cached?: number }> = {
  'claude-sonnet-4-6': { input: 3, output: 15, cached: 0.3 },
  'claude-opus-4-6': { input: 15, output: 75, cached: 1.5 },
  o3: { input: 10, output: 40 },
  'o4-mini': { input: 1.1, output: 4.4 },
  'gpt-4o': { input: 5, output: 15 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'deepseek-chat': { input: 0.27, output: 1.1 },
  'deepseek-coder': { input: 0.27, output: 1.1 },
  // Rough GPT-5/Codex-class estimate. Codex is a product plan, so per-token cost
  // is not exposed — cached context (the bulk of Codex token throughput) is
  // priced cheaply so the estimate is not dominated by re-read tokens.
  codex: { input: 1.25, output: 10, cached: 0.125 }
}

function store(): CostStore {
  const data = readJson<CostEntry[] | CostStore>('cost.json', [])
  if (Array.isArray(data)) return { runtime: data, development: [] }
  return { runtime: data.runtime ?? [], development: data.development ?? [] }
}

function saveStore(data: CostStore) {
  writeJson('cost.json', data)
}

function entries() {
  return store().runtime
}

function developmentEntries() {
  return store().development
}

function estimateCost(model: string, input: number, output: number, cached: number) {
  const rates = pricing[model] ?? pricing['o4-mini']
  return ((input * rates.input) + (output * rates.output) + (cached * (rates.cached ?? rates.input))) / 1_000_000
}

function repoRoot() {
  return path.resolve(toolsRoot, '..')
}

function normalizeFilePath(value?: string) {
  return path.resolve(value ?? '').toLowerCase()
}

function claudeProjectDirs() {
  const root = path.join(os.homedir(), '.claude', 'projects')
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
}

function claudeJsonlFiles() {
  return claudeProjectDirs().flatMap((dir) => fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => path.join(dir, entry.name)))
}

function phaseForTimestamp(timestamp?: string) {
  const when = timestamp ? Date.parse(timestamp) : Number.NaN
  const state = readJson<PhaseState[]>('phases.json', [])
  if (Number.isNaN(when)) return null
  const matched = state.find((phase) => {
    if (!phase.startedAt) return false
    const started = Date.parse(phase.startedAt)
    const completed = phase.completedAt ? Date.parse(phase.completedAt) : Date.now()
    return when >= started && when <= completed
  })
  return matched?.id ?? null
}

function phaseFeature(phaseId: string) {
  const phase = phaseDefinitions.find((item) => item.id === phaseId)
  return phase ? `${phase.id}/${phase.name}` : 'Claude Code usage sync'
}

function featureRunForTimestamp(timestamp?: string) {
  const featureRunPath = path.join(toolsRoot, 'logs', 'feature-run.json')
  const frontendRunPath = path.join(toolsRoot, 'logs', 'frontend-run.json')
  const uiRunPath = path.join(toolsRoot, 'logs', 'ui-run.json')
  let featureRun: FeatureRunState = {}
  let frontendRun: FeatureRunState = {}
  let uiRun: FeatureRunState = {}
  try {
    if (fs.existsSync(featureRunPath)) featureRun = JSON.parse(fs.readFileSync(featureRunPath, 'utf8')) as FeatureRunState
  } catch {
    featureRun = {}
  }
  try {
    if (fs.existsSync(frontendRunPath)) frontendRun = JSON.parse(fs.readFileSync(frontendRunPath, 'utf8')) as FeatureRunState
  } catch {
    frontendRun = {}
  }
  try {
    if (fs.existsSync(uiRunPath)) uiRun = JSON.parse(fs.readFileSync(uiRunPath, 'utf8')) as FeatureRunState
  } catch {
    uiRun = {}
  }
  const when = Date.parse(timestamp ?? '')
  const started = Date.parse(featureRun.startedAt ?? '')
  const frontendStarted = Date.parse(frontendRun.startedAt ?? '')
  const uiStarted = Date.parse(uiRun.startedAt ?? '')
  if (Number.isNaN(when)) return null
  if (uiRun.workflow === 'ui-development' && !Number.isNaN(uiStarted) && when >= uiStarted && /developing|ui development/i.test(uiRun.message ?? '')) {
    return {
      phase: 'UI-DEVELOPMENT',
      feature: (uiRun.message ?? 'UI Development').replace(/^Developing UI screen\s+/i, 'Screen ').trim()
    }
  }
  // Frontend now tracks in its own run file.
  if (frontendRun.workflow === 'frontend-development' && !Number.isNaN(frontendStarted) && when >= frontendStarted && /developing/i.test(frontendRun.message ?? '')) {
    return {
      phase: 'FRONTEND',
      feature: (frontendRun.message ?? 'Frontend development').replace(/^Session \d+:\s+developing frontend item\s+/i, 'Req ').trim()
    }
  }
  if (featureRun.workflow === 'features-development' && !Number.isNaN(started) && when >= started && /developing/i.test(featureRun.message ?? '')) {
    const feature = (featureRun.message ?? 'Feature development')
      .replace(/^Session \d+:\s+developing feature\s+/i, 'Req ')
      .replace(/^Developing feature\s+/i, 'Req ')
      .trim()
    return {
      phase: featureRun.phase ?? 'Features',
      feature
    }
  }
  const timeline = featureTimelineForTimestamp(when)
  if (!timeline) return null
  return {
    phase: timeline.workflow === 'ui-development' ? 'UI-DEVELOPMENT' : timeline.workflow === 'frontend-development' ? 'FRONTEND' : 'FEATURES',
    feature: timeline.feature ?? (timeline.workflow === 'ui-development' ? 'UI Development' : timeline.workflow === 'frontend-development' ? 'Frontend Development' : 'Features Development')
  }
}

function featureTimelineForTimestamp(timestamp: number) {
  const entries: FeatureTimelineEntry[] = []
  const logRoot = path.join(toolsRoot, 'logs')
  if (!fs.existsSync(logRoot)) return null
  for (const file of fs.readdirSync(logRoot).filter((name) => /^(feature|ui-development)-\d{4}-\d{2}-\d{2}\.log$/.test(name))) {
    for (const line of fs.readFileSync(path.join(logRoot, file), 'utf8').split(/\r?\n/)) {
      const uiMatch = line.match(/^\[(.*?)\].*Developing UI screen\s+(\d+)\s*:\s*(.+)$/i)
      if (uiMatch) {
        const startedAt = Date.parse(uiMatch[1])
        if (Number.isNaN(startedAt)) continue
        entries.push({
          timestamp: startedAt,
          workflow: 'ui-development',
          feature: `Screen ${uiMatch[2]}: ${uiMatch[3].trim()}`
        })
        continue
      }
      const match = line.match(/^\[(.*?)\].*Starting (frontend development|feature development) session/i)
      if (match) {
        const startedAt = Date.parse(match[1])
        if (Number.isNaN(startedAt)) continue
        entries.push({
          timestamp: startedAt,
          workflow: match[2].toLowerCase().startsWith('frontend') ? 'frontend-development' : 'features-development'
        })
        continue
      }
      const requirement = line.match(/\bRequirement\s+(\d+)\s*:\s*([^—\-\n]+)/i)
      const current = entries.at(-1)
      if (requirement && current && !current.feature) {
        current.feature = `Req ${requirement[1]}: ${requirement[2].trim()}`
      }
    }
  }
  return entries
    .filter((entry) => entry.timestamp <= timestamp)
    .sort((left, right) => right.timestamp - left.timestamp)[0] ?? null
}

export function syncClaudeUsage() {
  const root = normalizeFilePath(repoRoot())
  const data = store()
  // Incremental: keep everything already accounted and only add request IDs not
  // seen before. Claude requests are immutable, so prior cost is never recomputed
  // or lost (earlier this wiped+rebuilt every auto entry on each sync).
  const existingIds = new Set(data.development.map((entry) => entry.id))
  const seenRequests = new Set<string>()
  const entries: DevCostEntry[] = []
  let scanned = 0
  let skipped = 0

  for (const file of claudeJsonlFiles()) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    for (const line of lines) {
      if (!line.trim()) continue
      let item: ClaudeLogEntry
      try {
        item = JSON.parse(line) as ClaudeLogEntry
      } catch {
        skipped += 1
        continue
      }
      const usage = item.message?.usage
      const cwd = normalizeFilePath(item.cwd)
      if (!usage || !cwd.startsWith(root)) continue
      const requestId = item.requestId || item.uuid
      if (!requestId || seenRequests.has(requestId)) continue
      seenRequests.add(requestId)
      const id = `claude-${requestId}`
      if (existingIds.has(id)) continue
      const input = Number(usage.input_tokens ?? 0) + Number(usage.cache_creation_input_tokens ?? 0)
      const output = Number(usage.output_tokens ?? 0)
      const cached = Number(usage.cache_read_input_tokens ?? 0)
      if (input + output + cached <= 0) continue
      const featureRun = featureRunForTimestamp(item.timestamp)
      const phase = featureRun?.phase ?? phaseForTimestamp(item.timestamp)
      if (!phase) continue
      entries.push({
        id,
        timestamp: item.timestamp ?? new Date().toISOString(),
        phase,
        feature: featureRun?.feature ?? phaseFeature(phase),
        tool: 'claude-code',
        model: item.message?.model ?? 'claude-sonnet-4-6',
        session_minutes: 0,
        input_tokens: input,
        output_tokens: output,
        cached_tokens: cached,
        cost_usd: estimateCost(item.message?.model ?? 'claude-sonnet-4-6', input, output, cached),
        capture_method: 'auto',
        notes: `Imported from Claude Code usage log (${requestId})`
      })
      scanned += 1
    }
  }

  if (entries.length > 0) {
    data.development = [...data.development, ...entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    saveStore(data)
  }
  return { imported: entries.length, scanned, skipped }
}

type CodexSessionEvent = {
  timestamp?: string
  type?: string
  payload?: { id?: string; type?: string; info?: { total_token_usage?: CodexTokenUsage } }
}
type CodexTokenUsage = {
  input_tokens?: number
  cached_input_tokens?: number
  output_tokens?: number
  reasoning_output_tokens?: number
  total_tokens?: number
}

function codexSessionFiles() {
  const root = path.join(os.homedir(), '.codex')
  const out: string[] = []
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full)
    }
  }
  walk(path.join(root, 'sessions'))
  walk(path.join(root, 'archived_sessions'))
  return out
}

// Import Codex session token usage into the development cost store so Codex work
// (Docmee development + support) is reflected in Development Cost. Codex is a
// product plan, so per-token cost is not exposed locally — cost is an estimate
// (capture_method 'estimated'); tokens are exact.
//
// Incremental: never wipe. A new session is added; a session already imported is
// topped up only when its cumulative usage has grown (accounting the delta), so
// re-syncing adds the not-yet-accounted cost without recomputing everything.
export function syncCodexUsage() {
  const data = store()
  const byId = new Map(data.development.map((entry) => [entry.id, entry]))
  let imported = 0
  let updated = 0
  let scanned = 0

  for (const file of codexSessionFiles()) {
    let sessionId = ''
    let lastTimestamp = ''
    let total: CodexTokenUsage | undefined
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line) as CodexSessionEvent
        if (event.type === 'session_meta' && event.payload?.id) sessionId = event.payload.id
        if (event.payload?.type === 'token_count' && event.payload.info?.total_token_usage) {
          total = event.payload.info.total_token_usage
          if (event.timestamp) lastTimestamp = event.timestamp
        }
      } catch {
        // Ignore partial JSONL lines while Codex is mid-write.
      }
    }
    if (!total) continue
    sessionId = sessionId || path.basename(file, '.jsonl')
    const id = `codex-session-${sessionId}`
    const input = Number(total.input_tokens ?? 0)
    const cached = Number(total.cached_input_tokens ?? 0)
    const output = Number(total.output_tokens ?? 0) + Number(total.reasoning_output_tokens ?? 0)
    if (input + cached + output <= 0) continue
    scanned += 1
    const existing = byId.get(id)
    if (existing) {
      // Top up only if this session has grown since it was last accounted.
      const prior = existing.input_tokens + existing.output_tokens + existing.cached_tokens
      if (input + output + cached <= prior) continue
      existing.input_tokens = input
      existing.output_tokens = output
      existing.cached_tokens = cached
      existing.cost_usd = estimateCost('codex', input, output, cached)
      existing.timestamp = lastTimestamp || existing.timestamp
      updated += 1
      continue
    }
    const correlated = featureRunForTimestamp(lastTimestamp)
    const phase = correlated?.phase ?? phaseForTimestamp(lastTimestamp) ?? 'SUPPORT'
    const entry: DevCostEntry = {
      id,
      timestamp: lastTimestamp || new Date().toISOString(),
      phase,
      feature: correlated?.feature ?? 'Codex development & support',
      tool: 'codex-pro',
      model: 'codex',
      session_minutes: 0,
      input_tokens: input,
      output_tokens: output,
      cached_tokens: cached,
      cost_usd: estimateCost('codex', input, output, cached),
      capture_method: 'estimated',
      notes: `Imported from Codex session usage (${sessionId})`
    }
    data.development.push(entry)
    byId.set(id, entry)
    imported += 1
  }

  if (imported > 0 || updated > 0) {
    data.development.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    saveStore(data)
  }
  return { imported, updated, scanned }
}

function devSummary(entries: DevCostEntry[], groupBy: 'phase' | 'tool' | 'feature' = 'tool') {
  return entries.reduce<Record<string, { sessions: number; minutes: number; usd: number; input: number; output: number; cached: number }>>((acc, entry) => {
    const key = entry[groupBy] || 'unknown'
    acc[key] ??= { sessions: 0, minutes: 0, usd: 0, input: 0, output: 0, cached: 0 }
    acc[key].sessions += 1
    acc[key].minutes += entry.session_minutes
    acc[key].usd += entry.cost_usd
    acc[key].input += entry.input_tokens
    acc[key].output += entry.output_tokens
    acc[key].cached += entry.cached_tokens
    return acc
  }, {})
}

export const costCmd = new Command('cost').description('Track API cost')

costCmd.command('log')
  .requiredOption('--provider <provider>')
  .option('--input <input>', 'Input tokens', '0')
  .option('--output <output>', 'Output tokens', '0')
  .option('--tokens <tokens>', 'Total tokens', '0')
  .option('--minutes <minutes>', 'Audio minutes', '0')
  .action(async (opts: { provider: string; input: string; output: string; tokens: string; minutes: string }) => {
    loadConfig()
    const entry: CostEntry = {
      provider: opts.provider,
      input: Number(opts.input),
      output: Number(opts.output),
      tokens: Number(opts.tokens),
      minutes: Number(opts.minutes),
      usd: (Number(opts.input) + Number(opts.output) + Number(opts.tokens)) / 1_000_000,
      createdAt: new Date().toISOString()
    }
    const data = store()
    data.runtime = [...data.runtime, entry]
    saveStore(data)
    const today = new Date().toISOString().split('T')[0]
    const todaySpend = data.runtime.filter((item) => item.createdAt.startsWith(today)).reduce((sum, item) => sum + item.usd, 0)
    const threshold = Number(process.env.COST_ALERT_THRESHOLD_USD || '10')
    const exchange = await getUsdToCad()
    const display = costDisplayCurrency()
    log('cost', `Logged ${entry.provider} cost ${formatCost(entry.usd, exchange, display)}`)
    if (todaySpend > threshold) {
      log('cost', `Daily spend ${formatCost(todaySpend, exchange, display)} exceeded threshold ${formatCost(threshold, exchange, display)}`, 'warn')
      try {
        await notifyCostAlert(todaySpend, threshold, exchange.rate)
      } finally {
        await closeDiscordClient()
      }
    }
  })

costCmd.command('today').action(async () => {
  loadConfig()
  const exchange = await getUsdToCad()
  const display = costDisplayCurrency()
  const today = new Date().toISOString().split('T')[0]
  const todayEntries = entries().filter((entry) => entry.createdAt.startsWith(today))
  console.table(todayEntries.map((entry) => ({
    provider: entry.provider,
    cost: formatCost(entry.usd, exchange, display),
    createdAt: entry.createdAt
  })))
  const total = todayEntries.reduce((sum, entry) => sum + entry.usd, 0)
  console.log(`Total today: ${formatCost(total, exchange, display)}`)
  console.log(`Exchange rate: 1 USD = ${exchange.rates.CAD.toFixed(4)} CAD / ${exchange.rates.GTQ.toFixed(4)} GTQ`)
})
costCmd.command('summary').action(async () => {
  loadConfig()
  const exchange = await getUsdToCad()
  const display = costDisplayCurrency()
  const totals = entries().reduce<Record<string, number>>((acc, entry) => {
    acc[entry.provider] = (acc[entry.provider] || 0) + entry.usd
    return acc
  }, {})
  const developmentTotal = developmentEntries().reduce((sum, entry) => sum + entry.cost_usd, 0)
  console.table(Object.entries(totals).map(([provider, usd]) => ({ type: 'runtime', provider, cost: formatCost(usd, exchange, display) })))
  console.log(`Development total: ${formatCost(developmentTotal, exchange, display)}`)
  console.log(`Exchange rate: 1 USD = ${exchange.rates.CAD.toFixed(4)} CAD / ${exchange.rates.GTQ.toFixed(4)} GTQ`)
})

const devCmd = costCmd.command('dev').description('Track one-time development build cost')

devCmd.command('log')
  .requiredOption('--phase <phase>')
  .requiredOption('--feature <feature>')
  .requiredOption('--tool <tool>')
  .option('--model <model>', 'Model name', 'o4-mini')
  .option('--input <input>', 'Input tokens', '0')
  .option('--output <output>', 'Output tokens', '0')
  .option('--cached <cached>', 'Cached tokens', '0')
  .option('--minutes <minutes>', 'Session minutes', '0')
  .option('--method <method>', 'Capture method', 'manual')
  .option('--notes <notes>', 'Notes', '')
  .action((opts: { phase: string; feature: string; tool: string; model: string; input: string; output: string; cached: string; minutes: string; method: 'auto' | 'manual' | 'estimated'; notes: string }) => {
    const input = Number(opts.input)
    const output = Number(opts.output)
    const cached = Number(opts.cached)
    const entry: DevCostEntry = {
      id: `dev-${Date.now()}`,
      timestamp: new Date().toISOString(),
      phase: opts.phase,
      feature: opts.feature,
      tool: opts.tool,
      model: opts.model,
      session_minutes: Number(opts.minutes),
      input_tokens: input,
      output_tokens: output,
      cached_tokens: cached,
      cost_usd: estimateCost(opts.model, input, output, cached),
      capture_method: opts.method,
      notes: opts.notes
    }
    const data = store()
    data.development = [...data.development, entry]
    saveStore(data)
    log('cost', `Logged development session ${entry.phase}/${entry.feature} USD $${entry.cost_usd.toFixed(4)}`)
  })

devCmd.command('sync-claude')
  .description('Import Claude Code usage from local Claude logs')
  .action(() => {
    const result = syncClaudeUsage()
    log('cost', `Claude usage sync imported ${result.imported} new cost entr${result.imported === 1 ? 'y' : 'ies'}`)
  })

devCmd.command('sync-codex')
  .description('Import Codex session token usage (development, support, anything Docmee)')
  .action(() => {
    const result = syncCodexUsage()
    log('cost', `Codex usage sync: ${result.imported} new, ${result.updated} updated from ${result.scanned} session(s)`)
  })

devCmd.command('summary')
  .option('--phase <phase>')
  .option('--tool <tool>')
  .option('--by <by>', 'Group by phase, tool, or feature', 'tool')
  .action(async (opts: { phase?: string; tool?: string; by: 'phase' | 'tool' | 'feature' }) => {
    loadConfig()
    const exchange = await getUsdToCad()
    const display = costDisplayCurrency()
    const filtered = developmentEntries()
      .filter((entry) => !opts.phase || entry.phase === opts.phase)
      .filter((entry) => !opts.tool || entry.tool === opts.tool)
    console.table(Object.entries(devSummary(filtered, opts.by)).map(([group, value]) => ({
      group,
      sessions: value.sessions,
      minutes: value.minutes,
      input: value.input,
      output: value.output,
      cached: value.cached,
      cost: formatCost(value.usd, exchange, display)
    })))
    console.log(`Exchange rate: 1 USD = ${exchange.rates.CAD.toFixed(4)} CAD / ${exchange.rates.GTQ.toFixed(4)} GTQ`)
  })

devCmd.command('projection').action(async () => {
  loadConfig()
  const exchange = await getUsdToCad()
  const display = costDisplayCurrency()
  const entries = developmentEntries()
  const phases = new Set(entries.map((entry) => entry.phase))
  const total = entries.reduce((sum, entry) => sum + entry.cost_usd, 0)
  const avg = phases.size > 0 ? total / phases.size : 0
  console.table([{
    phases: `${phases.size}/19`,
    cost_to_date: formatCost(total, exchange, display),
    avg_phase: formatCost(avg, exchange, display),
    projected_total: formatCost(avg * 19, exchange, display)
  }])
  console.log(`Exchange rate: 1 USD = ${exchange.rates.CAD.toFixed(4)} CAD / ${exchange.rates.GTQ.toFixed(4)} GTQ`)
})
