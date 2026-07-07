import fs from 'node:fs'
import path from 'node:path'
import { costDisplayCurrency, formatCost, getUsdToCad } from '../../../lib/currency'

const toolsRoot = path.resolve(process.cwd(), '..')
const costFile = path.join(toolsRoot, 'logs', 'cost.json')
const coverageFile = path.join(toolsRoot, 'logs', 'rev1-feature-coverage.json')
const currentCodexThreadId = '019ed30f-861d-7ef1-8a5b-3e7204801868'
const phases = Array.from({ length: 19 }, (_, index) => `P${String(index + 1).padStart(2, '0')}`)

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
type CostStore = { development?: DevCostEntry[] }
type RuntimeCostEntry = { provider: string; usd: number; createdAt: string; input?: number; output?: number; tokens?: number; minutes?: number }
type FullCostStore = { runtime?: RuntimeCostEntry[]; development?: DevCostEntry[] }
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
type Feature = {
  id: number
  phase: string
  area: string
  feature: string
  status: string
  backendStatus?: string
  frontendStatus?: string
}

function readDevelopmentCost() {
  if (!fs.existsSync(costFile)) return [] as DevCostEntry[]
  const data = JSON.parse(fs.readFileSync(costFile, 'utf8')) as CostStore | DevCostEntry[]
  return Array.isArray(data) ? [] : data.development ?? []
}

function readRuntimeCost() {
  if (!fs.existsSync(costFile)) return [] as RuntimeCostEntry[]
  const data = JSON.parse(fs.readFileSync(costFile, 'utf8')) as FullCostStore | RuntimeCostEntry[]
  return Array.isArray(data) ? data : data.runtime ?? []
}

function readFeatures() {
  if (!fs.existsSync(coverageFile)) return [] as Feature[]
  return JSON.parse(fs.readFileSync(coverageFile, 'utf8')) as Feature[]
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
  return text.includes(feature.feature.toLowerCase()) || text.includes(`req ${feature.id}`) || text.includes(`feature ${feature.id}`)
}

function isFrontendEntry(entry: DevCostEntry) {
  const text = `${entry.phase} ${entry.feature} ${entry.notes}`.toLowerCase()
  return entry.phase === 'FRONTEND' || text.includes('frontend')
}

function isUiEntry(entry: DevCostEntry) {
  const text = `${entry.phase} ${entry.feature} ${entry.notes}`.toLowerCase()
  return entry.phase === 'UI-DEVELOPMENT' || text.includes('ui development') || text.includes('claude design') || /\bscreen\s+\d+\b/.test(text)
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

function readCodexUsageSince(since: Date) {
  const codexRoot = path.join(process.env.USERPROFILE || process.env.HOME || '', '.codex')
  const files = [
    ...codexSessionFiles(path.join(codexRoot, 'sessions')),
    ...codexSessionFiles(path.join(codexRoot, 'archived_sessions'))
  ]
  const total: CodexTokenUsage = {}
  const sinceMs = since.getTime()
  let sessions = 0
  let events = 0

  for (const file of files) {
    // Sessions entirely older than `since` contribute nothing; skip by mtime to
    // avoid reading the unbounded ~/.codex archive corpus on every export.
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

  return {
    since,
    sessions,
    events,
    input: total.input_tokens ?? 0,
    cached: total.cached_input_tokens ?? 0,
    output: total.output_tokens ?? 0,
    reasoning: total.reasoning_output_tokens ?? 0,
    total: total.total_tokens ?? 0
  }
}

function sanitize(text: string) {
  return text
    .replace(/[^\x20-\x7E]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapePdfText(text: string) {
  return sanitize(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function pdfLine(text: string, x: number, y: number, size = 9, font = 'F1') {
  return `BT /${font} ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`
}

function pdfRect(x: number, y: number, width: number, height: number, fill = false) {
  return fill
    ? `q 0.91 0.94 0.97 rg ${x} ${y} ${width} ${height} re f Q`
    : `q 0.70 G ${x} ${y} ${width} ${height} re S Q`
}

function truncate(text: string, max: number) {
  const clean = sanitize(text)
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 3))}...` : clean
}

type Column<T> = {
  label: string
  width: number
  value: (row: T) => string
  align?: 'left' | 'right'
}

type PdfPage = string[]

function buildPdf(pages: PdfPage[]) {
  const objects: string[] = []
  objects.push('<< /Type /Catalog /Pages 2 0 R >>')
  objects.push('')
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>')

  const pageRefs: string[] = []
  pages.forEach((pageLines, pageIndex) => {
    const pageObjectNumber = objects.length + 1
    const contentObjectNumber = pageObjectNumber + 1
    pageRefs.push(`${pageObjectNumber} 0 R`)
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`)
    const content = [
      pdfLine('Docmee DevTools - Development Cost Report', 36, 570, 14, 'F2'),
      pdfLine(`Generated: ${new Date().toLocaleString()} | Page ${pageIndex + 1} of ${pages.length}`, 36, 552, 8),
      ...pageLines,
      pdfLine('Generated by Docmee DevTools', 36, 24, 8)
    ].join('\n')
    objects.push(`<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`)
  })
  objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pageRefs.length} >>`

  const chunks = ['%PDF-1.4\n']
  const offsets: number[] = [0]
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(chunks.join(''), 'utf8'))
    chunks.push(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`)
  }
  const xrefOffset = Buffer.byteLength(chunks.join(''), 'utf8')
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`)
  for (let index = 1; index < offsets.length; index += 1) {
    chunks.push(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`)
  }
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)
  return Buffer.from(chunks.join(''), 'utf8')
}

function createReportBuilder() {
  const pages: PdfPage[] = []
  let current: PdfPage = []
  let y = 526

  function newPage() {
    if (current.length) pages.push(current)
    current = []
    y = 526
  }

  function ensure(height: number) {
    if (y - height < 48) newPage()
  }

  function section(title: string) {
    ensure(34)
    current.push(pdfLine(title, 36, y, 12, 'F2'))
    y -= 18
  }

  function table<T>(columns: Array<Column<T>>, rows: T[], options?: { rowHeight?: number; title?: string }) {
    if (options?.title) section(options.title)
    const rowHeight = options?.rowHeight ?? 18
    const tableWidth = columns.reduce((total, column) => total + column.width, 0)

    function header() {
      ensure(rowHeight * 2)
      current.push(pdfRect(36, y - rowHeight + 4, tableWidth, rowHeight, true))
      let x = 36
      for (const column of columns) {
        current.push(pdfRect(x, y - rowHeight + 4, column.width, rowHeight))
        current.push(pdfLine(column.label, x + 4, y - 8, 7.2, 'F2'))
        x += column.width
      }
      y -= rowHeight
    }

    header()
    for (const row of rows) {
      if (y - rowHeight < 48) {
        newPage()
        header()
      }
      let x = 36
      for (const column of columns) {
        current.push(pdfRect(x, y - rowHeight + 4, column.width, rowHeight))
        const text = truncate(column.value(row), Math.max(8, Math.floor(column.width / 4.2)))
        const offset = column.align === 'right' ? Math.max(4, column.width - (text.length * 4.4) - 4) : 4
        current.push(pdfLine(text, x + offset, y - 8, 6.8))
        x += column.width
      }
      y -= rowHeight
    }
    y -= 12
  }

  function finish() {
    if (current.length || pages.length === 0) pages.push(current)
    return pages
  }

  return { section, table, finish }
}

export async function GET() {
  const runtime = readRuntimeCost()
  const development = readDevelopmentCost()
  const features = readFeatures()
  const exchange = await getUsdToCad()
  const display = costDisplayCurrency()
  const money = (value: number, decimals = 2) => formatCost(value, exchange, display, decimals)
  const tableMoney = (value: number) => formatCost(value, exchange, display, value > 0 && value < 1 ? 4 : 2)
  const codexSince = readCodexUsageSince(saturdayLastWeekStart())
  const devTotal = development.reduce((total, entry) => total + entry.cost_usd, 0)
  const frontendEntries = development.filter(isFrontendEntry)
  const uiEntries = development.filter(isUiEntry)
  const backendEntries = development.filter((entry) => !isFrontendEntry(entry) && !isUiEntry(entry))
  const frontendTotal = frontendEntries.reduce((total, entry) => total + entry.cost_usd, 0)
  const uiTotal = uiEntries.reduce((total, entry) => total + entry.cost_usd, 0)
  const backendTotal = backendEntries.reduce((total, entry) => total + entry.cost_usd, 0)
  const totalTokens = development.reduce((total, entry) => total + tokenTotal(entry), 0)
  const rate = tokenRate(devTotal, totalTokens)
  const completedPhases = new Set(development.map((entry) => entry.phase).filter((phase) => /^P\d{2}$/.test(phase)))
  const avgPhase = completedPhases.size > 0 ? devTotal / completedPhases.size : 0
  const projection = avgPhase * 19
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
      status: 'Trackable when OpenAI API usage is connected',
      attribution: 'Needs Docmee metadata or DevTools capture',
      entries: codexRuntimeToday.length,
      tokens: codexRuntimeToday.reduce((total, entry) => total + (entry.tokens ?? 0), 0),
      cost: codexRuntimeToday.reduce((total, entry) => total + entry.usd, 0),
      notes: 'Not counted as Docmee without marker.'
    },
    {
      source: 'ChatGPT / Codex product usage',
      status: 'Depends on authenticated product usage access',
      attribution: 'Docmee only when logged here',
      entries: codexEntries.length,
      tokens: codexEntries.reduce((total, entry) => total + tokenTotal(entry), 0),
      cost: codexSupportTotal,
      notes: 'Uses codex-pro DevTools sessions.'
    },
    {
      source: 'Current Codex chat',
      status: 'Marked as Docmee support now',
      attribution: 'Docmee support marker here',
      entries: currentChatEntries.length,
      tokens: currentChatEntries.reduce((total, entry) => total + tokenTotal(entry), 0),
      cost: currentChatEntries.reduce((total, entry) => total + entry.cost_usd, 0),
      notes: 'Exact usage pending.'
    },
    {
      source: 'Since Saturday last week',
      status: 'Retrieved from local Codex session usage',
      attribution: `Current thread since ${codexSince.since.toLocaleDateString()}`,
      entries: codexSince.events,
      tokens: codexSince.total,
      cost: 0,
      notes: 'Product-plan cost not exposed locally.'
    }
  ]
  const featureRows = features.map((feature) => {
    const entries = development.filter((entry) => matchesFeature(entry, feature))
    const backendCost = entries.filter((entry) => !isFrontendEntry(entry) && !isUiEntry(entry)).reduce((total, entry) => total + entry.cost_usd, 0)
    const frontendCost = entries.filter(isFrontendEntry).reduce((total, entry) => total + entry.cost_usd, 0)
    const uiCost = entries.filter(isUiEntry).reduce((total, entry) => total + entry.cost_usd, 0)
    return {
      req: `Req ${feature.id}`,
      feature: feature.feature,
      backend: feature.backendStatus ?? feature.status,
      frontend: feature.frontendStatus ?? 'pending',
      sessions: entries.length,
      tokens: entries.reduce((total, entry) => total + tokenTotal(entry), 0),
      backendCost,
      frontendCost,
      uiCost,
      totalCost: backendCost + frontendCost + uiCost
    }
  })
  const phaseRows = phases.map((phase) => {
    const entries = development.filter((entry) => entry.phase === phase)
    const claude = entries.filter((entry) => entry.tool === 'claude-code').reduce((total, entry) => total + entry.cost_usd, 0)
    const codex = entries.filter((entry) => entry.tool === 'codex-pro').reduce((total, entry) => total + entry.cost_usd, 0)
    const total = entries.reduce((sum, entry) => sum + entry.cost_usd, 0)
    return {
      phase,
      claude,
      codex,
      other: Math.max(total - claude - codex, 0),
      total,
      status: entries.length > 0 ? 'tracked' : 'pending'
    }
  })

  const report = createReportBuilder()
  report.table([
    { label: 'Metric', width: 230, value: (row: { metric: string; value: string }) => row.metric },
    { label: 'Value', width: 470, value: (row) => row.value }
  ], [
    { metric: 'Cost to date', value: money(devTotal) },
    { metric: 'Backend cost', value: money(backendTotal) },
    { metric: 'Frontend cost', value: money(frontendTotal) },
    { metric: 'UI development cost', value: money(uiTotal) },
    { metric: 'Projected total', value: `~${money(projection)}` },
    { metric: 'Phases tracked', value: `${completedPhases.size}/19` },
    { metric: 'Development entries', value: development.length.toLocaleString() },
    { metric: 'Frontend entries', value: frontendEntries.length.toLocaleString() },
    { metric: 'UI entries', value: uiEntries.length.toLocaleString() },
    { metric: 'Tokens tracked', value: totalTokens.toLocaleString() },
    { metric: 'Estimated cost per token', value: money(rate.perToken, 8) },
    { metric: 'Estimated cost per 1K tokens', value: money(rate.perThousand, 6) },
    { metric: 'Estimated cost per 1M tokens', value: money(rate.perMillion, 4) },
    { metric: 'Exchange rate', value: `1 USD = ${exchange.rates.CAD.toFixed(4)} CAD / ${exchange.rates.GTQ.toFixed(4)} GTQ | Display: ${display.toUpperCase()}` }
  ], { title: 'Overall Cost', rowHeight: 19 })

  report.table([
    { label: 'Req', width: 38, value: (row: typeof featureRows[number]) => row.req },
    { label: 'Feature', width: 168, value: (row) => row.feature },
    { label: 'Backend', width: 54, value: (row) => row.backend },
    { label: 'Frontend', width: 58, value: (row) => row.frontend },
    { label: 'Sessions', width: 46, value: (row) => String(row.sessions), align: 'right' },
    { label: 'Tokens', width: 66, value: (row) => row.tokens.toLocaleString(), align: 'right' },
    { label: 'Backend Cost', width: 72, value: (row) => tableMoney(row.backendCost), align: 'right' },
    { label: 'Frontend Cost', width: 74, value: (row) => tableMoney(row.frontendCost), align: 'right' },
    { label: 'UI Cost', width: 62, value: (row) => tableMoney(row.uiCost), align: 'right' },
    { label: 'Total', width: 62, value: (row) => tableMoney(row.totalCost), align: 'right' }
  ], featureRows, { title: 'Feature Cost Monitor', rowHeight: 18 })

  report.table([
    { label: 'Phase', width: 70, value: (row: typeof phaseRows[number]) => row.phase },
    { label: 'Claude Code', width: 130, value: (row) => tableMoney(row.claude), align: 'right' },
    { label: 'Codex Pro', width: 130, value: (row) => tableMoney(row.codex), align: 'right' },
    { label: 'Other', width: 130, value: (row) => tableMoney(row.other), align: 'right' },
    { label: 'Total', width: 130, value: (row) => tableMoney(row.total), align: 'right' },
    { label: 'Status', width: 110, value: (row) => row.status }
  ], phaseRows, { title: 'Cost by Phase', rowHeight: 18 })

  report.table([
    { label: 'Source', width: 110, value: (row: typeof supportRows[number]) => row.source },
    { label: 'Tracking Status', width: 170, value: (row) => row.status },
    { label: 'Docmee Attribution', width: 145, value: (row) => row.attribution },
    { label: 'Entries', width: 45, value: (row) => String(row.entries), align: 'right' },
    { label: 'Tokens', width: 70, value: (row) => row.tokens.toLocaleString(), align: 'right' },
    { label: 'Cost', width: 80, value: (row) => tableMoney(row.cost), align: 'right' },
    { label: 'Notes', width: 80, value: (row) => row.notes }
  ], supportRows, { title: 'Support Cost (Codex)', rowHeight: 20 })

  const pdf = buildPdf(report.finish())
  return new Response(pdf, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="docmee-development-cost-${new Date().toISOString().slice(0, 10)}.pdf"`,
      'cache-control': 'no-store'
    }
  })
}
