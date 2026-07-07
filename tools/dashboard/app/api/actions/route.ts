import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import { NextResponse } from 'next/server'
import { scanSentinel } from '../../lib/sentinel'
import { readCustomAis, writeCustomAis, slugifyAiId } from '../../lib/custom-ais'

const toolsRoot = path.resolve(process.cwd(), '..')
const repoRoot = path.resolve(toolsRoot, '..')
const startReadinessFile = path.join(toolsRoot, 'logs', 'start-readiness.json')
// Each build lane gets its own start-readiness file so running the start check on
// one lane no longer wipes the "passed" state of the others. build-control keeps
// the legacy default file (also read by the install-monitor/ready/healer views).
function startReadinessFileFor(workflow: string) {
  return workflow && workflow !== 'build-control'
    ? path.join(toolsRoot, 'logs', `start-readiness-${workflow}.json`)
    : startReadinessFile
}
const logsRoot = path.join(toolsRoot, 'logs')
const runtimeRoot = path.join(toolsRoot, 'runtime')
const buildRunFile = path.join(logsRoot, 'build-run.json')
const featureRunFile = path.join(logsRoot, 'feature-run.json')
const frontendRunFile = path.join(logsRoot, 'frontend-run.json')
const uiRunFile = path.join(logsRoot, 'ui-run.json')
const backlogRunFile = path.join(logsRoot, 'backlog-run.json')
const claudeUsageGuardFile = path.join(logsRoot, 'claude-usage-guard.json')
const appLaunchFile = path.join(logsRoot, 'app-launch.json')
const postDeploymentFile = path.join(logsRoot, 'post-deployment.json')
const featureCoverageFile = path.join(logsRoot, 'rev1-feature-coverage.json')
const deploymentRecordsFile = path.join(logsRoot, 'docmee-deployment-records.json')
const developmentSourcesFile = path.join(logsRoot, 'development-sources.json')
const sentinelAuditFile = path.join(logsRoot, 'sentinel-audit.json')
const enhancementsFile = path.join(logsRoot, 'enhancements.json')
const designAuditRecordsFile = path.join(logsRoot, 'design-audit-records.json')
const uiDevelopmentRecordsFile = path.join(logsRoot, 'ui-development-records.json')
const promptsDir = path.join(toolsRoot, 'prompts')
const claudeDesignRunFile = path.join(logsRoot, 'design-run.json')
const claudeDesignPromptFile = path.join(promptsDir, 'CLAUDE-DESIGN-RUN.md')
const mockupsDir = path.join(logsRoot, 'mockups')
const savedMockupsDir = path.join(toolsRoot, 'mockup-library')

// Mirrors screenMockupPrompt in docmee-audit/page.tsx — used to build the bulk
// "All Mock-up" queue so the CLI generates the exact same per-screen mockups.
function screenMockupPrompt(item: { id: number; screen: string; phase: string; featuresCovered: string; nextStep: string }) {
  return `Generate a high-fidelity, self-contained HTML mockup of Docmee UI Screen ${item.id}: ${item.screen} for visual approval. Do NOT modify any product code and do NOT commit.

Write the mockup to exactly this path (create the folder if needed): tools/logs/mockups/screen-${item.id}.html

Product: Docmee, a medical-clinic AI booking and patient-communication platform.
Screen: ${item.screen}
Phase: ${item.phase}
Features covered: ${item.featuresCovered}
Context: ${item.nextStep}

Mockup rules:
- A single self-contained .html file with inline CSS only — no external/network assets — so it renders standalone in an iframe.
- High-fidelity, realistic content in a quiet, professional medical-SaaS style.
- Show the desktop layout, then a phone-width section below it for the responsive reflow.
- Show the key states that matter for this screen (empty, loading, error, success) where relevant.
- Make patient safety, bot mode, human mode, urgent status, assignment, and handoff visually unmistakable.
- Use realistic English labels with a few Spanish examples.
- This is a visual mockup for approval only: no JavaScript behaviour, no product code changes.

Output: only create/overwrite tools/logs/mockups/screen-${item.id}.html, then stop.`
}

// Mirrors screenDesignPrompt in docmee-audit/page.tsx — the per-screen build
// prompt used by the bulk "Approve & Build all" queue.
function screenDesignPrompt(item: { id: number; screen: string; phase: string; featuresCovered: string; priority: string; nextStep: string }) {
  return `Implement Docmee UI Screen ${item.id}: ${item.screen} from the approved Claude Design mockup provided below.

Product: Docmee, a medical-clinic AI booking and patient-communication platform.

Screen: ${item.screen}
Phase: ${item.phase}
Features covered: ${item.featuresCovered}
Priority: ${item.priority}
Current next step: ${item.nextStep}

Requirements:
- Implement the approved mockup EXACTLY in the Docmee product (apps/inboxos) — real, usable UI, not a placeholder.
- Quiet professional medical SaaS style; English and Spanish labels must both fit; mobile must be a real responsive reflow.
- Include empty, loading, error, offline/disconnected, permission-denied, and success states.
- Make patient safety, bot mode, human mode, urgent status, assignment, and handoff visually unmistakable.
- Run relevant local checks, commit the work with a clear message, and set this screen's status to needs-review in tools/logs/ui-development-records.json.`
}
const docmeeUpdateFile = path.join(logsRoot, 'docmee-technology-update.json')
const codexAccountFile = path.join(logsRoot, 'codex-account.json')
const costFile = path.join(logsRoot, 'cost.json')
const envFile = path.join(toolsRoot, '.env.tools')
const deployResetArchiveRoot = path.join(logsRoot, 'reset-archive')
const phaseIds = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12', 'P13', 'P14', 'P15', 'P16', 'P17', 'P18', 'P19']

type PostDeploymentCheck = {
  name: string
  status: 'pass' | 'warning' | 'fail'
  message: string
  detail?: string
}
type DevelopmentLane = 'backend' | 'frontend' | 'ui'
type DevelopmentSources = Partial<Record<DevelopmentLane, { url: string; syncedAt?: string; status?: string; message?: string; itemCount?: number }>>
type NotionBlock = {
  id: string
  type: string
  has_children?: boolean
  paragraph?: { rich_text?: NotionRichText[] }
  heading_1?: { rich_text?: NotionRichText[] }
  heading_2?: { rich_text?: NotionRichText[] }
  heading_3?: { rich_text?: NotionRichText[] }
  bulleted_list_item?: { rich_text?: NotionRichText[] }
  numbered_list_item?: { rich_text?: NotionRichText[] }
  to_do?: { rich_text?: NotionRichText[] }
  quote?: { rich_text?: NotionRichText[] }
  callout?: { rich_text?: NotionRichText[] }
  table_row?: { cells?: NotionRichText[][] }
  code?: { rich_text?: NotionRichText[] }
}
type NotionRichText = { plain_text?: string }
type NotionPageText = { text: string; rows: string[][] }
type QueueFeature = {
  id: number
  phase: string
  area: string
  feature: string
  status: 'complete' | 'partial' | 'missing'
  backendStatus?: 'complete' | 'pending' | 'needs-audit'
  frontendStatus?: 'complete' | 'pending' | 'needs-audit'
  priority: 'critical' | 'high' | 'medium' | 'low'
  evidence: string
  nextStep: string
}
type UiQueueItem = {
  id: number
  screen: string
  phase: string
  featuresCovered: string
  status: 'complete' | 'planned' | 'running' | 'needs-review'
  priority: 'critical' | 'high' | 'medium' | 'low'
  source: string
  nextStep: string
  wiringConfidence?: number
  wiringReason?: string
  wiringCheckedAt?: string
}

type CheckResponse = PostDeploymentCheck & { rawBody?: string }

type PostDeploymentRun = {
  id: string
  createdAt: string
  summary: { pass: number; warning: number; fail: number }
  checks: PostDeploymentCheck[]
  target?: 'local' | 'vps' | 'env'
}

type DocmeeUpdateStep = {
  name: string
  status: 'pass' | 'warning' | 'fail'
  message: string
}

type DocmeeTechnologyUpdateRun = {
  id: string
  createdAt: string
  status: 'planned' | 'local-passed' | 'local-failed'
  summary: string
  steps: DocmeeUpdateStep[]
}

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

type CostStore = {
  runtime?: unknown[]
  development?: DevCostEntry[]
}

type StageStatus = 'complete' | 'pending' | 'needs-audit'
type DeploymentFeature = {
  status?: string
  backendStatus?: StageStatus
  frontendStatus?: StageStatus
}
type StartReadiness = {
  createdAt?: string
  phase?: string
  ready?: boolean
  steps?: Array<{ name: string; status: 'pass' | 'fail'; message: string }>
}

function pnpmCommand() {
  if (process.platform !== 'win32') return 'pnpm'
  const localAppData = process.env.LOCALAPPDATA
  const pnpmExe = localAppData ? path.join(localAppData, 'pnpm', 'pnpm.exe') : ''
  return pnpmExe && existsSync(pnpmExe) ? pnpmExe : 'pnpm.exe'
}

function redirect(request: Request, key: 'message' | 'error', value: string, targetPath?: string) {
  const referer = request.headers.get('referer') ?? 'http://127.0.0.1:4000/settings'
  const url = targetPath?.startsWith('/') && !targetPath.startsWith('//')
    ? new URL(targetPath, referer)
    : new URL(referer)
  url.searchParams.set(key, value)
  return NextResponse.redirect(url, 303)
}

function runTool(args: string[]) {
  const result = spawnSync(pnpmCommand(), ['tool', ...args], {
    cwd: toolsRoot,
    encoding: 'utf8',
    shell: false,
    stdio: 'pipe',
    windowsHide: true
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  return { ok: result.status === 0, output }
}

function runRepo(args: string[]) {
  const result = spawnSync(pnpmCommand(), args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    stdio: 'pipe',
    windowsHide: true
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  return { ok: result.status === 0, output }
}

function codexHome() {
  return path.join(process.env.USERPROFILE || process.env.HOME || '', '.codex')
}

function openCodexApp() {
  if (process.platform === 'win32') {
    const child = spawn('explorer.exe', ['shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.unref()
    return true
  }
  return false
}

function writeCodexAccountStatus(status: string, message: string) {
  writeFileSync(codexAccountFile, JSON.stringify({
    status,
    message,
    updatedAt: new Date().toISOString()
  }, null, 2))
}

function backupCodexAuth() {
  const home = codexHome()
  if (!home) return { ok: false, message: 'Codex home folder was not found.' }
  const authFile = path.join(home, 'auth.json')
  if (!existsSync(authFile)) {
    writeCodexAccountStatus('signed-out', 'No Codex auth file was present. Open Codex to sign in.')
    return { ok: true, message: 'Codex is already signed out on this machine.' }
  }
  const backupDir = path.join(home, 'auth-backups')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupFile = path.join(backupDir, `auth-${stamp}.json`)
  try {
    mkdirSync(backupDir, { recursive: true })
    renameSync(authFile, backupFile)
    writeCodexAccountStatus('signed-out', 'Codex auth was backed up. Open Codex and sign in with the desired account.')
    return { ok: true, message: 'Codex was signed out locally. Open Codex to sign in again.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

function writeDocmeeUpdate(run: DocmeeTechnologyUpdateRun) {
  const runs = readJson<DocmeeTechnologyUpdateRun[]>(docmeeUpdateFile, [])
  writeFileSync(docmeeUpdateFile, JSON.stringify([run, ...runs].slice(0, 25), null, 2))
  return run
}

function recordCurrentCodexChatSupport() {
  const existing = readJson<CostStore | DevCostEntry[]>(costFile, { runtime: [], development: [] })
  const store: CostStore = Array.isArray(existing)
    ? { runtime: existing, development: [] }
    : { runtime: existing.runtime ?? [], development: existing.development ?? [] }
  const id = 'support-codex-chat-docmee-current'
  const now = new Date().toISOString()
  const withoutCurrent = (store.development ?? []).filter((entry) => entry.id !== id)
  const entry: DevCostEntry = {
    id,
    timestamp: now,
    phase: 'SUPPORT',
    feature: 'Codex chat support for Docmee',
    tool: 'codex-pro',
    model: 'codex-chat',
    session_minutes: 0,
    input_tokens: 0,
    output_tokens: 0,
    cached_tokens: 0,
    cost_usd: 0,
    capture_method: 'attributed-pending',
    notes: 'docmee_support_chat=true; project=docmee; source=docmee-devtools; exact Codex chat usage/cost pending authenticated product usage access.'
  }
  writeFileSync(costFile, JSON.stringify({
    runtime: store.runtime ?? [],
    development: [...withoutCurrent, entry].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  }, null, 2))
}

function docmeeUpdateDiscordMessage(run: DocmeeTechnologyUpdateRun) {
  const lines = [
    'Docmee technology update workflow changed.',
    `Status: ${run.status}`,
    `Summary: ${run.summary}`,
    `Recorded: ${new Date(run.createdAt).toLocaleString()}`,
    '',
    'Steps:',
    ...run.steps.map((step) => `- ${step.status.toUpperCase()}: ${step.name} - ${step.message}`)
  ]
  return lines.join('\n').slice(0, 1800)
}

function createDocmeeUpdatePlan() {
  const run: DocmeeTechnologyUpdateRun = {
    id: `docmee-update-${Date.now()}`,
    createdAt: new Date().toISOString(),
    status: 'planned',
    summary: 'Docmee updates will be reviewed, built locally, verified locally, then deployed to VPS only after local validation passes.',
    steps: [
      { name: 'Scan technology stack', status: 'warning', message: 'Refresh Stack Intelligence before selecting package updates.' },
      { name: 'Review impact', status: 'warning', message: 'Classify each update as frontend, backend, database, worker, deployment, or service integration.' },
      { name: 'Build locally first', status: 'warning', message: 'Run local install, typecheck, and build before VPS deployment.' },
      { name: 'Verify locally', status: 'warning', message: 'Run local functionality and post-deployment checks after the build.' },
      { name: 'Deploy to VPS', status: 'warning', message: 'Allowed only after local validation passes.' },
      { name: 'Verify VPS', status: 'warning', message: 'Run VPS verification, Discord notification, and report export after deployment.' }
    ]
  }
  return writeDocmeeUpdate(run)
}

function runDocmeeLocalUpdateValidation() {
  const checks: Array<{ name: string; args: string[] }> = [
    { name: 'Install lockfile check', args: ['install', '--frozen-lockfile'] },
    { name: 'Typecheck', args: ['typecheck'] },
    { name: 'Build', args: ['build'] }
  ]
  const steps: DocmeeUpdateStep[] = []
  for (const check of checks) {
    const result = runRepo(check.args)
    steps.push({
      name: check.name,
      status: result.ok ? 'pass' : 'fail',
      message: result.ok ? `${check.name} passed.` : shortOutput(result.output) || `${check.name} failed.`
    })
    if (!result.ok) break
  }
  const failed = steps.some((step) => step.status === 'fail')
  return writeDocmeeUpdate({
    id: `docmee-update-${Date.now()}`,
    createdAt: new Date().toISOString(),
    status: failed ? 'local-failed' : 'local-passed',
    summary: failed
      ? 'Local validation failed. VPS deployment remains blocked for this update.'
      : 'Local validation passed. This update can move to local functionality checks and then VPS deployment.',
    steps
  })
}

function shortOutput(output: string) {
  return output.replace(/\s+/g, ' ').trim().slice(0, 220)
}

function dockerOutput(output: string) {
  const cleaned = output
    .split(/\r?\n/)
    .filter((line) => !line.includes('the attribute `version` is obsolete'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (cleaned || output.replace(/\s+/g, ' ').trim()).slice(0, 320)
}

function readJson<T>(file: string, fallback: T) {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function parseEnvFile(file: string) {
  if (!existsSync(file)) return {} as Record<string, string>
  return Object.fromEntries(readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=')
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^["']|["']$/g, '')]
    }))
}

function readToolsEnv() {
  return parseEnvFile(envFile)
}

// The Docmee APP env lives at the repo root (template .env.example). Prefer a real
// filled file if present, else fall back to the template. Production env readiness
// validates THIS file, not tools/.env.tools (which is the DevTools/VPS config).
const appEnvCandidates = ['.env.production', '.env', '.env.example']
function appEnvPath() {
  for (const name of appEnvCandidates) {
    const candidate = path.join(repoRoot, name)
    if (existsSync(candidate)) return candidate
  }
  return path.join(repoRoot, '.env.example')
}
function readAppEnv() {
  return parseEnvFile(appEnvPath())
}

function plainText(items?: NotionRichText[]) {
  return (items ?? []).map((item) => item.plain_text ?? '').join('')
}

function blockText(block: NotionBlock) {
  if (block.type === 'paragraph') return plainText(block.paragraph?.rich_text)
  if (block.type === 'heading_1') return plainText(block.heading_1?.rich_text)
  if (block.type === 'heading_2') return plainText(block.heading_2?.rich_text)
  if (block.type === 'heading_3') return plainText(block.heading_3?.rich_text)
  if (block.type === 'bulleted_list_item') return plainText(block.bulleted_list_item?.rich_text)
  if (block.type === 'numbered_list_item') return plainText(block.numbered_list_item?.rich_text)
  if (block.type === 'to_do') return plainText(block.to_do?.rich_text)
  if (block.type === 'quote') return plainText(block.quote?.rich_text)
  if (block.type === 'callout') return plainText(block.callout?.rich_text)
  if (block.type === 'code') return plainText(block.code?.rich_text)
  if (block.type === 'table_row') return (block.table_row?.cells ?? []).map((cell) => plainText(cell)).join(' | ')
  return ''
}

function notionPageId(input: string) {
  const compact = input.match(/[0-9a-f]{32}/i)?.[0]
  if (compact) return compact.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
  const dashed = input.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]
  return dashed ?? input.trim()
}

async function notionRequest<T>(apiKey: string, url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28'
    },
    cache: 'no-store'
  })
  if (!response.ok) throw new Error(`Notion returned ${response.status}`)
  return response.json() as Promise<T>
}

async function fetchNotionPageText(pageUrl: string, apiKey: string): Promise<NotionPageText> {
  const rows: string[][] = []
  const lines: string[] = []

  async function visit(blockId: string) {
    let cursor = ''
    do {
      const query = cursor ? `?page_size=100&start_cursor=${encodeURIComponent(cursor)}` : '?page_size=100'
      const data = await notionRequest<{ results?: NotionBlock[]; has_more?: boolean; next_cursor?: string | null }>(
        apiKey,
        `https://api.notion.com/v1/blocks/${blockId}/children${query}`
      )
      for (const block of data.results ?? []) {
        if (block.type === 'table_row') rows.push((block.table_row?.cells ?? []).map((cell) => plainText(cell).trim()))
        const text = blockText(block).trim()
        if (text) lines.push(text)
        if (block.has_children) await visit(block.id)
      }
      cursor = data.has_more && data.next_cursor ? data.next_cursor : ''
    } while (cursor)
  }

  await visit(notionPageId(pageUrl))
  return { text: lines.join('\n'), rows }
}

function sourceSettings() {
  return readJson<DevelopmentSources>(developmentSourcesFile, {})
}

function writeSourceSettings(settings: DevelopmentSources) {
  mkdirSync(logsRoot, { recursive: true })
  writeFileSync(developmentSourcesFile, JSON.stringify(settings, null, 2))
}

function normalizeStageStatus(value: string): 'complete' | 'pending' | 'needs-audit' | null {
  const text = value.toLowerCase()
  if (text.includes('complete') || text.includes('accepted') || text.includes('done')) return 'complete'
  if (text.includes('audit') || text.includes('review')) return 'needs-audit'
  if (text.includes('pending') || text.includes('missing') || text.includes('planned') || text.includes('partial')) return 'pending'
  return null
}

function syncUiQueueFromNotion(page: NotionPageText, sourceUrl: string) {
  const current = readJson<UiQueueItem[]>(uiDevelopmentRecordsFile, [])
  const byId = new Map(current.map((item) => [item.id, item]))
  const rows = page.rows
    .map((row) => row.map((cell) => cell.trim()))
    .filter((row) => /^\d+$/.test(row[0] ?? '') && row.length >= 4)
  const next = rows.map((row) => {
    const id = Number(row[0])
    const existing = byId.get(id)
    const screen = row[1] || existing?.screen || `Screen ${id}`
    const phase = row[2] || existing?.phase || '1'
    const featuresCovered = (row[3] || existing?.featuresCovered || '').replace(/\*/g, '')
    const promptMatch = page.text.match(new RegExp(`(?:Screen:\\s*)?${screen.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]{0,700}`, 'i'))
    const nextStep = existing?.nextStep || (promptMatch ? `Design and implement ${screen} from the linked Notion source.` : `Review the linked Notion source and build ${screen}.`)
    return {
      id,
      screen,
      phase,
      featuresCovered,
      status: existing?.status ?? 'planned',
      priority: existing?.priority ?? (Number(phase) === 1 ? 'critical' : Number(phase) === 2 ? 'high' : 'medium'),
      source: sourceUrl,
      nextStep
    } satisfies UiQueueItem
  })
  if (next.length === 0) throw new Error('No 17-screen UI table rows were found in the Notion source.')
  writeFileSync(uiDevelopmentRecordsFile, JSON.stringify(next.sort((a, b) => a.id - b.id), null, 2))
  return next.length
}

function syncStageQueueFromNotion(lane: 'backend' | 'frontend', page: NotionPageText, sourceUrl: string) {
  const current = readJson<QueueFeature[]>(featureCoverageFile, [])
  const byId = new Map(current.map((item) => [item.id, item]))
  let updates = 0
  for (const row of page.rows.map((item) => item.map((cell) => cell.trim())).filter((item) => /^\d+$/.test(item[0] ?? ''))) {
    const id = Number(row[0])
    const existing = byId.get(id)
    if (!existing) continue
    const joined = row.join(' | ')
    const stageStatus = normalizeStageStatus(joined)
    const detail = row.slice(1).filter(Boolean).join(' | ')
    const sourceNote = `Notion source (${new Date().toISOString()}): ${sourceUrl} | ${detail}`
    byId.set(id, {
      ...existing,
      backendStatus: lane === 'backend' ? stageStatus ?? existing.backendStatus : existing.backendStatus,
      frontendStatus: lane === 'frontend' ? stageStatus ?? existing.frontendStatus : existing.frontendStatus,
      evidence: lane === 'backend' && detail ? `${existing.evidence}\n\n${sourceNote}` : existing.evidence,
      nextStep: lane === 'frontend' && detail ? `${existing.nextStep}\n\n${sourceNote}` : existing.nextStep
    })
    updates += 1
  }
  if (updates === 0) throw new Error(`No parseable ${lane} queue rows were found in the Notion source.`)
  const next = Array.from(byId.values()).sort((a, b) => a.id - b.id)
  writeFileSync(featureCoverageFile, JSON.stringify(next, null, 2))
  return updates || next.length
}

async function setDevelopmentSource(lane: DevelopmentLane, sourceUrl: string) {
  const env = readToolsEnv()
  const apiKey = env.NOTION_API_KEY || process.env.NOTION_API_KEY
  if (!apiKey) throw new Error('NOTION_API_KEY is missing in Settings.')
  const page = await fetchNotionPageText(sourceUrl, apiKey)
  const itemCount = lane === 'ui'
    ? syncUiQueueFromNotion(page, sourceUrl)
    : syncStageQueueFromNotion(lane, page, sourceUrl)
  const settings = sourceSettings()
  settings[lane] = {
    url: sourceUrl,
    syncedAt: new Date().toISOString(),
    status: 'synced',
    message: `Synced ${itemCount} queue item${itemCount === 1 ? '' : 's'} from Notion.`,
    itemCount
  }
  writeSourceSettings(settings)
  return itemCount
}

function appendPostDeploymentRun(checks: PostDeploymentCheck[], target: 'local' | 'vps' | 'env' = 'local') {
  const runs = readJson<PostDeploymentRun[]>(postDeploymentFile, [])
  const summary = {
    pass: checks.filter((check) => check.status === 'pass').length,
    warning: checks.filter((check) => check.status === 'warning').length,
    fail: checks.filter((check) => check.status === 'fail').length
  }
  const run: PostDeploymentRun = {
    id: `post-${Date.now()}`,
    createdAt: new Date().toISOString(),
    summary,
    checks,
    target
  }
  writeFileSync(postDeploymentFile, JSON.stringify([run, ...runs].slice(0, 50), null, 2))
  return run
}

function isLocalRuntimeValue(value: string) {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(value)
}

function configuredMessage(name: string) {
  return `${name} is configured. Secret value is hidden.`
}

function requiredEnvCheck(env: Record<string, string>, name: string, label = name): PostDeploymentCheck {
  return env[name]?.trim()
    ? { name: label, status: 'pass', message: configuredMessage(label) }
    : { name: label, status: 'fail', message: `${label} is missing.` }
}

function runEnvReadinessChecks() {
  const env = readAppEnv()        // app secrets/config from the repo-root .env (Docmee app env)
  const toolsEnv = readToolsEnv() // deploy connectivity (VPS_*) lives in tools/.env.tools
  const checks: PostDeploymentCheck[] = []
  const databaseUrl = env.DATABASE_URL?.trim() ?? ''
  const supabaseUrl = env.SUPABASE_URL?.trim() ?? ''
  const redisUrl = env.REDIS_URL?.trim() ?? ''
  const appUrl = (env.APP_URL || env.PERMANENT_DOMAIN_URL || env.NGROK_URL || env.VPS_DOMAIN || '').trim()
  const jwtSecret = (env.JWT_SECRET || env.JWT_ACCESS_SECRET || '').trim()
  const jwtRefreshSecret = env.JWT_REFRESH_SECRET?.trim() ?? ''

  checks.push({
    name: 'DATABASE_URL',
    status: !databaseUrl
      ? 'fail'
      : !/^postgres(ql)?:\/\//i.test(databaseUrl)
        ? 'fail'
        : isLocalRuntimeValue(databaseUrl)
          ? 'warning'
          : 'pass',
    message: !databaseUrl
      ? 'DATABASE_URL is missing.'
      : !/^postgres(ql)?:\/\//i.test(databaseUrl)
        ? 'DATABASE_URL must be a Postgres connection string.'
        : isLocalRuntimeValue(databaseUrl)
          ? 'DATABASE_URL points to local database. Use Supabase Postgres before VPS deployment.'
          : 'DATABASE_URL is configured for a remote Postgres database.'
  })

  checks.push({
    name: 'SUPABASE_URL',
    status: !supabaseUrl ? 'fail' : /^https:\/\/[^/]+\.supabase\.co\/?$/i.test(supabaseUrl) ? 'pass' : 'warning',
    message: !supabaseUrl
      ? 'SUPABASE_URL is missing.'
      : /^https:\/\/[^/]+\.supabase\.co\/?$/i.test(supabaseUrl)
        ? 'SUPABASE_URL points to Supabase Cloud.'
        : 'SUPABASE_URL is present but does not look like a Supabase Cloud URL.'
  })
  checks.push(requiredEnvCheck(env, 'SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY'))
  checks.push(requiredEnvCheck(env, 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'))

  checks.push({
    name: 'REDIS_URL',
    status: !redisUrl
      ? 'fail'
      : /^redis(s)?:\/\//i.test(redisUrl)
        ? 'pass'
        : 'fail',
    message: !redisUrl
      ? 'REDIS_URL is missing.'
      : /^redis(s)?:\/\//i.test(redisUrl)
        ? isLocalRuntimeValue(redisUrl)
          ? 'REDIS_URL is configured for VPS-local Redis.'
          : 'REDIS_URL is configured for a remote Redis service.'
        : 'REDIS_URL must start with redis:// or rediss://.'
  })

  checks.push({
    name: 'NODE_ENV',
    status: env.NODE_ENV === 'production' ? 'pass' : 'warning',
    message: env.NODE_ENV === 'production'
      ? 'NODE_ENV is set to production.'
      : 'NODE_ENV is not production. Set it to production before final VPS deployment.'
  })
  checks.push({
    name: 'LLM_STUB',
    status: env.LLM_STUB === 'false' ? 'pass' : 'warning',
    message: env.LLM_STUB === 'false'
      ? 'LLM_STUB is disabled for real AI responses.'
      : 'LLM_STUB is not false. Disable it before production use.'
  })
  checks.push({
    name: 'APP_URL',
    status: !appUrl ? 'fail' : isLocalRuntimeValue(appUrl) ? 'warning' : /^https?:\/\//i.test(appUrl) ? 'pass' : 'warning',
    message: !appUrl
      ? 'APP_URL or public URL is missing.'
      : isLocalRuntimeValue(appUrl)
        ? 'APP_URL points to localhost. Use ngrok or the permanent domain for VPS deployment.'
        : /^https?:\/\//i.test(appUrl)
          ? 'APP_URL/public URL is configured.'
          : 'APP_URL/public URL is present but should include http:// or https://.'
  })
  checks.push({
    name: 'JWT_SECRET',
    status: jwtSecret.length >= 32 && !/local|dev|secret/i.test(jwtSecret) ? 'pass' : 'fail',
    message: jwtSecret
      ? jwtSecret.length >= 32 && !/local|dev|secret/i.test(jwtSecret)
        ? configuredMessage('JWT_SECRET')
        : 'JWT_SECRET must be a strong production secret with at least 32 characters.'
      : 'JWT_SECRET is missing.'
  })
  checks.push({
    name: 'JWT_REFRESH_SECRET',
    status: jwtRefreshSecret.length >= 32 && jwtRefreshSecret !== jwtSecret && !/local|dev|secret/i.test(jwtRefreshSecret) ? 'pass' : 'fail',
    message: jwtRefreshSecret
      ? jwtRefreshSecret.length >= 32 && jwtRefreshSecret !== jwtSecret && !/local|dev|secret/i.test(jwtRefreshSecret)
        ? configuredMessage('JWT_REFRESH_SECRET')
        : 'JWT_REFRESH_SECRET must be strong, at least 32 characters, and different from JWT_SECRET.'
      : 'JWT_REFRESH_SECRET is missing.'
  })

  const missingVps = ['VPS_HOST', 'VPS_USER', 'VPS_SSH_KEY_PATH', 'VPS_DEPLOY_PATH'].filter((name) => !toolsEnv[name]?.trim())
  checks.push({
    name: 'VPS settings',
    status: missingVps.length > 0 ? 'fail' : 'pass',
    message: missingVps.length > 0
      ? `Missing VPS settings: ${missingVps.join(', ')}.`
      : 'VPS host, user, SSH key, and deploy path are configured.'
  })

  const failCount = checks.filter((check) => check.status === 'fail').length
  const warningCount = checks.filter((check) => check.status === 'warning').length
  checks.unshift({
    name: 'Production env readiness',
    status: failCount > 0 ? 'fail' : warningCount > 0 ? 'warning' : 'pass',
    message: failCount > 0
      ? `${failCount} required .env value${failCount === 1 ? '' : 's'} need attention before VPS deployment.`
      : warningCount > 0
        ? `.env has ${warningCount} warning${warningCount === 1 ? '' : 's'} to review before final production use.`
        : '.env is ready for production/VPS deployment.'
  })

  return appendPostDeploymentRun(checks, 'env')
}

function vpsBaseUrl(env: Record<string, string>) {
  const selected = env.PUBLIC_URL_MODE === 'ngrok'
    ? env.NGROK_URL
    : env.PUBLIC_URL_MODE === 'domain'
      ? env.PERMANENT_DOMAIN_URL || env.VPS_DOMAIN
      : env.APP_URL
  if (selected && /^https?:\/\//i.test(selected) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(selected)) {
    return selected.replace(/\/$/, '')
  }
  const configured = env.VPS_DOMAIN || env.VPS_HOST
  if (!configured) return ''
  if (/^https?:\/\//i.test(configured)) return configured.replace(/\/$/, '')
  return `${env.VPS_DOMAIN ? 'https' : 'http'}://${configured}`.replace(/\/$/, '')
}

function vpsSsh(args: string[], env: Record<string, string>) {
  const missing = ['VPS_HOST', 'VPS_USER', 'VPS_SSH_KEY_PATH', 'VPS_DEPLOY_PATH'].filter((name) => !env[name])
  if (missing.length > 0) {
    return { ok: false, output: `Missing VPS settings: ${missing.join(', ')}` }
  }
  const key = env.VPS_SSH_KEY_PATH.replace(/^~/, process.env.USERPROFILE || '')
  const target = `${env.VPS_USER}@${env.VPS_HOST}`
  const result = spawnSync('ssh', ['-i', key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', target, ...args], {
    encoding: 'utf8',
    shell: true,
    stdio: 'pipe',
    windowsHide: true
  })
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() }
}

async function fetchCheck(
  name: string,
  url: string,
  options: RequestInit = {},
  expectedStatus = 200
): Promise<CheckResponse> {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const body = await response.text()
    const elapsed = Date.now() - started
    return {
      name,
      status: response.status === expectedStatus ? 'pass' : 'fail',
      message: response.status === expectedStatus ? `HTTP ${response.status} in ${elapsed}ms` : `Expected HTTP ${expectedStatus}, got HTTP ${response.status}`,
      detail: body.slice(0, 500),
      rawBody: body
    }
  } catch (error) {
    return {
      name,
      status: 'fail',
      message: error instanceof Error ? error.message : String(error)
    }
  } finally {
    clearTimeout(timer)
  }
}

async function runPostDeploymentChecks() {
  const checks: PostDeploymentCheck[] = []

  const docker = spawnSync(process.platform === 'win32' ? 'docker.exe' : 'docker', ['info'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true
  })
  const dockerCheck: PostDeploymentCheck = {
    name: 'Docker engine',
    status: docker.status === 0 ? 'pass' : 'fail',
    message: docker.status === 0 ? 'Docker Desktop engine is running.' : dockerOutput(`${docker.stdout ?? ''}${docker.stderr ?? ''}`) || 'Docker Desktop engine is not running.'
  }
  checks.push(dockerCheck)

  const postgresReachable = await portOpen(5432)
  checks.push({
    name: 'Postgres port',
    status: postgresReachable ? 'pass' : 'fail',
    message: postgresReachable ? 'Postgres is reachable on localhost:5432.' : 'Postgres is not reachable on localhost:5432.'
  })
  const redisReachable = await portOpen(6379)
  checks.push({
    name: 'Redis port',
    status: redisReachable ? 'pass' : 'fail',
    message: redisReachable ? 'Redis is reachable on localhost:6379.' : 'Redis is not reachable on localhost:6379.'
  })
  if (dockerCheck.status === 'fail' && postgresReachable && redisReachable) {
    dockerCheck.status = 'warning'
    dockerCheck.message = 'Docker Desktop engine is unavailable, but portable Postgres and Redis are running for local deployment.'
  }
  checks.push({
    name: 'Inbox UI',
    status: await portOpen(3000) ? 'pass' : 'fail',
    message: await portOpen(3000) ? 'Inbox UI is reachable on localhost:3000.' : 'Inbox UI is not reachable on localhost:3000.'
  })
  checks.push({
    name: 'API port',
    status: await portOpen(3001) ? 'pass' : 'fail',
    message: await portOpen(3001) ? 'API is reachable on localhost:3001.' : 'API is not reachable on localhost:3001.'
  })

  checks.push(await fetchCheck('API health', 'http://127.0.0.1:3001/health'))
  checks.push(await fetchCheck('Login page', 'http://127.0.0.1:3000/login'))

  const login = await fetchCheck('Demo login', 'http://127.0.0.1:3001/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@demo-a.test', password: 'demo1234' })
  })
  let accessToken = ''
  let clinicId = ''
  if (login.status === 'pass' && login.detail) {
    try {
      const payload = JSON.parse(login.rawBody ?? login.detail) as { accessToken?: string; user?: { clinicId?: string } }
      accessToken = payload.accessToken ?? ''
      clinicId = payload.user?.clinicId ?? ''
      login.message = accessToken ? 'Demo login succeeded.' : 'Login response did not include an access token.'
      login.status = accessToken ? 'pass' : 'fail'
    } catch {
      login.status = 'fail'
      login.message = 'Login response was not valid JSON.'
    }
  }
  checks.push(login)

  if (accessToken) {
    const authHeaders = { authorization: `Bearer ${accessToken}` }
    checks.push(await fetchCheck('Conversations API', 'http://127.0.0.1:3001/conversations', { headers: authHeaders }))
    if (clinicId) {
      checks.push(await fetchCheck('Clinic team API', `http://127.0.0.1:3001/clinics/${clinicId}/team`, { headers: authHeaders }))
      checks.push(await fetchCheck('Clinic patients API', `http://127.0.0.1:3001/clinics/${clinicId}/patients`, { headers: authHeaders }))
      checks.push(await fetchCheck('Clinic metrics API', `http://127.0.0.1:3001/clinics/${clinicId}/metrics`, { headers: authHeaders }))
    } else {
      checks.push({ name: 'Clinic API checks', status: 'warning', message: 'Skipped because login did not return a clinic ID.' })
    }
  } else {
    checks.push({ name: 'Authenticated API checks', status: 'warning', message: 'Skipped because demo login failed.' })
  }

  return appendPostDeploymentRun(checks, 'local')
}

async function runVpsPostDeploymentChecks() {
  const env = readToolsEnv()
  const checks: PostDeploymentCheck[] = []
  const baseUrl = vpsBaseUrl(env)

  if (!baseUrl) {
    checks.push({ name: 'VPS target', status: 'fail', message: 'VPS_DOMAIN or VPS_HOST is missing.' })
    return appendPostDeploymentRun(checks, 'vps')
  }

  checks.push({ name: 'VPS target', status: 'pass', message: `Checking ${baseUrl}` })

  const sshStatus = vpsSsh(['"pwd; pm2 status; redis-cli ping; df -h; free -h"'], env)
  checks.push({
    name: 'VPS runtime status',
    status: sshStatus.ok ? 'pass' : 'fail',
    message: sshStatus.ok ? 'SSH runtime status completed.' : shortOutput(sshStatus.output) || 'SSH runtime status failed.',
    detail: sshStatus.output.slice(0, 1000)
  })

  checks.push(await fetchCheck('VPS login page', `${baseUrl}/login`))
  checks.push(await fetchCheck('VPS inbox page', `${baseUrl}/inbox`))

  const healthCandidates = [
    `${baseUrl}/health`,
    `${baseUrl}/api/health`,
    `http://${env.VPS_HOST}:3001/health`
  ].filter(Boolean)
  const healthResults: CheckResponse[] = []
  for (const url of healthCandidates) {
    const result = await fetchCheck(`VPS API health ${url}`, url)
    healthResults.push(result)
    if (result.status === 'pass') break
  }
  const healthPass = healthResults.find((result) => result.status === 'pass')
  checks.push(healthPass ?? {
    name: 'VPS API health',
    status: 'fail',
    message: healthResults.map((result) => `${result.name}: ${result.message}`).join(' | ').slice(0, 500)
  })

  return appendPostDeploymentRun(checks, 'vps')
}

function claudeSmokeBlocker(output: string) {
  try {
    const result = JSON.parse(output) as { categories?: Array<{ checks?: Array<{ name?: string; status?: string; message?: string; fix?: string }> }> }
    return result.categories
      ?.flatMap((category) => category.checks ?? [])
      .find((check) => check.name === 'Claude Code build smoke test' && check.status === 'critical')
  } catch {
    return undefined
  }
}

function saveStartReadiness(phase: string, steps: Array<{ name: string; status: 'pass' | 'fail'; message: string }>, workflow = 'build-control') {
  const failed = steps.find((step) => step.status === 'fail')
  writeFileSync(startReadinessFileFor(workflow), JSON.stringify({
    createdAt: new Date().toISOString(),
    phase,
    ready: !failed,
    steps
  }, null, 2))
  return !failed
}

function stageFor(item: DeploymentFeature, field: 'backendStatus' | 'frontendStatus'): StageStatus {
  const explicit = item[field]
  if (explicit === 'complete' || explicit === 'pending' || explicit === 'needs-audit') return explicit
  if (field === 'backendStatus') return item.status === 'complete' ? 'complete' : 'pending'
  return item.status === 'complete' ? 'needs-audit' : 'pending'
}

function summarizeStage(features: DeploymentFeature[], field: 'backendStatus' | 'frontendStatus') {
  const counts = features.reduce(
    (acc, item) => {
      const stage = stageFor(item, field)
      if (stage === 'needs-audit') acc.needsAudit += 1
      else acc[stage] += 1
      return acc
    },
    { complete: 0, pending: 0, needsAudit: 0 }
  )
  return { designedFeatures: features.length, ...counts }
}

function appendSentinelAudit(entry: { subsystem: string; action: string; outcome: string; message: string }) {
  const audit = readJson<Array<Record<string, unknown>>>(sentinelAuditFile, [])
  writeFileSync(sentinelAuditFile, JSON.stringify([{ ts: new Date().toISOString(), ...entry }, ...audit].slice(0, 200), null, 2))
}

function refreshDerivedDeploymentRecords() {
  const features = readJson<DeploymentFeature[]>(featureCoverageFile, [])
  if (features.length === 0) return { ok: false, message: 'No feature coverage records found.' }
  const backend = summarizeStage(features, 'backendStatus')
  const frontend = summarizeStage(features, 'frontendStatus')
  writeFileSync(deploymentRecordsFile, JSON.stringify({
    record: 'Docmee deployment stage grouping',
    updatedAt: new Date().toISOString().slice(0, 10),
    source: 'tools/logs/rev1-feature-coverage.json',
    landingPage: {
      title: 'Docmee Deployment',
      route: '/docmee-deployment',
      purpose: 'User chooses between the Backend deployment lane and the Frontend deployment lane before starting deployment review.'
    },
    sharedWorkflow: {
      enabled: true,
      purpose: 'Backend and Frontend use the same screen arrangement, guided workprocess, workflow steps, progress gauge, grouped records, and heartbeat-style stage monitor.',
      steps: ['Run readiness', 'Review grouped records', 'Verify or launch the stage', 'Deploy or verify VPS', 'Export report']
    },
    groups: [
      {
        id: 'backend',
        title: 'Docmee Deployment - Backend',
        route: '/docmee-deployment-backend',
        statusField: 'backendStatus',
        completeMeaning: 'Backend/local-code implementation is complete. Evidence comes from the completed feature coverage record.',
        detailFields: ['id', 'phase', 'area', 'feature', 'priority', 'backendStatus', 'evidence', 'nextStep'],
        summary: backend
      },
      {
        id: 'frontend',
        title: 'Docmee Deployment - Frontend',
        route: '/docmee-deployment-frontend',
        statusField: 'frontendStatus',
        completeMeaning: 'Frontend/product acceptance is complete only after the running app passes UI, mobile, workflow, language, and design review.',
        detailFields: ['id', 'phase', 'area', 'feature', 'priority', 'frontendStatus', 'evidence', 'nextStep'],
        summary: frontend
      }
    ],
    notes: [
      'Backend and frontend records are intentionally separate so backend completion does not overclaim product/UI readiness.',
      'The full completed item details remain in the feature coverage source record and are rendered by each deployment page.',
      'Frontend records remain incomplete until each visible screen, route, workflow, mobile layout, and EN/ES label set is accepted in the running app.'
    ]
  }, null, 2))

  const frontendReadinessFile = startReadinessFileFor('frontend-development')
  const readiness = readJson<StartReadiness>(frontendReadinessFile, { ready: false, steps: [] })
  const openFrontend = frontend.pending + frontend.needsAudit
  const message = openFrontend > 0 ? `${openFrontend} frontend item(s) need audit or acceptance.` : 'Frontend acceptance queue is clear.'
  const steps = readiness.steps ?? []
  const index = steps.findIndex((step) => step.name === 'Frontend Queue')
  const queueStep = { name: 'Frontend Queue', status: 'pass' as const, message }
  if (index >= 0) steps[index] = queueStep
  else steps.push(queueStep)
  writeFileSync(frontendReadinessFile, JSON.stringify({ ...readiness, steps }, null, 2))
  appendSentinelAudit({
    subsystem: 'healer',
    action: 'refresh-derived-deployment-records',
    outcome: 'success',
    message: `Derived records refreshed. Frontend ${frontend.complete}/${frontend.designedFeatures} complete, ${openFrontend} open.`
  })
  return { ok: true, message: 'Healer refreshed derived deployment records.' }
}

function runToolDetached(args: string[]) {
  const child = spawn(pnpmCommand(), ['tool', ...args], {
    cwd: toolsRoot,
    shell: false,
    stdio: 'ignore',
    detached: true,
    windowsHide: true
  })
  child.unref()
  return child.pid
}

function runRepoDetached(args: string[], extraEnv: Record<string, string> = {}) {
  const child = spawn(pnpmCommand(), args, {
    cwd: repoRoot,
    shell: false,
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
    env: { ...process.env, ...extraEnv }
  })
  child.unref()
  return child.pid
}

function openUrl(url: string) {
  if (process.platform === 'win32') {
    const child = spawn('explorer.exe', [url], { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
    return
  }
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open'
  const child = spawn(command, [url], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
}

function portOpen(port: number, host = '127.0.0.1') {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect(port, host)
    socket.setTimeout(900)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => resolve(false))
  })
}

function localRuntimeEnv() {
  return {
    DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5432/docmee',
    REDIS_URL: 'redis://127.0.0.1:6379',
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || 'local-dev-access-secret',
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'local-dev-refresh-secret',
    LLM_STUB: process.env.LLM_STUB || 'true'
  }
}

async function startPortableRuntime() {
  const steps: Array<{ name: string; status: 'pass' | 'warning' | 'fail'; message: string }> = []
  const pgBin = path.join(runtimeRoot, 'pgsql', 'bin')
  const pgData = path.join(runtimeRoot, 'pgdata')
  const pgCtl = path.join(pgBin, 'pg_ctl.exe')
  const initDb = path.join(pgBin, 'initdb.exe')
  const createdb = path.join(pgBin, 'createdb.exe')
  const pgLog = path.join(logsRoot, 'portable-postgres.log')
  const redisExe = path.join(runtimeRoot, 'redis', 'redis-server.exe')

  if (!existsSync(pgCtl) || !existsSync(initDb) || !existsSync(redisExe)) {
    return {
      ok: false,
      steps: [{ name: 'Portable runtime', status: 'fail' as const, message: 'Portable Postgres/Redis binaries are missing from tools/runtime.' }]
    }
  }

  if (!existsSync(pgData)) {
    const pwFile = path.join(runtimeRoot, 'pgpass.txt')
    writeFileSync(pwFile, 'postgres')
    const init = spawnSync(initDb, ['-D', pgData, '-U', 'postgres', `--pwfile=${pwFile}`, '-A', 'scram-sha-256', '--encoding=UTF8', '--locale=C'], {
      cwd: runtimeRoot,
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true
    })
    steps.push({
      name: 'Portable Postgres data',
      status: init.status === 0 ? 'pass' : 'fail',
      message: init.status === 0 ? 'Portable Postgres data directory initialized.' : shortOutput(`${init.stdout ?? ''}${init.stderr ?? ''}`) || 'Portable Postgres initialization failed.'
    })
    if (init.status !== 0) return { ok: false, steps }
  }

  if (!(await portOpen(5432))) {
    const started = spawnSync(pgCtl, ['-D', pgData, '-l', pgLog, '-o', '-p 5432', 'start'], {
      cwd: pgBin,
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true
    })
    steps.push({
      name: 'Portable Postgres',
      status: started.status === 0 ? 'pass' : 'fail',
      message: started.status === 0 ? 'Portable Postgres started on port 5432.' : shortOutput(`${started.stdout ?? ''}${started.stderr ?? ''}`) || 'Portable Postgres failed to start.'
    })
  } else {
    steps.push({ name: 'Portable Postgres', status: 'pass', message: 'Postgres is already reachable on port 5432.' })
  }

  if (!(await portOpen(6379))) {
    runDetachedProcess(redisExe, ['--port', '6379', '--bind', '127.0.0.1', '--save', ''], path.join(runtimeRoot, 'redis'))
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const redisReady = await portOpen(6379)
    steps.push({
      name: 'Portable Redis',
      status: redisReady ? 'pass' : 'fail',
      message: redisReady ? 'Portable Redis started on port 6379.' : 'Portable Redis failed to start.'
    })
  } else {
    steps.push({ name: 'Portable Redis', status: 'pass', message: 'Redis is already reachable on port 6379.' })
  }

  if (await portOpen(5432)) {
    spawnSync(createdb, ['-h', '127.0.0.1', '-p', '5432', '-U', 'postgres', 'docmee'], {
      cwd: pgBin,
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true,
      env: { ...process.env, PGPASSWORD: 'postgres' }
    })
  }

  return { ok: !steps.some((step) => step.status === 'fail'), steps }
}

function runDetachedProcess(file: string, args: string[], cwd: string) {
  const child = spawn(file, args, {
    cwd,
    shell: false,
    stdio: 'ignore',
    detached: true,
    windowsHide: true
  })
  child.unref()
  return child.pid
}

async function launchProductApp() {
  const steps: Array<{ name: string; status: 'pass' | 'warning' | 'fail'; message: string }> = []
  let usingPortableRuntime = false

  if (process.platform === 'win32') {
    const docker = spawnSync('docker.exe', ['compose', 'up', '-d'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true
    })
    steps.push({
      name: 'Local database',
      status: docker.status === 0 ? 'pass' : 'fail',
      message: docker.status === 0 ? 'Postgres and Redis are running.' : dockerOutput(`${docker.stdout ?? ''}${docker.stderr ?? ''}`) || 'Docker was not available. Use Docker Desktop, then retry.'
    })
  } else {
    const docker = spawnSync('docker', ['compose', 'up', '-d'], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe', windowsHide: true })
    steps.push({
      name: 'Local database',
      status: docker.status === 0 ? 'pass' : 'fail',
      message: docker.status === 0 ? 'Postgres and Redis are running.' : dockerOutput(`${docker.stdout ?? ''}${docker.stderr ?? ''}`) || 'Docker was not available. Start Docker, then retry.'
    })
  }

  if (steps.some((step) => step.status === 'fail')) {
    const portable = await startPortableRuntime()
    usingPortableRuntime = portable.ok
    steps.push(...portable.steps)
    if (portable.ok) {
      const dockerStep = steps.find((step) => step.name === 'Local database' && step.status === 'fail')
      if (dockerStep) {
        dockerStep.status = 'warning'
        dockerStep.message = 'Docker Desktop is unavailable; using portable Postgres and Redis for local deployment.'
      }
    }
    if (!portable.ok) {
      const payload = {
        createdAt: new Date().toISOString(),
        url: 'http://127.0.0.1:3000',
        healthUrl: 'http://127.0.0.1:3001/health',
        demoLogin: { email: 'admin@demo-a.test', password: 'demo1234' },
        pids: {},
        steps
      }
      writeFileSync(appLaunchFile, JSON.stringify(payload, null, 2))
      return { ok: false, steps, message: steps.find((step) => step.status === 'fail')?.message ?? 'Local launch failed.' }
    }
  }

  const migrate = runRepo(['--filter', '@docmee/db', 'db:migrate'])
  steps.push({
    name: 'Database tables',
    status: migrate.ok ? 'pass' : 'fail',
    message: migrate.ok ? 'Database tables are ready.' : shortOutput(migrate.output) || 'Database migration failed.'
  })

  if (migrate.ok) {
    const seed = runRepo(['--filter', '@docmee/db', 'db:seed'])
    steps.push({
      name: 'Demo login',
      status: seed.ok ? 'pass' : 'warning',
      message: seed.ok ? 'Demo clinic data is ready.' : shortOutput(seed.output) || 'Demo data may already exist.'
    })
  }

  if (steps.some((step) => step.status === 'fail')) {
    const payload = {
      createdAt: new Date().toISOString(),
      url: 'http://127.0.0.1:3000',
      healthUrl: 'http://127.0.0.1:3001/health',
      demoLogin: { email: 'admin@demo-a.test', password: 'demo1234' },
      pids: {},
      steps
    }
    writeFileSync(appLaunchFile, JSON.stringify(payload, null, 2))
    return { ok: false, steps, message: steps.find((step) => step.status === 'fail')?.message ?? 'Local launch failed.' }
  }

  const services = [
    { name: 'API', port: 3001, args: ['--filter', '@docmee/api', 'dev'] },
    { name: 'Inbox UI', port: 3000, args: ['--filter', '@docmee/inboxos', 'dev'] },
    { name: 'Workers', port: 0, args: ['--filter', '@docmee/workers', 'dev'] },
    { name: 'License service', port: 3002, args: ['--filter', '@docmee/licensekit', 'dev'] }
  ] as const

  const pids: Record<string, number | undefined> = {}
  for (const service of services) {
    const alreadyRunning = service.port > 0 ? await portOpen(service.port) : false
    if (alreadyRunning) {
      steps.push({ name: service.name, status: 'pass', message: `${service.name} is already running.` })
      continue
    }
    pids[service.name] = runRepoDetached([...service.args], usingPortableRuntime ? localRuntimeEnv() : {})
    steps.push({ name: service.name, status: 'pass', message: `${service.name} started in the background.` })
  }

  const payload = {
    createdAt: new Date().toISOString(),
    url: 'http://127.0.0.1:3000',
    healthUrl: 'http://127.0.0.1:3001/health',
    demoLogin: { email: 'admin@demo-a.test', password: 'demo1234' },
    pids,
    steps
  }
  writeFileSync(appLaunchFile, JSON.stringify(payload, null, 2))
  openUrl('http://127.0.0.1:3000')
  return { ok: true, steps, message: 'Application launched.' }
}

function productAccessMessage() {
  return [
    'Docmee application is ready for local checking.',
    'App URL: http://127.0.0.1:3000',
    'API Health: http://127.0.0.1:3001/health',
    'Demo login email: admin@demo-a.test',
    'Demo password: demo1234',
    'Note: This is local to the DevTools computer. Use VPS/domain after deployment for external access.'
  ].join('\n')
}

function postDeploymentDiscordMessage(run: PostDeploymentRun) {
  const lines = [
    'Post-deployment functionality check completed.',
    `Result: ${run.summary.pass} passed, ${run.summary.warning} warnings, ${run.summary.fail} issues.`,
    `Run time: ${new Date(run.createdAt).toLocaleString()}`,
    '',
    'Findings:'
  ]
  for (const check of run.checks) {
    const label = check.status === 'pass' ? 'PASS' : check.status === 'warning' ? 'WARNING' : 'ISSUE'
    lines.push(`- ${label}: ${check.name} - ${check.message}`)
  }
  return lines.join('\n').slice(0, 1800)
}

function vpsDeploymentSuccessMessage(run: PostDeploymentRun) {
  const env = readToolsEnv()
  const appUrl = vpsBaseUrl(env)
  return [
    'VPS deployment completed and verified.',
    `Result: ${run.summary.pass} passed, ${run.summary.warning} warnings, ${run.summary.fail} issues.`,
    appUrl ? `App URL: ${appUrl}` : '',
    appUrl ? `Login: ${appUrl}/login` : '',
    `Verified at: ${new Date(run.createdAt).toLocaleString()}`
  ].filter(Boolean).join('\n')
}

function isProcessAlive(pid?: number) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// A backlog run blocks new runs only if it's running, its process is alive, AND
// it has heart-beat within 90s. Healthy runs beat every 10s, so a hung/OS-killed
// run (or a reused pid) goes stale and can no longer wedge the queue.
function backlogRunBusy() {
  const state = readJson<{ pid?: number; status?: string; heartbeatAt?: string }>(backlogRunFile, {})
  if (state.status !== 'running' || !isProcessAlive(state.pid)) return false
  const beat = state.heartbeatAt ? Date.parse(state.heartbeatAt) : 0
  return Number.isFinite(beat) && Date.now() - beat < 90000
}

function activeBuildRun() {
  if (!existsSync(buildRunFile)) return null
  try {
    const data = JSON.parse(readFileSync(buildRunFile, 'utf8')) as { pid?: number; status?: string; phase?: string }
    return isProcessAlive(data.pid) && ['starting', 'running', 'paused'].includes(data.status ?? '') ? data : null
  } catch {
    return null
  }
}

function activeFeatureRun() {
  if (!existsSync(featureRunFile)) return null
  try {
    const data = JSON.parse(readFileSync(featureRunFile, 'utf8')) as { pid?: number; status?: string; phase?: string }
    return isProcessAlive(data.pid) && ['starting', 'running', 'paused'].includes(data.status ?? '') ? data : null
  } catch {
    return null
  }
}

function activeUiRun() {
  if (!existsSync(uiRunFile)) return null
  try {
    const data = JSON.parse(readFileSync(uiRunFile, 'utf8')) as { pid?: number; status?: string; phase?: string }
    return isProcessAlive(data.pid) && ['starting', 'running', 'paused'].includes(data.status ?? '') ? data : null
  } catch {
    return null
  }
}

function activeFrontendRun() {
  if (!existsSync(frontendRunFile)) return null
  try {
    const data = JSON.parse(readFileSync(frontendRunFile, 'utf8')) as { pid?: number; status?: string; phase?: string }
    return isProcessAlive(data.pid) && ['starting', 'running', 'paused'].includes(data.status ?? '') ? data : null
  } catch {
    return null
  }
}

function stopProcessTree(pid?: number) {
  if (!pid || !isProcessAlive(pid)) return false
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8', stdio: 'pipe', windowsHide: true })
    return !isProcessAlive(pid)
  }
  try {
    process.kill(pid, 'SIGTERM')
    return true
  } catch {
    return false
  }
}

function archiveStateFile(file: string, archiveDir: string) {
  if (!existsSync(file)) return false
  renameSync(file, path.join(archiveDir, path.basename(file)))
  return true
}

function stopTrackedRunProcesses() {
  const stopped: string[] = []
  const buildRun = readJson<{ pid?: number }>(buildRunFile, {})
  const featureRun = readJson<{ pid?: number }>(featureRunFile, {})
  const uiRun = readJson<{ pid?: number }>(uiRunFile, {})
  const appLaunch = readJson<{ pids?: Record<string, number | undefined> }>(appLaunchFile, {})
  if (stopProcessTree(buildRun.pid)) stopped.push('build watcher')
  if (stopProcessTree(featureRun.pid)) stopped.push('feature watcher')
  if (stopProcessTree(uiRun.pid)) stopped.push('UI watcher')
  for (const [name, pid] of Object.entries(appLaunch.pids ?? {})) {
    if (stopProcessTree(pid)) stopped.push(name)
  }
  return stopped
}

function resetDeploymentState() {
  mkdirSync(deployResetArchiveRoot, { recursive: true })
  const archiveDir = path.join(deployResetArchiveRoot, new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(archiveDir, { recursive: true })
  const stopped = stopTrackedRunProcesses()
  const targets = [
    startReadinessFile,
    buildRunFile,
    featureRunFile,
    uiRunFile,
    claudeUsageGuardFile,
    appLaunchFile,
    postDeploymentFile,
    featureCoverageFile,
    docmeeUpdateFile,
    path.join(logsRoot, 'deploy-lock.json'),
    path.join(logsRoot, 'predeployment.json'),
    path.join(logsRoot, 'predeployment-running.json'),
    path.join(logsRoot, 'ready.json'),
    path.join(logsRoot, 'diagnostics.json'),
    path.join(logsRoot, 'diagnostics-history.json'),
    path.join(logsRoot, 'six-gates.json'),
    path.join(logsRoot, 'sentinel-audit.json'),
    path.join(logsRoot, 'sentinel-issues.json'),
    path.join(logsRoot, 'cost.json'),
    path.join(logsRoot, 'phases.json'),
    path.join(logsRoot, 'build-control.json')
  ]
  const archived = targets.filter((file) => archiveStateFile(file, archiveDir)).length
  const now = new Date().toISOString()
  writeFileSync(path.join(logsRoot, 'phases.json'), JSON.stringify(phaseIds.map((id) => ({ id, status: 'not-started' })), null, 2))
  writeFileSync(path.join(logsRoot, 'build-control.json'), JSON.stringify(phaseIds.map((phaseId) => ({
    phaseId,
    status: 'pending',
    updatedAt: now,
    notes: 'Reset to fresh deployment state'
  })), null, 2))
  writeFileSync(buildRunFile, JSON.stringify({
    status: 'stopped',
    phase: 'P01',
    heartbeatAt: now,
    message: 'Fresh deployment reset completed. Build automation is not running.'
  }, null, 2))
  writeFileSync(featureRunFile, JSON.stringify({
    status: 'stopped',
    phase: 'Phase 1',
    workflow: 'features-development',
    heartbeatAt: now,
    message: 'Fresh deployment reset completed. Feature automation is not running.'
  }, null, 2))
  writeFileSync(claudeUsageGuardFile, JSON.stringify({
    thresholdPercent: 95,
    notes: 'Reset to fresh deployment state. DevTools will relearn usage after the next run.',
    updatedAt: now
  }, null, 2))
  writeFileSync(postDeploymentFile, JSON.stringify([], null, 2))
  writeFileSync(path.join(logsRoot, 'predeployment.json'), JSON.stringify([], null, 2))
  writeFileSync(path.join(logsRoot, 'sentinel-issues.json'), JSON.stringify([], null, 2))
  writeFileSync(path.join(logsRoot, 'cost.json'), JSON.stringify({ runtime: [], development: [] }, null, 2))
  writeFileSync(path.join(logsRoot, 'deployment-reset.json'), JSON.stringify({
    createdAt: now,
    archiveDir,
    archivedFiles: archived,
    stoppedProcesses: stopped,
    preserved: ['.env.tools', 'VPS settings', 'Discord tokens', 'Notion/GitHub setup', 'licenses', 'source code', 'installed dependencies']
  }, null, 2))
  return { archived, archiveDir, stopped }
}

export async function POST(request: Request) {
  const form = await request.formData()
  const action = String(form.get('action') ?? '')

  if (action === 'set-development-source') {
    const lane = String(form.get('lane') ?? '') as DevelopmentLane
    const sourceUrl = String(form.get('sourceUrl') ?? '').trim()
    const redirectTo = String(form.get('redirectTo') ?? `/docmee-deployment-${lane}`)
    if (!['backend', 'frontend', 'ui'].includes(lane)) return redirect(request, 'error', 'Unknown development lane.', redirectTo)
    if (!sourceUrl || !/^https:\/\/.*notion\./i.test(sourceUrl)) return redirect(request, 'error', 'Enter a valid Notion source URL.', redirectTo)
    try {
      const count = await setDevelopmentSource(lane, sourceUrl)
      return redirect(request, 'message', `${lane.toUpperCase()} Notion source saved and ${count} queue item${count === 1 ? '' : 's'} synced.`, redirectTo)
    } catch (error) {
      const settings = sourceSettings()
      settings[lane] = {
        url: sourceUrl,
        syncedAt: new Date().toISOString(),
        status: 'error',
        message: error instanceof Error ? error.message : String(error)
      }
      writeSourceSettings(settings)
      return redirect(request, 'error', `Notion source saved, but sync failed: ${error instanceof Error ? error.message : String(error)}`, redirectTo)
    }
  }

  if (action === 'claude-design-run') {
    const basePrompt = String(form.get('prompt') ?? '')
    const mockup = String(form.get('mockup') ?? '').trim()
    // Option B: implement an approved Claude Design mockup. The pasted mockup is
    // appended so Claude Code builds that exact design rather than inventing one.
    const prompt = mockup
      ? `${basePrompt}\n\n## Approved Claude Design mockup — implement this exactly in the Docmee product (apps/inboxos)\n${mockup}`
      : basePrompt
    if (!prompt.trim()) return redirect(request, 'error', 'No design prompt was provided.')
    const state = readJson<{ pid?: number; status?: string }>(claudeDesignRunFile, {})
    if (state.status === 'running' && isProcessAlive(state.pid)) {
      return redirect(request, 'error', 'A Claude Design run is already in progress. Wait for it to finish.')
    }
    // Hand the design prompt to Claude Code and run it once (single-shot, so it
    // can't loop). It designs/improves the item and commits the change.
    mkdirSync(promptsDir, { recursive: true })
    writeFileSync(claudeDesignPromptFile, prompt)
    const pid = runToolDetached(['design-run'])
    const uiScreenId = String(form.get('uiScreenId') ?? '').trim()
    const uiScreen = String(form.get('uiScreen') ?? '').trim()
    writeFileSync(claudeDesignRunFile, JSON.stringify({
      pid,
      workflow: 'claude-design',
      status: 'starting',
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      message: 'Claude Design run starting — Claude Code is designing this item.',
      // Carries the UI screen identity to design-run so it can write the UI
      // heartbeat + cost marker for the right screen.
      ...(uiScreenId ? { uiScreenId } : {}),
      ...(uiScreen ? { uiScreen } : {})
    }, null, 2))
    return redirect(request, 'message', 'Claude Design run started — Claude Code is now designing this item and will commit the change when done.')
  }

  if (action === 'mockup-build') {
    const id = Number(form.get('id'))
    const basePrompt = String(form.get('prompt') ?? '')
    if (!Number.isInteger(id) || !basePrompt.trim()) return redirect(request, 'error', 'Invalid mockup build request.')
    const mockupFile = path.join(mockupsDir, `screen-${id}.html`)
    if (!existsSync(mockupFile)) return redirect(request, 'error', `No mockup found for screen ${id}. Generate the mockup first.`)
    const mockup = readFileSync(mockupFile, 'utf8')
    const state = readJson<{ pid?: number; status?: string }>(claudeDesignRunFile, {})
    if (state.status === 'running' && isProcessAlive(state.pid)) {
      return redirect(request, 'error', 'A Claude run is already in progress. Wait for it to finish.')
    }
    const buildRecords = readJson<UiQueueItem[]>(uiDevelopmentRecordsFile, [])
    const uiScreen = buildRecords.find((row) => row.id === id)?.screen ?? `Screen ${id}`
    // The approved HTML mockup is the reference Claude Code builds the real
    // component against — single-shot, then it marks the screen needs-review.
    const prompt = `${basePrompt}\n\n## Approved HTML mockup (source: tools/logs/mockups/screen-${id}.html) — build the real Docmee component to match this mockup exactly\n${mockup}`
    mkdirSync(promptsDir, { recursive: true })
    writeFileSync(claudeDesignPromptFile, prompt)
    const pid = runToolDetached(['design-run'])
    writeFileSync(claudeDesignRunFile, JSON.stringify({
      pid,
      workflow: 'claude-design',
      status: 'starting',
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      message: `Building screen ${id} from the approved mockup.`,
      uiScreenId: id,
      uiScreen
    }, null, 2))
    return redirect(request, 'message', `Approved — Claude Code is now building screen ${id} from the mockup and will mark it for review when done.`)
  }

  if (action === 'mockup-save') {
    const id = Number(form.get('id'))
    if (!Number.isInteger(id)) return redirect(request, 'error', 'Invalid mockup save request.')
    const src = path.join(mockupsDir, `screen-${id}.html`)
    if (!existsSync(src)) return redirect(request, 'error', `No mockup found for screen ${id}. Generate it first.`)
    // Build a readable, reusable filename from the screen record: Screen_Phase_Features.
    const records = readJson<UiQueueItem[]>(uiDevelopmentRecordsFile, [])
    const item = records.find((row) => row.id === id)
    const slug = (value: string, max = 60) =>
      String(value ?? '').trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '') || 'na'
    const fileName = item
      ? `${slug(item.screen)}_Phase-${slug(String(item.phase))}_${slug(item.featuresCovered)}.html`
      : `screen-${id}.html`
    mkdirSync(savedMockupsDir, { recursive: true })
    writeFileSync(path.join(savedMockupsDir, fileName), readFileSync(src, 'utf8'))
    return redirect(request, 'message', `Saved mockup reference to mockup-library/${fileName}`)
  }

  if (action === 'ui-screen-status') {
    const id = Number(form.get('id'))
    const status = String(form.get('status') ?? '')
    if (!Number.isInteger(id) || !['complete', 'planned', 'needs-review'].includes(status)) {
      return redirect(request, 'error', 'Invalid screen status update.')
    }
    const records = readJson<UiQueueItem[]>(uiDevelopmentRecordsFile, [])
    if (!records.some((row) => row.id === id)) return redirect(request, 'error', `Screen ${id} not found.`)
    const next = records.map((row) => (row.id === id ? { ...row, status: status as UiQueueItem['status'] } : row))
    writeFileSync(uiDevelopmentRecordsFile, JSON.stringify(next.sort((a, b) => a.id - b.id), null, 2))
    const label = status === 'complete' ? 'approved and marked complete' : status === 'planned' ? 'queued to rebuild' : 'reopened for review'
    return redirect(request, 'message', `Screen ${id} ${label}.`)
  }

  if (action === 'ui-reset-screens') {
    const records = readJson<UiQueueItem[]>(uiDevelopmentRecordsFile, [])
    const next = records.map((row) => ({ ...row, status: 'planned' as UiQueueItem['status'] }))
    writeFileSync(uiDevelopmentRecordsFile, JSON.stringify(next.sort((a, b) => a.id - b.id), null, 2))
    return redirect(request, 'message', `Reset ${next.length} screen(s) back to planned — the design process can start over from Start UI Development.`)
  }

  if (action === 'ui-build-all') {
    const active = activeUiRun()
    if (active) return redirect(request, 'error', 'UI development automation is already running. Stop it before starting another build.')
    // Re-queue every screen not yet approved (planned + needs-review) to planned
    // so the sequential builder processes them all; already-approved (complete)
    // screens are left untouched. Each built screen lands in needs-review.
    const records = readJson<UiQueueItem[]>(uiDevelopmentRecordsFile, [])
    const requeued = records.map((row) => (row.status === 'complete' ? row : { ...row, status: 'planned' as UiQueueItem['status'] }))
    writeFileSync(uiDevelopmentRecordsFile, JSON.stringify(requeued.sort((a, b) => a.id - b.id), null, 2))
    const count = requeued.filter((row) => row.status === 'planned').length
    if (count === 0) return redirect(request, 'message', 'All screens are already approved (complete) — nothing to build.')
    const pid = runToolDetached(['ui-development', 'watch'])
    writeFileSync(uiRunFile, JSON.stringify({
      pid,
      phase: 'UI-DEVELOPMENT',
      workflow: 'ui-development',
      status: 'starting',
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      message: `Sequential build of ${count} screen(s) started`
    }, null, 2))
    return redirect(request, 'message', `Building ${count} screen(s) sequentially — each lands in review for your approval when done.`)
  }

  if (action === 'app-launch') {
    const result = await launchProductApp()
    if (result.ok) {
      runTool(['discord', 'send', '--type', 'development', '--message', productAccessMessage()])
    }
    return redirect(
      request,
      result.ok ? 'message' : 'error',
      result.ok ? 'Application launched. Access details were posted to Discord.' : `Application launch blocked: ${result.message}`
    )
  }

  if (action === 'post-deploy-check') {
    const run = await runPostDeploymentChecks()
    runTool(['discord', 'send', '--type', run.summary.fail > 0 ? 'critical' : 'development', '--message', postDeploymentDiscordMessage(run)])
    const failed = run.summary.fail > 0
    return redirect(
      request,
      failed ? 'error' : 'message',
      failed
        ? `Post-deployment check found ${run.summary.fail} issue${run.summary.fail === 1 ? '' : 's'}.`
        : 'Post-deployment check passed.'
    )
  }

  if (action === 'vps-post-deploy-check') {
    const run = await runVpsPostDeploymentChecks()
    runTool(['discord', 'send', '--type', run.summary.fail > 0 ? 'critical' : 'development', '--message', postDeploymentDiscordMessage(run)])
    const failed = run.summary.fail > 0
    return redirect(
      request,
      failed ? 'error' : 'message',
      failed
        ? `VPS verification found ${run.summary.fail} issue${run.summary.fail === 1 ? '' : 's'}.`
        : 'VPS verification passed.'
    )
  }

  if (action === 'env-readiness-check') {
    const run = runEnvReadinessChecks()
    runTool(['discord', 'send', '--type', run.summary.fail > 0 ? 'critical' : 'development', '--message', postDeploymentDiscordMessage(run)])
    const failed = run.summary.fail > 0
    return redirect(
      request,
      failed ? 'error' : 'message',
      failed
        ? `.env readiness found ${run.summary.fail} required issue${run.summary.fail === 1 ? '' : 's'}.`
        : `.env readiness passed with ${run.summary.warning} warning${run.summary.warning === 1 ? '' : 's'}.`
    )
  }

  if (action === 'sentinel-scan') {
    const result = scanSentinel()
    return redirect(
      request,
      result.activeIssueCount > 0 ? 'error' : 'message',
      result.activeIssueCount > 0
        ? `Sentinel found ${result.activeIssueCount} active issue${result.activeIssueCount === 1 ? '' : 's'}.`
        : 'Sentinel scan completed with no active issues.'
    )
  }

  if (action === 'deployment-reset') {
    if (String(form.get('confirm')) !== 'RESET DEPLOYMENT') {
      return redirect(request, 'error', 'Reset was not confirmed. Type RESET DEPLOYMENT to continue.')
    }
    try {
      const result = resetDeploymentState()
      return redirect(
        request,
        'message',
        `Fresh deployment reset completed. ${result.archived} state file(s) archived and ${result.stopped.length} process(es) stopped.`
      )
    } catch (error) {
      return redirect(request, 'error', `Fresh deployment reset failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (action === 'gates-run') {
    const result = runTool(['gates', 'check'])
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? 'All gates passed' : 'One or more gates failed')
  }

  if (action === 'ready-run' || action === 'ready-fix') {
    const args = action === 'ready-fix' ? ['ready', '--fix'] : ['ready']
    const result = runTool(args)
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? 'DevTools is ready' : 'Readiness check found critical issues')
  }

  if (action === 'diagnose-run' || action === 'diagnose-quick' || action === 'diagnose-fix') {
    const category = String(form.get('category') ?? '').trim()
    const args = ['diagnose']
    if (action === 'diagnose-quick') args.push('--quick')
    if (action === 'diagnose-fix') args.push('--fix')
    if (category) args.push('--category', category)
    const result = runTool(args)
    const ranWhat = category ? 'Diagnostic category' : action === 'diagnose-quick' ? 'Quick diagnostics' : action === 'diagnose-fix' ? 'Diagnostic fix guidance' : 'Diagnostics'
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? `${ranWhat} completed` : `${ranWhat} found issues`, '/diagnostics')
  }

  if (action === 'start-readiness') {
    const phase = String(form.get('phase') ?? 'P01')
    const workflow = String(form.get('workflow') ?? 'build-control')
    const redirectTo = String(form.get('redirectTo') ?? '')
    const steps: Array<{ name: string; status: 'pass' | 'fail'; message: string }> = []

    const ready = runTool(['ready', '--json'])
    steps.push({
      name: 'Setup Check',
      status: ready.ok ? 'pass' : 'fail',
      message: ready.ok ? 'Ready Check passed. Claude Pro, Notion, GitHub, prompts, and Discord are usable.' : shortOutput(ready.output) || 'Ready Check found a blocker.'
    })

    if (ready.ok && workflow === 'features-development') {
      const features = existsSync(featureCoverageFile)
        ? readJson<Array<{ status?: string }>>(featureCoverageFile, [])
        : []
      const openFeatures = features.filter((item) => item.status !== 'complete').length
      steps.push({
        name: 'Feature Queue',
        status: openFeatures > 0 ? 'pass' : 'fail',
        message: openFeatures > 0 ? `${openFeatures} open feature(s) ready for Claude.` : 'No open feature queue was found.'
      })
    }

    if (ready.ok && workflow === 'frontend-development') {
      const features = existsSync(featureCoverageFile)
        ? readJson<Array<{ frontendStatus?: string }>>(featureCoverageFile, [])
        : []
      const openFrontend = features.filter((item) => item.frontendStatus !== 'complete').length
      steps.push({
        name: 'Frontend Queue',
        status: openFrontend > 0 ? 'pass' : 'fail',
        message: openFrontend > 0 ? `${openFrontend} frontend item(s) need audit or acceptance.` : 'No open frontend acceptance queue was found.'
      })
    }

    if (ready.ok && workflow === 'enhancements-development') {
      const enhancements = existsSync(enhancementsFile)
        ? readJson<Array<{ status?: string }>>(enhancementsFile, [])
        : [
          { status: 'planned' },
          { status: 'missing' }
        ]
      const openEnhancements = enhancements.filter((item) => item.status !== 'complete').length
      steps.push({
        name: 'Enhancement Queue',
        status: openEnhancements > 0 ? 'pass' : 'fail',
        message: openEnhancements > 0 ? `${openEnhancements} open enhancement(s) ready for planning.` : 'No open enhancement queue was found.'
      })
    }

    if (ready.ok && workflow === 'design-audit') {
      const auditItems = existsSync(designAuditRecordsFile)
        ? readJson<Array<{ status?: string }>>(designAuditRecordsFile, [])
        : [
          { status: 'planned' },
          { status: 'planned' },
          { status: 'planned' }
        ]
      const openAuditItems = auditItems.filter((item) => item.status !== 'complete').length
      steps.push({
        name: 'Design Audit Queue',
        status: openAuditItems > 0 ? 'pass' : 'fail',
        message: openAuditItems > 0 ? `${openAuditItems} design audit item(s) ready for Claude Design.` : 'No open design audit queue was found.'
      })
    }

    if (ready.ok && workflow === 'ui-development') {
      const uiItems = existsSync(uiDevelopmentRecordsFile)
        ? readJson<Array<{ status?: string }>>(uiDevelopmentRecordsFile, [])
        : []
      const openUIItems = uiItems.filter((item) => item.status !== 'complete').length
      steps.push({
        name: 'UI Development Queue',
        status: openUIItems > 0 ? 'pass' : 'fail',
        message: openUIItems > 0 ? `${openUIItems} UI screen(s) ready for Claude.` : 'No open UI development queue was found.'
      })
    }

    if (ready.ok && workflow !== 'features-development' && workflow !== 'frontend-development' && workflow !== 'enhancements-development' && workflow !== 'design-audit' && workflow !== 'ui-development') {
      const context = runTool(['phase', 'context', '--phase', phase])
      steps.push({
        name: `${phase} Context`,
        status: context.ok ? 'pass' : 'fail',
        message: context.ok ? `${phase} build context prepared.` : shortOutput(context.output) || `${phase} context could not be prepared.`
      })
    }

    if (steps.every((step) => step.status === 'pass') && workflow !== 'features-development' && workflow !== 'frontend-development' && workflow !== 'enhancements-development' && workflow !== 'design-audit' && workflow !== 'ui-development') {
      const dryRun = runTool(['phase', 'build', '--from', phase, '--dry-run', '--no-sync'])
      steps.push({
        name: 'Safe Build Test',
        status: dryRun.ok ? 'pass' : 'fail',
        message: dryRun.ok ? 'Dry run passed. Start can launch without hidden setup work.' : shortOutput(dryRun.output) || 'Dry run found a build blocker.'
      })
    }

    if (steps.every((step) => step.status === 'pass') && workflow === 'features-development') {
      steps.push({
        name: 'Safe Feature Start',
        status: 'pass',
        message: 'Feature automation will start from the open Rev 1 coverage queue.'
      })
    }

    if (steps.every((step) => step.status === 'pass') && workflow === 'frontend-development') {
      steps.push({
        name: 'Safe Frontend Start',
        status: 'pass',
        message: 'Frontend build control can proceed from the open frontend acceptance queue.'
      })
    }

    if (steps.every((step) => step.status === 'pass') && workflow === 'enhancements-development') {
      steps.push({
        name: 'Safe Enhancement Start',
        status: 'pass',
        message: 'Enhancement work can be planned without changing product feature progress.'
      })
    }

    if (steps.every((step) => step.status === 'pass') && workflow === 'design-audit') {
      steps.push({
        name: 'Safe Design Audit Start',
        status: 'pass',
        message: 'Claude Design audit can run from the open design audit queue.'
      })
    }

    if (steps.every((step) => step.status === 'pass') && workflow === 'ui-development') {
      steps.push({
        name: 'Safe UI Development Start',
        status: 'pass',
        message: 'UI development can start from the 17-screen design queue.'
      })
    }

    const ok = saveStartReadiness(phase, steps, workflow)
    return redirect(
      request,
      ok ? 'message' : 'error',
      ok ? 'Start Check passed. You can start automation.' : 'Start Check found something that needs attention.',
      ok ? redirectTo : undefined
    )
  }

  if (action === 'seed') {
    const kind = String(form.get('kind') ?? 'all')
    const result = runTool(['seed', kind])
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? `Seeded ${kind}` : `Seed ${kind} failed`)
  }

  if (action === 'webhook-send') {
    const payload = String(form.get('payload') ?? 'text-message')
    const result = runTool(['webhook', 'send', '--payload', payload])
    const label = payload.split('-').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ')
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? `${label} test sent` : `${label} test failed`)
  }

  if (action === 'phase-start' || action === 'phase-done') {
    const phase = String(form.get('phase') ?? '')
    const command = action === 'phase-start' ? 'start' : 'done'
    const result = runTool(['phase', command, phase])
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? `${phase} ${command === 'start' ? 'started' : 'completed'}` : `${phase} ${command} failed`)
  }

  if (action === 'phase-sync') {
    const result = runTool(['phase', 'sync'])
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? 'Phase prompts synced or cache checked' : 'Phase prompt sync failed')
  }

  if (action === 'phase-context') {
    const phase = String(form.get('phase') ?? 'P01')
    const result = runTool(['phase', 'context', '--phase', phase])
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? `${phase} context prepared` : `${phase} context failed`)
  }

  if (action === 'phase-output-copied') {
    const phase = String(form.get('phase') ?? 'P01')
    const status = runTool(['phase', 'status', '--phase', phase, '--status', 'output-copied', '--notes', 'Output copied to repo from dashboard'])
    if (!status.ok) return redirect(request, 'error', `${phase} status update failed`)
    const pid = runToolDetached(['phase', 'continue', '--phase', phase])
    return redirect(request, 'message', `${phase} marked output copied; completion worker started${pid ? ` (${pid})` : ''}`)
  }

  if (action === 'phase-poll') {
    const phase = String(form.get('phase') ?? 'P01')
    const status = String(form.get('status') ?? 'output-copied')
    const result = runTool(['phase', 'poll', '--phase', phase, '--status', status])
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? `${phase} status matched ${status}` : `${phase} is not ${status} yet`)
  }

  if (action === 'phase-build' || action === 'phase-build-dry-run') {
    const from = String(form.get('from') ?? 'P01')
    const args = ['phase', 'build', '--from', from]
    if (action === 'phase-build-dry-run') args.push('--dry-run')
    if (action === 'phase-build') {
      const pid = runToolDetached(args)
      return redirect(request, 'message', `Automated build started from ${from}${pid ? ` (${pid})` : ''}`)
    }
    const result = runTool(args)
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? 'Phase build command completed' : 'Phase build command failed')
  }

  if (action === 'phase-build-watch') {
    const from = String(form.get('from') ?? 'P01')
    const workflow = String(form.get('workflow') ?? 'build-control')
    const isFeatureWorkflow = workflow === 'features-development' || workflow === 'frontend-development' || workflow === 'enhancements-development' || workflow === 'design-audit' || workflow === 'ui-development'
    const workflowLabel = workflow === 'frontend-development'
      ? 'Frontend development automation'
      : workflow === 'enhancements-development'
        ? 'Enhancement development automation'
      : workflow === 'design-audit'
        ? 'Design audit automation'
      : workflow === 'ui-development'
        ? 'UI development automation'
      : workflow === 'features-development'
        ? 'Feature development automation'
        : 'Automated build watcher'
    const active = workflow === 'ui-development'
      ? activeUiRun()
      : workflow === 'frontend-development'
        ? activeFrontendRun()
        : isFeatureWorkflow ? activeFeatureRun() : activeBuildRun()
    if (active) return redirect(request, 'error', `${workflowLabel} is already running from ${active.phase ?? 'current phase'}. Stop it before starting another one.`)
    const pid = workflow === 'frontend-development'
      ? runToolDetached(['feature', 'watch', '--mode', 'frontend'])
      : workflow === 'enhancements-development'
        ? runToolDetached(['enhancement', 'watch'])
      : workflow === 'design-audit'
        ? runToolDetached(['design-audit', 'watch'])
      : workflow === 'ui-development'
        ? runToolDetached(['ui-development', 'watch'])
      : workflow === 'features-development'
        ? runToolDetached(['feature', 'watch'])
      : runToolDetached(['phase', 'watch', '--from', from])
    const runFile = workflow === 'ui-development'
      ? uiRunFile
      : workflow === 'frontend-development'
        ? frontendRunFile
        : isFeatureWorkflow ? featureRunFile : buildRunFile
    writeFileSync(runFile, JSON.stringify({
      pid,
      phase: from,
      workflow,
      status: 'starting',
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      message: `${workflowLabel} started from ${from}`
    }, null, 2))
    return redirect(request, 'message', `${workflowLabel} started from ${from}${pid ? ` (${pid})` : ''}`)
  }

  if (action === 'phase-build-stop') {
    const now = new Date().toISOString()
    const current = existsSync(buildRunFile)
      ? JSON.parse(readFileSync(buildRunFile, 'utf8')) as { pid?: number; phase?: string }
      : {}
    const currentFeature = existsSync(featureRunFile)
      ? JSON.parse(readFileSync(featureRunFile, 'utf8')) as { pid?: number; phase?: string; workflow?: string }
      : {}
    const currentUi = existsSync(uiRunFile)
      ? JSON.parse(readFileSync(uiRunFile, 'utf8')) as { pid?: number; phase?: string; workflow?: string }
      : {}
    const currentFrontend = existsSync(frontendRunFile)
      ? JSON.parse(readFileSync(frontendRunFile, 'utf8')) as { pid?: number; phase?: string; workflow?: string }
      : {}
    const stoppedBuild = stopProcessTree(current.pid)
    const stoppedFeature = stopProcessTree(currentFeature.pid)
    const stoppedUi = stopProcessTree(currentUi.pid)
    const stoppedFrontend = stopProcessTree(currentFrontend.pid)
    writeFileSync(buildRunFile, JSON.stringify({
      ...current,
      status: 'stopped',
      heartbeatAt: now,
      message: stoppedBuild ? 'Build stopped from dashboard' : 'No live build process was found'
    }, null, 2))
    writeFileSync(featureRunFile, JSON.stringify({
      ...currentFeature,
      status: 'stopped',
      heartbeatAt: now,
      message: stoppedFeature ? 'Feature, frontend, enhancement, or design audit automation stopped from dashboard' : 'No live feature, frontend, enhancement, or design audit process was found'
    }, null, 2))
    writeFileSync(uiRunFile, JSON.stringify({
      ...currentUi,
      status: 'stopped',
      heartbeatAt: now,
      message: stoppedUi ? 'UI development automation stopped from dashboard' : 'No live UI development process was found'
    }, null, 2))
    writeFileSync(frontendRunFile, JSON.stringify({
      ...currentFrontend,
      status: 'stopped',
      heartbeatAt: now,
      message: stoppedFrontend ? 'Frontend development automation stopped from dashboard' : 'No live frontend development process was found'
    }, null, 2))
    if (current.phase) {
      runTool(['phase', 'status', '--phase', current.phase, '--status', 'pending', '--notes', 'Build stopped from dashboard'])
    }
    const stopped = stoppedBuild || stoppedFeature || stoppedUi || stoppedFrontend
    return redirect(request, stopped ? 'message' : 'error', stopped ? 'Automation stopped' : 'No live build, feature, frontend, enhancement, design audit, or UI development process was found')
  }

  if (action === 'phase-build-control-init') {
    const result = runTool(['phase', 'sync', '--init'])
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? 'Build Control database ready' : 'Build Control setup failed')
  }

  if (action === 'claude-switch-reset-guard') {
    try {
      writeFileSync(claudeUsageGuardFile, JSON.stringify({
        thresholdPercent: 95,
        notes: 'Reset after Claude account switch. DevTools will relearn the active Max session limit.',
        updatedAt: new Date().toISOString()
      }, null, 2))
      return redirect(request, 'message', 'Claude usage guard reset for the new account')
    } catch {
      return redirect(request, 'error', 'Claude usage guard reset failed')
    }
  }

  if (action === 'claude-switch-finalize') {
    const current = existsSync(buildRunFile)
      ? JSON.parse(readFileSync(buildRunFile, 'utf8')) as { pid?: number; phase?: string; startedAt?: string }
      : {}
    const currentFeature = existsSync(featureRunFile)
      ? JSON.parse(readFileSync(featureRunFile, 'utf8')) as { pid?: number; phase?: string; workflow?: string; startedAt?: string }
      : {}
    const currentUi = existsSync(uiRunFile)
      ? JSON.parse(readFileSync(uiRunFile, 'utf8')) as { pid?: number; phase?: string; workflow?: string; startedAt?: string }
      : {}
    stopProcessTree(current.pid)
    stopProcessTree(currentFeature.pid)
    stopProcessTree(currentUi.pid)
    writeFileSync(claudeUsageGuardFile, JSON.stringify({
      thresholdPercent: 95,
      notes: 'Reset after Claude account switch. DevTools will relearn the active account limit after Claude refresh.',
      updatedAt: new Date().toISOString()
    }, null, 2))
    writeFileSync(buildRunFile, JSON.stringify({
      ...current,
      status: 'stopped',
      heartbeatAt: new Date().toISOString(),
      message: 'Build stopped for Claude account switch. Ready Check will verify the new account.'
    }, null, 2))
    writeFileSync(featureRunFile, JSON.stringify({
      ...currentFeature,
      status: 'stopped',
      heartbeatAt: new Date().toISOString(),
      message: 'Feature, frontend, enhancement, or design audit automation stopped for Claude account switch. Ready Check will verify the new account.'
    }, null, 2))
    writeFileSync(uiRunFile, JSON.stringify({
      ...currentUi,
      status: 'stopped',
      heartbeatAt: new Date().toISOString(),
      message: 'UI development automation stopped for Claude account switch. Ready Check will verify the new account.'
    }, null, 2))
    const result = runTool(['ready', '--json'])
    if (!result.ok) {
      const blocker = claudeSmokeBlocker(result.output)
      if (blocker) {
        writeFileSync(buildRunFile, JSON.stringify({
          ...current,
          status: 'stopped',
          heartbeatAt: new Date().toISOString(),
          message: `${blocker.message}${blocker.fix ? ` Fix: ${blocker.fix}` : ''}`
        }, null, 2))
      }
    }
    return redirect(
      request,
      result.ok ? 'message' : 'error',
      result.ok
        ? 'Claude account verified. You can resume the build.'
        : shortOutput(claudeSmokeBlocker(result.output)?.message ?? '') || 'Claude account saved, but Ready Check still needs attention before resume.'
    )
  }

  if (action === 'backlog-done') {
    const id = String(form.get('id') ?? '')
    const result = runTool(['backlog', 'done', '--id', id])
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? `Marked task ${id} done` : `Task ${id} update failed`)
  }

  if (action === 'backlog-status') {
    const id = String(form.get('id') ?? '')
    const status = String(form.get('status') ?? '').trim()
    const result = runTool(['backlog', 'set', '--id', id, '--status', status])
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? `Task ${id} set to ${status}` : `Task ${id} status update failed`)
  }

  if (action === 'backlog-delete') {
    const id = String(form.get('id') ?? '')
    const result = runTool(['backlog', 'remove', '--id', id])
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? `Deleted task ${id}` : `Task ${id} delete failed`)
  }

  if (action === 'backlog-sync') {
    const result = runTool(['backlog', 'sync'])
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? 'Backlog synced (scanned code + flagged possibly-shipped items)' : 'Backlog sync failed')
  }

  if (action === 'backlog-update') {
    const id = String(form.get('id') ?? '')
    const args = ['backlog', 'update', '--id', id]
    for (const field of ['assignee', 'plan', 'commit', 'pr']) {
      const value = form.get(field)
      if (value !== null) args.push(`--${field}`, String(value))
    }
    const result = runTool(args)
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? `Task ${id} updated` : `Task ${id} update failed`)
  }

  if (action === 'backlog-plan') {
    const id = String(form.get('id') ?? '')
    const provider = String(form.get('provider') ?? 'claude') || 'claude'
    if (backlogRunBusy()) {
      return redirect(request, 'error', 'A backlog run is already in progress. Wait for it to finish, or click Stop.')
    }
    runTool(['backlog', 'update', '--id', id, '--assignee', provider])
    runToolDetached(['backlog', 'plan', '--id', id, '--auto', '--provider', provider])
    const who = provider === 'claude' ? 'Claude' : `${provider} → Claude`
    return redirect(request, 'message', `Auto-planning backlog #${id} (${who}) — plan + confidence gate, auto-resolve if ≥8, then auto-verify.`)
  }

  if (action === 'backlog-verify') {
    const id = String(form.get('id') ?? '')
    if (backlogRunBusy()) {
      return redirect(request, 'error', 'A backlog run is already in progress. Wait for it to finish, or click Stop.')
    }
    runToolDetached(['backlog', 'verify', '--id', id])
    return redirect(request, 'message', `Verifying backlog #${id} — Claude checks whether the fix actually works and rates confidence; ≥8 marks it done, below flags it for review with a reason.`)
  }

  if (action === 'backlog-approve') {
    const id = String(form.get('id') ?? '')
    const result = runTool(['backlog', 'done', '--id', id])
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? `Backlog #${id} approved — marked done.` : `Backlog #${id} approve failed`)
  }

  if (action === 'backlog-stop') {
    const result = runTool(['backlog', 'stop'])
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? 'Stopped the backlog run and cleared the state.' : 'Could not stop the run.')
  }

  if (action === 'backlog-resolve') {
    const id = String(form.get('id') ?? '')
    const plan = String(form.get('plan') ?? '')
    const provider = String(form.get('provider') ?? 'claude') || 'claude'
    if (backlogRunBusy()) {
      return redirect(request, 'error', 'A backlog resolution is already running. Wait for it to finish, or click Stop.')
    }
    // Persist the (possibly edited) plan + assignee first so the run uses them.
    const updateArgs = ['backlog', 'update', '--id', id, '--assignee', provider]
    if (plan.trim()) updateArgs.push('--plan', plan)
    runTool(updateArgs)
    runToolDetached(['backlog', 'resolve', '--id', id, '--provider', provider])
    const note = provider === 'claude'
      ? `Resolving backlog #${id} with Claude — it will move to review when done.`
      : `Running backlog #${id} with ${provider} — its proposed resolution will appear for review when done.`
    return redirect(request, 'message', note)
  }

  if (action === 'backlog-auto-resolve') {
    if (backlogRunBusy()) {
      return redirect(request, 'error', 'A backlog run is already in progress. Wait for it to finish, or click Stop.')
    }
    runToolDetached(['backlog', 'auto-resolve'])
    return redirect(request, 'message', 'Auto-resolve started — Claude plans each open item in turn, resolving the confident ones (≥8) and queuing the rest for your approval.')
  }

  if (action === 'backlog-verify-all') {
    if (backlogRunBusy()) {
      return redirect(request, 'error', 'A backlog run is already in progress. Wait for it to finish, or click Stop.')
    }
    runToolDetached(['backlog', 'verify-all'])
    return redirect(request, 'message', 'Verify-all started — Claude verifies each item awaiting review; ≥8 marks it done, below leaves it flagged with a reason.')
  }

  if (action === 'journal-add') {
    const title = String(form.get('title') ?? '').trim()
    if (!title) return redirect(request, 'error', 'A title is required', '/journal')
    const args = ['journal', 'add', '--title', title, '--type', String(form.get('type') ?? 'note')]
    const body = String(form.get('body') ?? '').trim()
    const tags = String(form.get('tags') ?? '').trim()
    const task = String(form.get('task') ?? '').trim()
    if (body) args.push('--body', body)
    if (tags) args.push('--tags', tags)
    if (task) args.push('--task', task)
    const result = runTool(args)
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? 'Saved to journal' : 'Could not save', '/journal')
  }

  if (action === 'journal-pin') {
    const id = String(form.get('id') ?? '')
    const off = String(form.get('off') ?? '') === '1'
    const args = ['journal', 'pin', '--id', id]
    if (off) args.push('--off')
    const result = runTool(args)
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? (off ? 'Unpinned' : 'Pinned') : 'Failed', '/journal')
  }

  if (action === 'journal-remove') {
    const id = String(form.get('id') ?? '')
    const result = runTool(['journal', 'remove', '--id', id])
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? 'Removed' : 'Failed', '/journal')
  }

  if (action === 'mockup-report') {
    const result = runTool(['mockup', 'report'])
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? 'UI Design Report saved to the mockup Library (UI-Design-Report.pdf).' : 'Could not generate the report — check that Chrome/Edge is installed and the Library has mockups.', '/docmee-audit')
  }

  if (action === 'ui-mockup-all') {
    const state = readJson<{ pid?: number; status?: string }>(claudeDesignRunFile, {})
    if (state.status === 'running' && isProcessAlive(state.pid)) {
      return redirect(request, 'error', 'A design/mockup run is already in progress. Wait for it to finish or stop it.', '/docmee-audit')
    }
    const records = readJson<UiQueueItem[]>(uiDevelopmentRecordsFile, [])
    const queue = records
      .filter((row) => !existsSync(path.join(mockupsDir, `screen-${row.id}.html`)))
      .sort((a, b) => a.id - b.id)
      .map((row) => ({ id: row.id, prompt: screenMockupPrompt(row) }))
    if (queue.length === 0) return redirect(request, 'message', 'Every screen already has a mockup — nothing to generate.', '/docmee-audit')
    mkdirSync(logsRoot, { recursive: true })
    writeFileSync(path.join(logsRoot, 'mockup-queue.json'), JSON.stringify(queue, null, 2))
    runToolDetached(['mockup', 'generate-all'])
    return redirect(request, 'message', `Generating ${queue.length} mockup(s) sequentially with Claude — each appears on its screen as it finishes.`, '/docmee-audit')
  }

  if (action === 'ui-build-approved-all') {
    const state = readJson<{ pid?: number; status?: string }>(claudeDesignRunFile, {})
    if (state.status === 'running' && isProcessAlive(state.pid)) {
      return redirect(request, 'error', 'A design/build run is already in progress. Wait for it to finish or stop it.', '/docmee-audit')
    }
    const records = readJson<UiQueueItem[]>(uiDevelopmentRecordsFile, [])
    const queue = records
      .filter((row) => row.status !== 'complete' && existsSync(path.join(mockupsDir, `screen-${row.id}.html`)))
      .sort((a, b) => a.id - b.id)
      .map((row) => {
        const mockup = readFileSync(path.join(mockupsDir, `screen-${row.id}.html`), 'utf8')
        return { id: row.id, prompt: `${screenDesignPrompt(row)}\n\n## Approved HTML mockup (source: tools/logs/mockups/screen-${row.id}.html) — build the real Docmee component to match this mockup exactly\n${mockup}` }
      })
    if (queue.length === 0) return redirect(request, 'message', 'No screens to build — every screen with a mockup is already complete. Generate a mockup first.', '/docmee-audit')
    mkdirSync(logsRoot, { recursive: true })
    writeFileSync(path.join(logsRoot, 'mockup-build-queue.json'), JSON.stringify(queue, null, 2))
    runToolDetached(['mockup', 'build-all'])
    return redirect(request, 'message', `Approving + building ${queue.length} screen(s) from their mockups — each is built with Claude Code and lands in review when done.`, '/docmee-audit')
  }

  if (action === 'ui-mockup-stop') {
    const result = runTool(['mockup', 'stop'])
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? 'Stopped the bulk mockup run.' : 'Could not stop.', '/docmee-audit')
  }

  if (action === 'ui-wiring-verify-all') {
    const state = readJson<{ pid?: number; status?: string }>(claudeDesignRunFile, {})
    if (state.status === 'running' && isProcessAlive(state.pid)) return redirect(request, 'error', 'A design/build run is already in progress. Wait for it to finish or stop it.', '/docmee-audit')
    runToolDetached(['ui-wiring', 'verify-all'])
    return redirect(request, 'message', 'Verifying backend wiring for each built screen — read-only, scores how wired each screen is (≥8 = wired). It does NOT rebuild.', '/docmee-audit')
  }

  if (action === 'ui-wiring-fix-all') {
    const state = readJson<{ pid?: number; status?: string }>(claudeDesignRunFile, {})
    if (state.status === 'running' && isProcessAlive(state.pid)) return redirect(request, 'error', 'A design/build run is already in progress. Wait for it to finish or stop it.', '/docmee-audit')
    runToolDetached(['ui-wiring', 'fix-all'])
    return redirect(request, 'message', 'Wiring the flagged screens to the backend — targeted edits to the existing components, no rebuild.', '/docmee-audit')
  }

  // Per-row remedy for a screen whose wiring scored below 8: auto-fix it (Claude
  // wires this one screen to the backend, targeted edit, no rebuild).
  if (action === 'ui-wiring-fix') {
    const id = Number(form.get('id'))
    if (!Number.isInteger(id)) return redirect(request, 'error', 'Invalid screen id.', '/docmee-audit')
    const state = readJson<{ pid?: number; status?: string }>(claudeDesignRunFile, {})
    if (state.status === 'running' && isProcessAlive(state.pid)) return redirect(request, 'error', 'A design/build run is already in progress. Wait for it to finish or stop it.', '/docmee-audit')
    runToolDetached(['ui-wiring', 'fix', '--id', String(id)])
    return redirect(request, 'message', `Wiring screen ${id} to the backend — targeted edit to the existing component, no rebuild.`, '/docmee-audit')
  }

  // Per-row "approve as-is": accept the low wiring score (override to passing) so
  // the screen clears the flagged list. A later Verify wiring re-scores it.
  if (action === 'ui-wiring-accept') {
    const id = Number(form.get('id'))
    if (!Number.isInteger(id)) return redirect(request, 'error', 'Invalid screen id.', '/docmee-audit')
    const records = readJson<UiQueueItem[]>(uiDevelopmentRecordsFile, [])
    if (!records.some((row) => row.id === id)) return redirect(request, 'error', `Screen ${id} not found.`, '/docmee-audit')
    const next = records.map((row) => (row.id === id
      ? { ...row, wiringConfidence: 8, wiringReason: 'Approved by the operator despite the low auto-score.', wiringCheckedAt: new Date().toISOString() }
      : row))
    writeFileSync(uiDevelopmentRecordsFile, JSON.stringify(next.sort((a, b) => a.id - b.id), null, 2))
    return redirect(request, 'message', `Screen ${id} wiring approved as-is — cleared from the flagged list.`, '/docmee-audit')
  }

  if (action === 'mockup-save-all') {
    if (!existsSync(mockupsDir)) return redirect(request, 'message', 'No generated mockups to save yet.', '/docmee-audit')
    const files = readdirSync(mockupsDir).filter((file) => /^screen-\d+\.html$/.test(file))
    if (files.length === 0) return redirect(request, 'message', 'No generated mockups to save yet.', '/docmee-audit')
    const records = readJson<UiQueueItem[]>(uiDevelopmentRecordsFile, [])
    const slug = (value: string, max = 60) => String(value ?? '').trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '') || 'na'
    mkdirSync(savedMockupsDir, { recursive: true })
    let saved = 0
    for (const file of files) {
      const id = Number(file.replace(/\D+/g, ''))
      const item = records.find((row) => row.id === id)
      const fileName = item ? `${slug(item.screen)}_Phase-${slug(String(item.phase))}_${slug(item.featuresCovered)}.html` : file
      writeFileSync(path.join(savedMockupsDir, fileName), readFileSync(path.join(mockupsDir, file), 'utf8'))
      saved += 1
    }
    return redirect(request, 'message', `Saved ${saved} mockup(s) to the Library.`, '/docmee-audit')
  }

  if (action === 'ai-add') {
    const name = String(form.get('name') ?? '').trim()
    if (!name) return redirect(request, 'error', 'AI name is required')
    const id = slugifyAiId(name)
    if (!id) return redirect(request, 'error', 'AI name must contain letters or numbers')
    const list = readCustomAis()
    if (list.some((ai) => ai.id === id)) return redirect(request, 'error', `An AI named "${name}" already exists`)
    const role = String(form.get('role') ?? '').trim() || 'Assistant'
    const model = String(form.get('model') ?? '').trim()
    const baseUrl = String(form.get('baseUrl') ?? '').trim()
    const consoleUrl = String(form.get('consoleUrl') ?? '').trim()
    const keyVar = String(form.get('keyVar') ?? '').trim()
    list.push({ id, name, role, model: model || undefined, baseUrl: baseUrl || undefined, consoleUrl: consoleUrl || undefined, keyVar: keyVar || undefined })
    writeCustomAis(list)
    return redirect(request, 'message', `Added ${name} (${role})`, '/agents')
  }

  if (action === 'ai-remove') {
    const id = String(form.get('id') ?? '')
    writeCustomAis(readCustomAis().filter((ai) => ai.id !== id))
    return redirect(request, 'message', 'AI removed', '/agents')
  }

  if (action === 'backlog-add') {
    const title = String(form.get('title') ?? '').trim()
    const phase = String(form.get('phase') ?? 'P01').trim()
    const priority = String(form.get('priority') ?? 'medium').trim()
    const lane = String(form.get('lane') ?? '').trim()
    if (!title) return redirect(request, 'error', 'Task title is required')
    const args = ['backlog', 'add', '--title', title, '--phase', phase, '--priority', priority]
    if (lane && lane !== 'none') args.push('--lane', lane)
    const result = runTool(args)
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? 'Task added' : 'Task add failed')
  }

  if (action === 'cost-log') {
    const provider = String(form.get('provider') ?? '').trim()
    const tokens = String(form.get('tokens') ?? '0').trim() || '0'
    if (!provider) return redirect(request, 'error', 'Provider is required')
    const result = runTool(['cost', 'log', '--provider', provider, '--tokens', tokens])
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? `Logged ${provider} cost` : 'Cost log failed')
  }

  if (action === 'cost-dev-log') {
    const phase = String(form.get('phase') ?? '').trim()
    const feature = String(form.get('feature') ?? '').trim()
    const tool = String(form.get('tool') ?? '').trim()
    if (!phase || !feature || !tool) return redirect(request, 'error', 'Phase, feature, and tool are required')
    const result = runTool([
      'cost', 'dev', 'log',
      '--phase', phase,
      '--feature', feature,
      '--tool', tool,
      '--model', String(form.get('model') ?? 'o4-mini'),
      '--input', String(form.get('input') ?? '0'),
      '--output', String(form.get('output') ?? '0'),
      '--cached', String(form.get('cached') ?? '0'),
      '--minutes', String(form.get('minutes') ?? '0'),
      '--method', String(form.get('method') ?? 'manual'),
      '--notes', String(form.get('notes') ?? '')
    ])
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? 'Development session logged' : 'Development cost log failed')
  }

  if (action === 'cost-dev-sync-claude') {
    const result = runTool(['cost', 'dev', 'sync-claude'])
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? 'Claude Code cost synced' : 'Claude Code cost sync failed')
  }

  if (action === 'cost-dev-sync-codex') {
    const result = runTool(['cost', 'dev', 'sync-codex'])
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? 'Codex cost synced (development, support, and Docmee usage)' : 'Codex cost sync failed')
  }

  if (action === 'cost-mark-current-codex-chat') {
    try {
      recordCurrentCodexChatSupport()
      return redirect(request, 'message', 'Current Codex chat marked as Docmee support. Exact usage remains pending until product usage data is available.')
    } catch (error) {
      return redirect(request, 'error', `Codex chat support marker failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (action === 'stack-refresh') {
    const source = String(form.get('source') ?? 'all')
    const args = source === 'grok'
      ? ['stack', 'news', '--grok']
      : source === 'claude'
        ? ['stack', 'news', '--claude']
        : ['stack', 'all']
    const result = runTool(args)
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? 'Stack Intelligence refreshed' : 'Stack Intelligence refresh failed')
  }

  if (action === 'stack-update-all') {
    if (String(form.get('confirm') ?? '') !== 'UPDATE_ALL_TECHNOLOGIES') {
      return redirect(request, 'error', 'Technology update was not confirmed')
    }
    const result = runTool(['stack', 'update-all'])
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? 'Technology updates applied' : 'Technology update failed')
  }

  if (action === 'docmee-update-plan') {
    const run = createDocmeeUpdatePlan()
    runTool(['discord', 'send', '--type', 'development', '--message', docmeeUpdateDiscordMessage(run)])
    return redirect(request, 'message', 'Docmee technology update plan created. Build locally before VPS deployment.')
  }

  if (action === 'docmee-update-local-check') {
    const run = runDocmeeLocalUpdateValidation()
    runTool(['discord', 'send', '--type', run.status === 'local-passed' ? 'development' : 'critical', '--message', docmeeUpdateDiscordMessage(run)])
    return redirect(
      request,
      run.status === 'local-passed' ? 'message' : 'error',
      run.status === 'local-passed'
        ? 'Docmee local validation passed. VPS deployment can continue after functionality checks.'
        : 'Docmee local validation failed. Fix the listed issue before VPS deployment.'
    )
  }

  if (action === 'codex-open') {
    const opened = openCodexApp()
    if (opened) writeCodexAccountStatus('opened', 'Codex app opened. Use the Codex account menu to confirm the active account.')
    return redirect(request, opened ? 'message' : 'error', opened ? 'Codex opened. Sign in or switch account there.' : 'Codex app could not be opened automatically.')
  }

  if (action === 'codex-logout') {
    const result = backupCodexAuth()
    if (result.ok) openCodexApp()
    return redirect(request, result.ok ? 'message' : 'error', result.message)
  }

  if (action === 'discord-test') {
    const result = runTool(['discord', 'test'])
    return redirect(
      request,
      result.ok ? 'message' : 'error',
      result.ok ? 'Discord test notification sent' : 'Discord test failed. Check the bot token, channel ID, and bot channel access.'
    )
  }

  if (action.startsWith('deploy-')) {
    const commandByAction: Record<string, string[]> = {
      'deploy-check': ['deploy', 'check'],
      'deploy-status': ['deploy', 'status'],
      'deploy-redis': ['deploy', 'redis'],
      'deploy-local': ['deploy', 'local'],
      'deploy-env': ['deploy', 'env'],
      'deploy-preflight': ['deploy', 'preflight'],
      'deploy-vps': ['deploy', 'vps'],
      'deploy-rollback': ['deploy', 'rollback']
    }
    const args = commandByAction[action]
    if (!args) return redirect(request, 'error', 'Unknown deploy action')
    const result = runTool(args)
    if (action === 'deploy-preflight') {
      const issues = (result.output || '')
        .split('\n')
        .filter((line) => /MISSING|< 5\.0|not reachable|must be production|could not reach/.test(line))
        .map((line) => line.replace(/^\[[^\]]*\]\s*/, '').trim())
        .filter(Boolean)
      return redirect(
        request,
        result.ok ? 'message' : 'error',
        result.ok
          ? 'Preflight passed — the VPS looks deploy-ready.'
          : `Preflight blocked: ${issues.join(' · ').slice(0, 320) || 'see deploy logs for details'}`
      )
    }
    if (action === 'deploy-vps') {
      if (!result.ok) {
        return redirect(request, 'error', 'VPS deployment request failed before verification could run.')
      }
      const run = await runVpsPostDeploymentChecks()
      const failed = run.summary.fail > 0
      runTool([
        'discord',
        'send',
        '--type',
        failed ? 'critical' : 'development',
        '--message',
        failed ? postDeploymentDiscordMessage(run) : vpsDeploymentSuccessMessage(run)
      ])
      return redirect(
        request,
        failed ? 'error' : 'message',
        failed
          ? `VPS deployment requested, but verification found ${run.summary.fail} issue${run.summary.fail === 1 ? '' : 's'}.`
          : `VPS deployment successful. ${run.summary.pass} checks passed and the app is ready.`
      )
    }
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? 'Deploy command completed' : 'Deploy command reported a warning or failure')
  }

  if (action.startsWith('diagnose-')) {
    const category = String(form.get('category') ?? '')
    const commandByAction: Record<string, string[]> = {
      'diagnose-run': ['diagnose'],
      'diagnose-quick': ['diagnose', '--quick'],
      'diagnose-fix': ['diagnose', '--fix']
    }
    const args = commandByAction[action]
    if (!args) return redirect(request, 'error', 'Unknown diagnostic action')
    if (category) args.push('--category', category)
    const result = runTool(args)
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? 'Diagnostics completed' : 'Diagnostics found critical issues')
  }

  if (action === 'healer-refresh-derived-deployment-records') {
    const result = refreshDerivedDeploymentRecords()
    return redirect(request, result.ok ? 'message' : 'error', result.message, '/healer')
  }

  if (action.startsWith('agents-')) {
    const role = String(form.get('role') ?? '')
    const service = String(form.get('service') ?? '')
    const model = String(form.get('model') ?? '')
    const phase = String(form.get('phase') ?? 'P01')
    const commandByAction: Record<string, string[]> = {
      'agents-enable': ['agents', 'enable', '--role', role],
      'agents-disable': ['agents', 'disable', '--role', role],
      'agents-run': ['agents', 'run', '--role', role, '--phase', phase],
      'agents-test': ['agents', 'test', '--service', service],
      'agents-set-service': ['agents', 'set', '--role', role, ...(service ? ['--service', service] : []), ...(model ? ['--model', model] : [])],
      'agents-reset': ['agents', 'reset']
    }
    const args = commandByAction[action]
    if (!args) return redirect(request, 'error', 'Unknown agent action')
    const result = runTool(args)
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? 'Agent action completed' : 'Agent action needs configuration')
  }

  if (action === 'accept-run') {
    const step = String(form.get('step') ?? '')
    const args = step ? ['accept', '--step', step] : ['accept']
    const result = runTool(args)
    return redirect(request, result.ok ? 'message' : 'error', result.ok ? 'Acceptance check passed' : 'Acceptance check needs product app phases')
  }

  return redirect(request, 'error', 'Unknown action')
}
