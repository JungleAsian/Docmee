import fs from 'node:fs'
import path from 'node:path'
import { costDisplayCurrency, formatCost, getUsdToCad } from '../lib/currency'
import { maybeAutoSyncCost, lastAutoSyncAt } from '../lib/cost-autosync'
import { AutoRefresh } from '../auto-refresh'
import { WorkflowStages } from '../workflow-stages'
import { CostDonut, CostBars } from './cost-charts'

const costFile = path.resolve(process.cwd(), '..', 'logs', 'cost.json')
const coverageFile = path.resolve(process.cwd(), '..', 'logs', 'rev1-feature-coverage.json')
const featureRunFile = path.resolve(process.cwd(), '..', 'logs', 'feature-run.json')
const currentCodexThreadId = '019ed30f-861d-7ef1-8a5b-3e7204801868'

type PageProps = { searchParams?: { message?: string; error?: string } }
type RuntimeCostEntry = { provider: string; usd: number; createdAt: string; input?: number; output?: number; tokens?: number; minutes?: number }
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
  capture_method: string
  notes: string
}
type CostStore = RuntimeCostEntry[] | { runtime?: RuntimeCostEntry[]; development?: DevCostEntry[] }
type FeatureStatus = 'complete' | 'partial' | 'missing'
type Feature = {
  id: number
  phase: string
  area: string
  feature: string
  status: FeatureStatus
  backendStatus?: 'complete' | 'pending' | 'needs-audit'
  frontendStatus?: 'complete' | 'pending' | 'needs-audit'
  priority: 'critical' | 'high' | 'medium' | 'low'
}
type FeatureRun = { phase?: string; status?: string; startedAt?: string; heartbeatAt?: string; message?: string }
type CodexTokenUsage = {
  input_tokens?: number
  cached_input_tokens?: number
  output_tokens?: number
  reasoning_output_tokens?: number
  total_tokens?: number
}
type CodexSessionEvent = {
  timestamp?: string
  type?: string
  payload?: {
    id?: string
    type?: string
    info?: { total_token_usage?: CodexTokenUsage }
  }
}

const phases = Array.from({ length: 19 }, (_, index) => `P${String(index + 1).padStart(2, '0')}`)

// These JSON files are written concurrently by daemons/CLI, so a mid-write read
// can be malformed — guard every parse so the Cost page degrades instead of 500ing.
function readJsonSafe<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function readDevelopmentCost() {
  const data = readJsonSafe<CostStore>(costFile, [])
  return Array.isArray(data) ? [] : data.development ?? []
}

function readRuntimeCost() {
  const data = readJsonSafe<CostStore>(costFile, [])
  return Array.isArray(data) ? data : data.runtime ?? []
}

function readFeatures() {
  return readJsonSafe<Feature[]>(coverageFile, [])
}

function readFeatureRun() {
  return readJsonSafe<FeatureRun>(featureRunFile, {} as FeatureRun)
}

function sum(entries: DevCostEntry[], tool?: string) {
  return entries.filter((entry) => !tool || entry.tool === tool).reduce((total, entry) => total + entry.cost_usd, 0)
}

function tokenTotal(entry: DevCostEntry) {
  return entry.input_tokens + entry.output_tokens + entry.cached_tokens
}

function tokenRate(totalCost: number, tokens: number) {
  if (tokens <= 0) return { perToken: 0, perThousand: 0, perMillion: 0 }
  const perToken = totalCost / tokens
  return {
    perToken,
    perThousand: perToken * 1000,
    perMillion: perToken * 1000000
  }
}

function matchesFeature(entry: DevCostEntry, feature: Feature) {
  const text = `${entry.phase} ${entry.feature} ${entry.notes}`.toLowerCase()
  // Word-bounded id match so feature 3 does NOT also absorb Req 30, 35, 39, …
  // (plain includes('req 3') matched every Req 3X entry and wildly inflated rows).
  const idBoundary = new RegExp(`\\b(?:req|feature)\\s*${feature.id}\\b`)
  return text.includes(feature.feature.toLowerCase()) || idBoundary.test(text)
}

function isFrontendEntry(entry: DevCostEntry) {
  const text = `${entry.phase} ${entry.feature} ${entry.notes}`.toLowerCase()
  return entry.phase === 'FRONTEND' || text.includes('frontend')
}

function isUiEntry(entry: DevCostEntry) {
  const text = `${entry.phase} ${entry.feature} ${entry.notes}`.toLowerCase()
  return entry.phase === 'UI-DEVELOPMENT' || text.includes('ui development') || text.includes('claude design') || /\bscreen\s+\d+\b/.test(text)
}

function statusTone(status: FeatureStatus) {
  if (status === 'complete') return 'text-emerald-300'
  if (status === 'partial') return 'text-amber-300'
  return 'text-red-300'
}

function saturdayLastWeekStart() {
  const date = new Date()
  const diff = (date.getDay() - 6 + 7) % 7 || 7
  date.setDate(date.getDate() - diff)
  date.setHours(0, 0, 0, 0)
  return date
}

function addUsage(total: CodexTokenUsage, usage?: CodexTokenUsage, sign = 1) {
  if (!usage) return total
  total.input_tokens = (total.input_tokens ?? 0) + sign * (usage.input_tokens ?? 0)
  total.cached_input_tokens = (total.cached_input_tokens ?? 0) + sign * (usage.cached_input_tokens ?? 0)
  total.output_tokens = (total.output_tokens ?? 0) + sign * (usage.output_tokens ?? 0)
  total.reasoning_output_tokens = (total.reasoning_output_tokens ?? 0) + sign * (usage.reasoning_output_tokens ?? 0)
  total.total_tokens = (total.total_tokens ?? 0) + sign * (usage.total_tokens ?? 0)
  return total
}

function codexSessionFiles(root: string) {
  if (!fs.existsSync(root)) return [] as string[]
  const files: string[] = []
  for (const item of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, item.name)
    if (item.isDirectory()) files.push(...codexSessionFiles(fullPath))
    if (item.isFile() && item.name.endsWith('.jsonl')) files.push(fullPath)
  }
  return files
}

type CodexUsageResult = { since: Date; sessions: number; events: number; input: number; cached: number; output: number; reasoning: number; total: number }
let codexUsageCache: { at: number; sinceMs: number; result: CodexUsageResult } | null = null
const codexUsageTtlMs = 60 * 1000

function readCodexUsageSince(since: Date): CodexUsageResult {
  const now = Date.now()
  const sinceMs = since.getTime()
  if (codexUsageCache && codexUsageCache.sinceMs === sinceMs && now - codexUsageCache.at < codexUsageTtlMs) {
    return codexUsageCache.result
  }
  const codexRoot = path.join(process.env.USERPROFILE || process.env.HOME || '', '.codex')
  const files = [
    ...codexSessionFiles(path.join(codexRoot, 'sessions')),
    ...codexSessionFiles(path.join(codexRoot, 'archived_sessions'))
  ]
  const total: CodexTokenUsage = {}
  let sessions = 0
  let events = 0

  for (const file of files) {
    // A session entirely older than `since` contributes no at/after-window usage,
    // so skip by mtime instead of reading the whole (ever-growing) archive corpus.
    try {
      if (fs.statSync(file).mtimeMs < sinceMs) continue
    } catch {
      continue
    }
    let sessionMatches = file.includes(currentCodexThreadId)
    let before: CodexTokenUsage | undefined
    let after: CodexTokenUsage | undefined
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line) as CodexSessionEvent
        if (event.type === 'session_meta' && event.payload?.id === currentCodexThreadId) sessionMatches = true
        if (event.payload?.type !== 'token_count') continue
        const timestamp = event.timestamp ? new Date(event.timestamp) : null
        const usage = event.payload.info?.total_token_usage as CodexTokenUsage | undefined
        if (!timestamp || !usage) continue
        if (timestamp < since) before = usage
        if (timestamp >= since) {
          after = usage
          events += 1
        }
      } catch {
        // Ignore incomplete JSONL records while Codex is writing the session.
      }
    }
    if (sessionMatches && after) {
      addUsage(total, after)
      addUsage(total, before, -1)
      sessions += 1
    }
  }

  const result: CodexUsageResult = {
    since,
    sessions,
    events,
    input: total.input_tokens ?? 0,
    cached: total.cached_input_tokens ?? 0,
    output: total.output_tokens ?? 0,
    reasoning: total.reasoning_output_tokens ?? 0,
    total: total.total_tokens ?? 0
  }
  codexUsageCache = { at: now, sinceMs, result }
  return result
}

export default async function CostPage({ searchParams }: PageProps) {
  maybeAutoSyncCost()
  const autoSyncMs = lastAutoSyncAt()
  const autoSyncAgo = autoSyncMs
    ? (() => {
        const mins = Math.round((Date.now() - autoSyncMs) / 60000)
        return mins <= 0 ? 'just now' : mins === 1 ? '1 min ago' : `${mins} min ago`
      })()
    : 'pending'
  const runtime = readRuntimeCost()
  const development = readDevelopmentCost()
  const features = readFeatures()
  const featureRun = readFeatureRun()
  const exchange = await getUsdToCad()
  const display = costDisplayCurrency()
  const money = (value: number, decimals = 2) => formatCost(value, exchange, display, decimals)
  const codexSince = readCodexUsageSince(saturdayLastWeekStart())
  const completedPhases = new Set(development.map((entry) => entry.phase).filter((phase) => /^P\d{2}$/.test(phase)))
  const devTotal = development.reduce((total, entry) => total + entry.cost_usd, 0)
  const totalTokens = development.reduce((total, entry) => total + tokenTotal(entry), 0)
  const rate = tokenRate(devTotal, totalTokens)
  const avgPhase = completedPhases.size > 0 ? devTotal / completedPhases.size : 0
  const projection = avgPhase * 19
  const tools = ['claude-code', 'codex-pro', 'claude-chat']
  const featureEntries = development.filter((entry) => features.some((feature) => matchesFeature(entry, feature)) || entry.phase.startsWith('Phase '))
  const frontendEntries = development.filter(isFrontendEntry)
  const frontendTotal = frontendEntries.reduce((total, entry) => total + entry.cost_usd, 0)
  const uiEntries = development.filter(isUiEntry)
  const uiTotal = uiEntries.reduce((total, entry) => total + entry.cost_usd, 0)
  const backendFeatureEntries = featureEntries.filter((entry) => !isFrontendEntry(entry) && !isUiEntry(entry))
  const backendFeatureTotal = backendFeatureEntries.reduce((total, entry) => total + entry.cost_usd, 0)
  const codexEntries = development.filter((entry) => entry.tool.toLowerCase().includes('codex'))
  const currentChatEntries = codexEntries.filter((entry) => entry.notes.includes('docmee_support_chat=true'))
  const codexSupportTotal = codexEntries.reduce((total, entry) => total + entry.cost_usd, 0)
  const codexRuntimeToday = runtime.filter((entry) => {
    const created = new Date(entry.createdAt)
    const now = new Date()
    return entry.provider.toLowerCase().includes('openai') && created.toDateString() === now.toDateString()
  })
  const supportRows = [
    {
      source: 'API usage today',
      availability: 'Trackable when OpenAI API usage is connected',
      attribution: 'Needs Docmee project metadata or DevTools capture',
      entries: codexRuntimeToday.length,
      tokens: codexRuntimeToday.reduce((total, entry) => total + (entry.tokens ?? 0), 0),
      cost: codexRuntimeToday.reduce((total, entry) => total + entry.usd, 0),
      notes: 'Account-level API usage is not counted as Docmee unless it carries a Docmee marker.'
    },
    {
      source: 'ChatGPT / Codex product usage',
      availability: 'Depends on authenticated product usage access',
      attribution: 'Docmee only when logged from this workspace',
      entries: codexEntries.length,
      tokens: codexEntries.reduce((total, entry) => total + tokenTotal(entry), 0),
      cost: codexSupportTotal,
      notes: 'Tracked when sessions are logged as codex-pro by Docmee DevTools.'
    },
    {
      source: 'Current Codex chat',
      availability: 'Marked as Docmee support now',
      attribution: 'Docmee support marker in this workspace',
      entries: currentChatEntries.length,
      tokens: currentChatEntries.reduce((total, entry) => total + tokenTotal(entry), 0),
      cost: currentChatEntries.reduce((total, entry) => total + entry.cost_usd, 0),
      notes: 'Exact token/cost stays pending until product usage data is available.'
    },
    {
      source: 'Since Saturday last week',
      availability: 'Retrieved from local Codex session usage',
      attribution: `Current Docmee thread since ${codexSince.since.toLocaleDateString()}`,
      entries: codexSince.events,
      tokens: codexSince.total,
      cost: 0,
      notes: `Input ${codexSince.input.toLocaleString()}, cached ${codexSince.cached.toLocaleString()}, output ${codexSince.output.toLocaleString()}, reasoning ${codexSince.reasoning.toLocaleString()}. Product-plan cost is not exposed locally.`
    }
  ]
  const activeFeatureText = featureRun.message?.replace(/^Developing feature\s+/i, 'Req ') ?? 'No active feature'
  const featureRows = features.map((feature) => {
    const entries = development.filter((entry) => matchesFeature(entry, feature))
    const backendEntries = entries.filter((entry) => !isFrontendEntry(entry) && !isUiEntry(entry))
    const frontendRowEntries = entries.filter(isFrontendEntry)
    const uiRowEntries = entries.filter(isUiEntry)
    return {
      feature,
      entries,
      backendEntries,
      frontendEntries: frontendRowEntries,
      uiEntries: uiRowEntries,
      cost: entries.reduce((total, entry) => total + entry.cost_usd, 0),
      backendCost: backendEntries.reduce((total, entry) => total + entry.cost_usd, 0),
      frontendCost: frontendRowEntries.reduce((total, entry) => total + entry.cost_usd, 0),
      uiCost: uiRowEntries.reduce((total, entry) => total + entry.cost_usd, 0),
      tokens: entries.reduce((total, entry) => total + tokenTotal(entry), 0),
      frontendTokens: frontendRowEntries.reduce((total, entry) => total + tokenTotal(entry), 0),
      uiTokens: uiRowEntries.reduce((total, entry) => total + tokenTotal(entry), 0),
      minutes: entries.reduce((total, entry) => total + entry.session_minutes, 0)
    }
  })
  const trackedFeatures = featureRows.filter((row) => row.entries.length > 0).length

  // Chart data: cost by tool (donut) + cost by phase (bars).
  const claudeCost = development.filter((entry) => entry.tool.toLowerCase().includes('claude')).reduce((total, entry) => total + entry.cost_usd, 0)
  const codexCost = development.filter((entry) => entry.tool.toLowerCase().includes('codex')).reduce((total, entry) => total + entry.cost_usd, 0)
  const otherCost = Math.max(0, devTotal - claudeCost - codexCost)
  const toolSlices = [
    { label: 'Claude Code', value: claudeCost, formatted: money(claudeCost), color: '#06b6d4' },
    { label: 'Codex', value: codexCost, formatted: money(codexCost), color: '#8b5cf6' },
    { label: 'Other', value: otherCost, formatted: money(otherCost), color: '#64748b' }
  ]
  const phaseCostMap = new Map<string, number>()
  for (const entry of development) {
    if (/^P\d{2}$/.test(entry.phase)) phaseCostMap.set(entry.phase, (phaseCostMap.get(entry.phase) ?? 0) + entry.cost_usd)
  }
  const phaseBars = [...phaseCostMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([phase, cost]) => ({ label: phase, value: cost, formatted: money(cost) }))

  return (
    <section className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Development Cost</h1>
          <p className="mt-2 text-sm text-slate-400">Track the one-time build and development cost across phases, tools, tokens, and sessions.</p>
          <p className="mt-1 text-xs text-slate-500">Exchange rate: 1 USD = {exchange.rates.CAD.toFixed(4)} CAD / {exchange.rates.GTQ.toFixed(4)} GTQ · Updated {new Date(exchange.updatedAt).toLocaleDateString()} · Display: {display.toUpperCase()}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action="/api/settings/env" method="post" className="flex overflow-hidden rounded-md border border-cyan-700">
            <input type="hidden" name="action" value="cost-currency" />
            <input type="hidden" name="returnTo" value="/cost" />
            <label className="sr-only" htmlFor="cost-currency">Display currency</label>
            <select id="cost-currency" name="currency" defaultValue={display} className="bg-slate-950 px-3 py-2 text-sm font-medium text-cyan-100 outline-none">
              <option value="usd">USD</option>
              <option value="cad">CAD</option>
              <option value="gtq">GTQ</option>
            </select>
            <button className="border-l border-cyan-700 px-3 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-950/40">
              Convert
            </button>
          </form>
          <a href="/api/cost/pdf" className="grid place-items-center rounded-md border border-emerald-700 px-3 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-950/40">Export PDF</a>
          <form action="/api/actions" method="post">
            <input type="hidden" name="action" value="cost-dev-sync-claude" />
            <button className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950" title="Manual override — cost also syncs automatically every 5 min">Sync Claude Now</button>
          </form>
          <form action="/api/actions" method="post">
            <input type="hidden" name="action" value="cost-dev-sync-codex" />
            <button className="rounded-md bg-violet-500 px-3 py-2 text-sm font-medium text-slate-950" title="Manual override — cost also syncs automatically every 5 min">Sync Codex Now</button>
          </form>
          <p className="w-full text-right text-xs text-emerald-300/80">● Auto-syncing Claude + Codex cost every 5 min (incremental) · last {autoSyncAgo}</p>
        </div>
      </div>

      <AutoRefresh seconds={15} />
      <div className="mt-3">
        <WorkflowStages active="monitor" />
      </div>
      {searchParams?.message && <p className="mt-3 text-sm text-emerald-300">{searchParams.message}</p>}
      {searchParams?.error && <p className="mt-3 text-sm text-red-300">{searchParams.error}</p>}

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4"><h2 className="text-sm font-semibold">Cost to date</h2><p className="mt-2 text-2xl">{money(devTotal)}</p></div>
        <div className="rounded-md border border-emerald-900 bg-emerald-950/20 p-4"><h2 className="text-sm font-semibold text-emerald-100">Backend feature cost</h2><p className="mt-2 text-2xl">{money(backendFeatureTotal)}</p><p className="mt-1 text-xs text-emerald-100/70">{trackedFeatures}/{features.length || 41} features tracked</p></div>
        <div className="rounded-md border border-cyan-900 bg-cyan-950/20 p-4"><h2 className="text-sm font-semibold text-cyan-100">Frontend cost</h2><p className="mt-2 text-2xl">{money(frontendTotal)}</p><p className="mt-1 text-xs text-cyan-100/70">{frontendEntries.length} synced frontend entries</p></div>
        <div className="rounded-md border border-amber-800 bg-amber-950/20 p-4"><h2 className="text-sm font-semibold text-amber-100">UI development cost</h2><p className="mt-2 text-2xl">{money(uiTotal)}</p><p className="mt-1 text-xs text-amber-100/70">{uiEntries.length} synced UI entries</p></div>
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4"><h2 className="text-sm font-semibold">Projected total</h2><p className="mt-2 text-2xl">~{money(projection)}</p></div>
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4"><h2 className="text-sm font-semibold">Phases tracked</h2><p className="mt-2 text-3xl">{completedPhases.size}/19</p></div>
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4"><h2 className="text-sm font-semibold">Tokens tracked</h2><p className="mt-2 text-3xl">{totalTokens.toLocaleString()}</p></div>
        <div className="rounded-md border border-violet-900 bg-violet-950/20 p-4">
          <h2 className="text-sm font-semibold text-violet-100">Estimated token rate</h2>
          <p className="mt-2 text-xl">{money(rate.perMillion, 4)} / 1M</p>
          <p className="mt-1 text-xs text-violet-100/70">{money(rate.perThousand, 6)} / 1K · {money(rate.perToken, 8)} / token</p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,360px)_1fr]">
        <CostDonut title="Cost by tool" slices={toolSlices} />
        <CostBars title="Cost by phase" items={phaseBars} />
      </div>

      <details className="mt-5 rounded-md border border-slate-800 bg-slate-900/40 p-4">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2">
          <span className="text-sm font-semibold">Detailed breakdowns</span>
          <span className="text-xs text-slate-400">By tool · feature · phase · support — open / collapse</span>
        </summary>
        <div className="mt-4 grid gap-5 2xl:grid-cols-[420px_1fr]">
        <div className="space-y-5">
          <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
            <details>
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2">
                <span className="text-sm font-semibold">Cost by Tool</span>
                <span className="text-xs text-slate-400">Open / collapse</span>
              </summary>
              <div className="mt-3 space-y-3">
                {tools.map((tool) => {
                  const entries = development.filter((entry) => entry.tool === tool)
                  const minutes = entries.reduce((total, entry) => total + entry.session_minutes, 0)
                  return (
                    <div key={tool} className="rounded border border-slate-800 bg-slate-950/40 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-sm">{tool}</span>
                        <span className="font-semibold">{money(sum(development, tool))}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">{entries.length} sessions · {minutes} minutes</p>
                    </div>
                  )
                })}
              </div>
            </details>
          </div>

        </div>

        <div className="space-y-5">
          <div className="rounded-md border border-cyan-800 bg-cyan-950/20 p-4">
            <details>
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md border border-cyan-800 bg-slate-950/40 px-3 py-2">
                <span>
                  <span className="block text-sm font-semibold text-cyan-100">Feature Cost Monitor</span>
                  <span className="mt-1 block text-xs text-cyan-100/70">Active: {activeFeatureText}</span>
                </span>
                <span className="text-xs text-cyan-100/70">Open / collapse</span>
              </summary>
              <div className="mt-3 flex justify-end">
                <form action="/api/actions" method="post">
                  <input type="hidden" name="action" value="cost-dev-sync-claude" />
                  <button className="min-h-10 rounded-md border border-cyan-700 px-3 py-2 text-xs text-cyan-100 hover:bg-cyan-950/50">Sync feature cost</button>
                </form>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-950">
                    <tr>
                      <th className="p-3">Req</th>
                      <th className="p-3">Feature</th>
                      <th className="p-3">Backend</th>
                      <th className="p-3">Frontend</th>
                      <th className="p-3">Sessions</th>
                      <th className="p-3">Tokens</th>
                      <th className="p-3">Backend Cost</th>
                      <th className="p-3">Frontend Cost</th>
                      <th className="p-3">UI Cost</th>
                      <th className="p-3">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {featureRows.map(({ feature, entries, cost, tokens, frontendTokens, uiTokens, backendCost, frontendCost, uiCost }) => (
                      <tr key={feature.id} className={featureRun.message?.includes(`feature ${feature.id}`) ? 'bg-cyan-950/30' : ''}>
                        <td className="p-3 font-mono text-xs text-slate-400">{feature.id}</td>
                        <td className="p-3">
                          <div className="font-medium text-slate-100">{feature.feature}</div>
                          <div className="text-xs text-slate-500">{feature.phase} · {feature.area}</div>
                        </td>
                        <td className={`p-3 ${statusTone(feature.status)}`}>{feature.backendStatus ?? feature.status}</td>
                        <td className={feature.frontendStatus === 'complete' ? 'p-3 text-emerald-300' : feature.frontendStatus === 'needs-audit' ? 'p-3 text-amber-300' : 'p-3 text-slate-400'}>{feature.frontendStatus ?? 'pending'}</td>
                        <td className="p-3">{entries.length}</td>
                        <td className="p-3">
                          <div>{tokens.toLocaleString()}</div>
                          {frontendTokens > 0 && <div className="text-xs text-cyan-200">{frontendTokens.toLocaleString()} frontend</div>}
                          {uiTokens > 0 && <div className="text-xs text-amber-200">{uiTokens.toLocaleString()} UI</div>}
                        </td>
                        <td className="p-3">{money(backendCost, backendCost > 0 && backendCost < 1 ? 4 : 2)}</td>
                        <td className="p-3 text-cyan-100">{money(frontendCost, frontendCost > 0 && frontendCost < 1 ? 4 : 2)}</td>
                        <td className="p-3 text-amber-100">{money(uiCost, uiCost > 0 && uiCost < 1 ? 4 : 2)}</td>
                        <td className="p-3 font-semibold">{money(cost, cost > 0 && cost < 1 ? 4 : 2)}</td>
                      </tr>
                    ))}
                    {featureRows.length === 0 && <tr><td className="p-3 text-slate-400" colSpan={10}>No feature coverage file found.</td></tr>}
                  </tbody>
                </table>
              </div>
            </details>
          </div>

          <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
            <details>
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2">
                <span className="text-sm font-semibold">Cost by Phase</span>
                <span className="text-xs text-slate-400">Open / collapse</span>
              </summary>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-violet-900 bg-slate-950/40 p-3">
                <p className="text-sm text-violet-100/80">Count this Codex chat as Docmee support work. This records attribution now and leaves exact cost pending until usage data is available.</p>
                <form action="/api/actions" method="post">
                  <input type="hidden" name="action" value="cost-mark-current-codex-chat" />
                  <button className="min-h-10 rounded-md border border-violet-600 px-3 py-2 text-xs font-medium text-violet-100 hover:bg-violet-950/60">Mark Current Chat</button>
                </form>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-950"><tr><th className="p-3">Phase</th><th className="p-3">Claude Code</th><th className="p-3">Codex Pro</th><th className="p-3">Other</th><th className="p-3">Total</th><th className="p-3">Status</th></tr></thead>
                  <tbody className="divide-y divide-slate-800">
                    {phases.map((phase) => {
                      const phaseEntries = development.filter((entry) => entry.phase === phase)
                      const known = sum(phaseEntries, 'claude-code') + sum(phaseEntries, 'codex-pro')
                      return <tr key={phase}><td className="p-3 font-mono">{phase}</td><td className="p-3">{money(sum(phaseEntries, 'claude-code'))}</td><td className="p-3">{money(sum(phaseEntries, 'codex-pro'))}</td><td className="p-3">{money(Math.max(sum(phaseEntries) - known, 0))}</td><td className="p-3 font-semibold">{money(sum(phaseEntries))}</td><td className={phaseEntries.length > 0 ? 'p-3 text-emerald-300' : 'p-3 text-slate-400'}>{phaseEntries.length > 0 ? 'tracked' : 'pending'}</td></tr>
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          </div>

          <div className="rounded-md border border-violet-800 bg-violet-950/20 p-4">
            <details>
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md border border-violet-800 bg-slate-950/40 px-3 py-2">
                <span>
                  <span className="block text-sm font-semibold text-violet-100">Support Cost (Codex)</span>
                  <span className="mt-1 block text-xs text-violet-100/70">API usage can be tracked today; ChatGPT/Codex product usage depends on available authenticated usage access.</span>
                </span>
                <span className="text-xs text-violet-100/70">Open / collapse</span>
              </summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-950">
                    <tr>
                      <th className="p-3">Source</th>
                      <th className="p-3">Tracking status</th>
                      <th className="p-3">Docmee attribution</th>
                      <th className="p-3">Entries</th>
                      <th className="p-3">Tokens</th>
                      <th className="p-3">Cost</th>
                      <th className="p-3">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {supportRows.map((row) => (
                      <tr key={row.source}>
                        <td className="p-3 font-medium text-violet-100">{row.source}</td>
                        <td className="p-3 text-slate-300">{row.availability}</td>
                        <td className="p-3 text-slate-300">{row.attribution}</td>
                        <td className="p-3">{row.entries}</td>
                        <td className="p-3">{row.tokens.toLocaleString()}</td>
                        <td className="p-3 font-semibold">{money(row.cost, row.cost > 0 && row.cost < 1 ? 4 : 2)}</td>
                        <td className="p-3 text-slate-400">{row.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>

        </div>
        </div>
      </details>
    </section>
  )
}
