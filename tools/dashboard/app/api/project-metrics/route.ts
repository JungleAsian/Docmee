import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { maybeAutoSyncCost } from '../../lib/cost-autosync'

const toolsRoot = path.resolve(process.cwd(), '..')
const logsRoot = path.join(toolsRoot, 'logs')

type DevCostEntry = {
  phase?: string
  feature?: string
  tool?: string
  notes?: string
  input_tokens?: number
  output_tokens?: number
  cached_tokens?: number
  cost_usd?: number
}
type CostStore = { development?: DevCostEntry[] } | DevCostEntry[]
type PhaseState = { id: string; status?: string }
type BuildRun = { phase?: string; status?: string; message?: string; heartbeatAt?: string }
const buildPhaseIds = Array.from({ length: 19 }, (_, index) => `P${String(index + 1).padStart(2, '0')}`)

function readJson<T>(file: string, fallback: T): T {
  const target = path.join(logsRoot, file)
  if (!fs.existsSync(target)) return fallback
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8')) as T
  } catch {
    return fallback
  }
}

function developmentEntries() {
  const store = readJson<CostStore>('cost.json', { development: [] })
  if (Array.isArray(store)) return [] as DevCostEntry[]
  return store.development ?? []
}

function tokenTotal(entry: DevCostEntry) {
  return Number(entry.input_tokens ?? 0) + Number(entry.output_tokens ?? 0) + Number(entry.cached_tokens ?? 0)
}

function isFrontendEntry(entry: DevCostEntry) {
  const text = `${entry.phase ?? ''} ${entry.feature ?? ''} ${entry.notes ?? ''}`.toLowerCase()
  return entry.phase === 'FRONTEND' || text.includes('frontend')
}

function isUiEntry(entry: DevCostEntry) {
  const text = `${entry.phase ?? ''} ${entry.feature ?? ''} ${entry.notes ?? ''}`.toLowerCase()
  return entry.phase === 'UI-DEVELOPMENT' || text.includes('ui development') || text.includes('claude design') || /\bscreen\s+\d+\b/.test(text)
}

function isSupportEntry(entry: DevCostEntry) {
  const text = `${entry.phase ?? ''} ${entry.feature ?? ''} ${entry.tool ?? ''} ${entry.notes ?? ''}`.toLowerCase()
  return text.includes('docmee_support_chat=true') || text.includes('support cost') || text.includes('support chat')
}

// Codex usage is cross-cutting (development + support) and priced by estimate.
// Keep it out of the Frontend/Backend/UI build lanes so those stay Claude-Code
// build cost; Codex is still counted in the page's all-development total.
function isCodexEntry(entry: DevCostEntry) {
  return (entry.tool ?? '').toLowerCase().includes('codex')
}

function summarizeCost(entries: DevCostEntry[]) {
  return {
    cost: entries.reduce((total, entry) => total + Number(entry.cost_usd ?? 0), 0),
    tokens: entries.reduce((total, entry) => total + tokenTotal(entry), 0)
  }
}

export function GET() {
  // Keep Development Cost current automatically — throttled, non-blocking, and
  // incremental. The header polls this route, so cost stays fresh on its own.
  maybeAutoSyncCost()
  const development = developmentEntries()
  const phases = readJson<PhaseState[]>('phases.json', [])
  const run = readJson<BuildRun>('build-run.json', {})
  const buildEntries = development.filter((entry) => !isSupportEntry(entry) && !isCodexEntry(entry))
  const frontendEntries = buildEntries.filter(isFrontendEntry)
  const uiEntries = buildEntries.filter((entry) => !isFrontendEntry(entry) && isUiEntry(entry))
  const backendEntries = buildEntries.filter((entry) => !isFrontendEntry(entry) && !isUiEntry(entry))
  const backend = summarizeCost(backendEntries)
  const frontend = summarizeCost(frontendEntries)
  const ui = summarizeCost(uiEntries)
  const build = summarizeCost(buildEntries)
  const allDevelopment = summarizeCost(development)
  const phaseById = new Map(phases.filter((phase) => buildPhaseIds.includes(phase.id)).map((phase) => [phase.id, phase]))
  const done = buildPhaseIds.filter((id) => phaseById.get(id)?.status === 'done').length
  const total = buildPhaseIds.length
  const currentPhase = buildPhaseIds.includes(run.phase ?? '')
    ? run.phase ?? 'P19'
    : buildPhaseIds.find((id) => phaseById.get(id)?.status === 'in-progress') || buildPhaseIds.find((id) => phaseById.get(id)?.status !== 'done') || 'P19'

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    totalCost: build.cost,
    totalTokens: build.tokens,
    buildCost: build.cost,
    buildTokens: build.tokens,
    backendCost: backend.cost,
    backendTokens: backend.tokens,
    frontendCost: frontend.cost,
    frontendTokens: frontend.tokens,
    uiCost: ui.cost,
    uiTokens: ui.tokens,
    allDevelopmentCost: allDevelopment.cost,
    allDevelopmentTokens: allDevelopment.tokens,
    phase: {
      current: currentPhase,
      done,
      total,
      status: run.status ?? phaseById.get(currentPhase)?.status ?? 'unknown',
      message: run.message ?? ''
    }
  })
}
