import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { Command } from 'commander'
import { readJson, writeJson } from '../lib/json-store.js'
import { log } from '../lib/logger.js'
import { logsDir, toolsRoot } from '../lib/paths.js'
import { claudeCodeCommand, claudeCodeEnvironment } from '../lib/claude-code.js'
import { engineForProvider, llmChat, autoProvider } from '../lib/llm.js'
import { logActivity } from '../lib/activity.js'
import { logUsage } from '../lib/usage.js'

type Priority = 'critical' | 'high' | 'medium' | 'low' | 'infrastructure'
type Status = 'todo' | 'in-progress' | 'plan-review' | 'blocked' | 'review' | 'done'
type Lane = 'backend' | 'frontend' | 'ui' | 'infra'
type Assignee = 'auto' | 'claude' | 'codex' | 'grok' | 'cursor' | 'gemini' | 'deepseek'
const ASSIGNEES: Assignee[] = ['auto', 'claude', 'codex', 'grok', 'cursor', 'gemini', 'deepseek']
// `auto`/`key`/`source` mark items collected by `backlog sync` (TODO/FIXME scan)
// so re-runs dedup by key and auto-remove items whose comment was deleted.
// `assignee`/`plan`/`commit`/`pr` drive the resolution workflow + Claude handoff.
type Task = {
  id: number
  phase: string
  priority: Priority
  title: string
  status: Status
  lane?: Lane
  auto?: 'todo'
  key?: string
  source?: string
  flag?: 'possibly-shipped'
  assignee?: Assignee
  plan?: string
  confidence?: number
  planApproved?: boolean
  commit?: string
  pr?: string
  verifyConfidence?: number
  verifyReason?: string
  result?: string
  resultProvider?: string
}
const STATUSES: Status[] = ['todo', 'in-progress', 'plan-review', 'blocked', 'review', 'done']
const CONFIDENCE_THRESHOLD = 8

const SCAN_DIRS = ['apps', 'packages']
const SCAN_EXT = new Set(['.ts', '.tsx', '.js', '.jsx'])
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage', '.git'])

function repoRoot() {
  return path.resolve(toolsRoot, '..')
}

function walkFiles(dir: string, out: string[]) {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(full, out)
    else if (SCAN_EXT.has(path.extname(entry.name))) out.push(full)
  }
}

function laneForPath(rel: string): Lane {
  if (rel.startsWith('apps/api') || rel.startsWith('apps/workers')) return 'backend'
  if (rel.startsWith('apps/inboxos')) return 'frontend'
  return 'infra'
}

type FoundTodo = { key: string; tag: string; text: string; lane: Lane; source: string }

function scanTodos(): FoundTodo[] {
  const root = repoRoot()
  const found: FoundTodo[] = []
  for (const base of SCAN_DIRS) {
    const dir = path.join(root, base)
    if (!fs.existsSync(dir)) continue
    const files: string[] = []
    walkFiles(dir, files)
    for (const file of files) {
      let lines: string[]
      try {
        lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
      } catch {
        continue
      }
      lines.forEach((line, index) => {
        const match = line.match(/\/\/\s*(TODO|FIXME|HACK)\b:?\s*(.*)$/i)
        if (!match) return
        const tag = match[1].toUpperCase()
        const text = (match[2] || '').trim() || '(no description)'
        const rel = path.relative(root, file).replace(/\\/g, '/')
        found.push({ key: `${tag}:${rel}:${index + 1}`, tag, text, lane: laneForPath(rel), source: `${rel}:${index + 1}` })
      })
    }
  }
  return found
}

// Map of backlog id -> short commit hash, from commits whose message references
// "backlog #N" (latest first). Drives automatic status advancement.
function gitResolvedRefs(): Map<number, string> {
  const map = new Map<number, string>()
  try {
    const result = spawnSync('git', ['log', '-i', '--grep=backlog #', '-n', '300', '--pretty=%h%x09%s'], { cwd: repoRoot(), encoding: 'utf8', timeout: 8000, windowsHide: true })
    if (result.status !== 0) return map
    for (const line of (result.stdout || '').split(/\r?\n/)) {
      const tab = line.indexOf('\t')
      if (tab < 0) continue
      const hash = line.slice(0, tab).trim()
      const match = line.slice(tab + 1).match(/backlog #(\d+)/i)
      if (hash && match && !map.has(Number(match[1]))) map.set(Number(match[1]), hash)
    }
  } catch {
    // git unavailable — skip auto-advance.
  }
  return map
}

// Auto-collect: scan code for TODO/FIXME (add new, drop resolved), flag items
// matching completed features/screens, and auto-advance items with a resolving
// commit to review.
export function syncBacklog() {
  const tasks = getTasks()
  const found = scanTodos()
  const foundKeys = new Set(found.map((f) => f.key))
  const existingAutoKeys = new Set(tasks.filter((t) => t.auto === 'todo' && t.key).map((t) => t.key as string))

  // Drop auto items whose comment no longer exists in code.
  const kept = tasks.filter((t) => !(t.auto === 'todo' && t.key && !foundKeys.has(t.key)))
  const removed = tasks.length - kept.length

  // Add newly-found TODO/FIXME comments.
  let nextId = Math.max(0, ...kept.map((t) => t.id)) + 1
  let added = 0
  for (const f of found) {
    if (existingAutoKeys.has(f.key)) continue
    kept.push({
      id: nextId++,
      phase: 'TODO',
      priority: f.tag === 'FIXME' ? 'high' : 'medium',
      title: `${f.tag}: ${f.text}`,
      status: 'todo',
      lane: f.lane,
      auto: 'todo',
      key: f.key,
      source: f.source
    })
    added += 1
  }

  // Staleness guard: close open manual items matching a completed feature/screen.
  const features = readJson<Array<{ feature?: string; status?: string }>>('rev1-feature-coverage.json', [])
  const screens = readJson<Array<{ screen?: string; status?: string }>>('ui-development-records.json', [])
  const doneNames = [
    ...features.filter((f) => f.status === 'complete').map((f) => (f.feature ?? '').toLowerCase().trim()),
    ...screens.filter((s) => s.status === 'complete').map((s) => (s.screen ?? '').toLowerCase().trim())
  ].filter((name) => name.length >= 5)
  // Flag (do NOT auto-close) open manual items that look already-shipped, so the
  // user reviews them — the coverage data can over-claim completion. Auto items
  // are handled by the scan above. Self-clears the flag when no longer matching.
  let flagged = 0
  for (const t of kept) {
    if (t.auto === 'todo') continue
    const title = (t.title ?? '').toLowerCase().trim()
    const looksShipped = t.status !== 'done' && title.length >= 6 && doneNames.some((name) => name.includes(title))
    if (looksShipped) {
      t.flag = 'possibly-shipped'
      flagged += 1
    } else if (t.flag === 'possibly-shipped') {
      delete t.flag
    }
  }

  // Auto-advance status from real signals: any open item with a commit that
  // references "backlog #N" has been worked on → move it to review + record it.
  let advanced = 0
  const resolvedRefs = gitResolvedRefs()
  for (const t of kept) {
    const ref = resolvedRefs.get(t.id)
    if (ref && ['todo', 'in-progress', 'blocked', 'plan-review'].includes(t.status)) {
      t.status = 'review'
      if (!t.commit) t.commit = ref
      advanced += 1
    }
  }

  saveTasks(kept)
  return { added, removed, flagged, advanced, scanned: found.length }
}

const seedTitles = [
  ['P01', 'critical', 'missing exports'],
  ['P01', 'critical', 'webhook route'],
  ['P01', 'critical', 'transcription worker'],
  ['P01', 'critical', 'notifications repo'],
  ['P01', 'critical', 'kb repo'],
  ['P01', 'critical', 'notification routes'],
  ['P01', 'critical', 'heartbeat route'],
  ['P01', 'high', 'countActive()'],
  ['P01', 'high', 'Calendar OAuth'],
  ['P01', 'high', 'encrypt naming'],
  ['P01', 'high', 'conversation/messages repos'],
  ['P01', 'high', 'tags system'],
  ['P01', 'high', 'internal notes'],
  ['P01', 'high', 'i18n toggle'],
  ['P01', 'high', 'new/returning patient'],
  ['P01', 'high', 'reschedule+cancel'],
  ['P01', 'high', 'error review'],
  ['P01', 'high', 'Meta token expiry'],
  ['P01', 'high', 'Admin Studio panel'],
  ['P01', 'high', 'installer-core files'],
  ['P01', 'high', 'vitest.config and docker-compose'],
  ['P02', 'medium', 'Messenger'],
  ['P02', 'medium', 'Instagram'],
  ['P02', 'medium', 'assignment UI'],
  ['P02', 'medium', 'quick replies'],
  ['P02', 'medium', 'patient history'],
  ['P02', 'medium', 'metrics dashboard'],
  ['P02', 'medium', 'follow-up automation'],
  ['P02', 'medium', 'WhatsApp templates'],
  ['P02', 'medium', 'sentiment detection'],
  ['P02', 'medium', 'PWA'],
  ['P03', 'low', 'multi-doctor'],
  ['P03', 'low', 'document training'],
  ['P03', 'low', 'custom flows'],
  ['P03', 'low', 'Google Sheets'],
  ['P03', 'low', 'reports'],
  ['P03', 'low', 'review automation'],
  ['P03', 'low', 'mobile app'],
  ['P03', 'low', 'advanced analytics'],
  ['P00', 'infrastructure', 'integration tests'],
  ['P00', 'infrastructure', 'E2E tests'],
  ['P00', 'infrastructure', 'CI/CD pipeline'],
  ['P00', 'infrastructure', 'vitest config'],
  ['P00', 'infrastructure', 'docker-compose'],
  ['P00', 'infrastructure', 'operations runbook'],
  ['P00', 'infrastructure', 'Claude usage-limit pause and automatic resume guard'],
  ['P00', 'infrastructure', 'Build Control paused state with Claude reset countdown'],
  ['P00', 'infrastructure', 'Discord notice when Claude usage guard pauses or resumes']
] as const

export function seedBacklog() {
  const tasks = seedTitles.map(([phase, priority, title], index) => ({
    id: index + 1,
    phase,
    priority,
    title,
    status: 'todo' as const
  }))
  saveTasks(tasks)
  return tasks.length
}

function getTasks() {
  return readJson<Task[]>('backlog.json', [])
}

function saveTasks(tasks: Task[]) {
  writeJson('backlog.json', tasks)
}

export const backlogCmd = new Command('backlog')
  .description('Manage DevTools backlog')
  .command('init')
  .description('Seed 45 known gaps')
  .action(() => {
    const count = seedBacklog()
    log('backlog', `Seeded ${count} backlog tasks`)
  })
  .parent!

backlogCmd
  .command('list')
  .option('--phase <phase>')
  .option('--priority <priority>')
  .action((opts: { phase?: string; priority?: string }) => {
    const tasks = getTasks().filter((task) => {
      return (!opts.phase || task.phase === opts.phase) && (!opts.priority || task.priority === opts.priority)
    })
    console.table(tasks)
  })

backlogCmd
  .command('add')
  .requiredOption('--title <title>')
  .requiredOption('--phase <phase>')
  .requiredOption('--priority <priority>')
  .option('--lane <lane>', 'Target lane: backend, frontend, ui, or infra')
  .action((opts: { title: string; phase: string; priority: Priority; lane?: string }) => {
    const tasks = getTasks()
    const nextId = Math.max(0, ...tasks.map((task) => task.id)) + 1
    const lane = (['backend', 'frontend', 'ui', 'infra'] as const).find((value) => value === opts.lane)
    tasks.push({ id: nextId, title: opts.title, phase: opts.phase, priority: opts.priority, status: 'todo', ...(lane ? { lane } : {}) })
    saveTasks(tasks)
    log('backlog', `Added task ${nextId}`)
  })

backlogCmd
  .command('done')
  .requiredOption('--id <id>')
  .action((opts: { id: string }) => {
    const id = Number(opts.id)
    const tasks = getTasks()
    const task = tasks.find((item) => item.id === id)
    if (!task) {
      log('backlog', `Task ${id} not found`, 'error')
      process.exitCode = 1
      return
    }
    task.status = 'done'
    saveTasks(tasks)
    log('backlog', `Marked task ${id} done`)
    logActivity({ actor: 'user', event: 'approve.done', severity: 'success', source: 'backlog', taskId: id, message: `Approved & marked #${id} done: ${task.title}` })
  })

backlogCmd
  .command('set')
  .description('Set a task status (todo, in-progress, blocked, done)')
  .requiredOption('--id <id>')
  .requiredOption('--status <status>')
  .action((opts: { id: string; status: string }) => {
    const id = Number(opts.id)
    const status = opts.status as Status
    if (!STATUSES.includes(status)) {
      log('backlog', `Invalid status "${opts.status}". Use one of: ${STATUSES.join(', ')}`, 'error')
      process.exitCode = 1
      return
    }
    const tasks = getTasks()
    const task = tasks.find((item) => item.id === id)
    if (!task) {
      log('backlog', `Task ${id} not found`, 'error')
      process.exitCode = 1
      return
    }
    task.status = status
    saveTasks(tasks)
    log('backlog', `Task ${id} set to ${status}`)
  })

backlogCmd
  .command('remove')
  .description('Delete a backlog task')
  .requiredOption('--id <id>')
  .action((opts: { id: string }) => {
    const id = Number(opts.id)
    const tasks = getTasks()
    const next = tasks.filter((item) => item.id !== id)
    if (next.length === tasks.length) {
      log('backlog', `Task ${id} not found`, 'error')
      process.exitCode = 1
      return
    }
    saveTasks(next)
    log('backlog', `Removed task ${id}`)
  })

backlogCmd
  .command('update')
  .description('Update resolution fields on a task (assignee, plan, commit, pr)')
  .requiredOption('--id <id>')
  .option('--assignee <assignee>', ASSIGNEES.join(' | '))
  .option('--plan <plan>')
  .option('--commit <commit>')
  .option('--pr <pr>')
  .action((opts: { id: string; assignee?: string; plan?: string; commit?: string; pr?: string }) => {
    const id = Number(opts.id)
    const tasks = getTasks()
    const task = tasks.find((item) => item.id === id)
    if (!task) {
      log('backlog', `Task ${id} not found`, 'error')
      process.exitCode = 1
      return
    }
    if (opts.assignee && (ASSIGNEES as string[]).includes(opts.assignee)) task.assignee = opts.assignee as Assignee
    if (opts.plan !== undefined) task.plan = opts.plan
    if (opts.commit !== undefined) task.commit = opts.commit
    if (opts.pr !== undefined) task.pr = opts.pr
    saveTasks(tasks)
    log('backlog', `Task ${id} updated`)
  })

const backlogRunFile = path.join(logsDir, 'backlog-run.json')
function touchBacklogRun(partial: Record<string, unknown>) {
  let current: Record<string, unknown> = {}
  try { current = JSON.parse(fs.readFileSync(backlogRunFile, 'utf8')) as Record<string, unknown> } catch { current = {} }
  fs.mkdirSync(logsDir, { recursive: true })
  fs.writeFileSync(backlogRunFile, `${JSON.stringify({ ...current, ...partial, workflow: 'backlog-resolve', heartbeatAt: new Date().toISOString() }, null, 2)}\n`)
}

const RESOLVE_TIMEOUT_MS = 12 * 60 * 1000

// Per-phase model tiering (token-saving). Read-only analytical phases (plan,
// verify) run on a cheap model; the agentic implement phase keeps the default
// (strong) Claude Code model. Override any via .env.tools / env vars.
const PLAN_MODEL = process.env.BACKLOG_PLAN_MODEL || 'haiku'
const VERIFY_MODEL = process.env.BACKLOG_VERIFY_MODEL || 'haiku'
const IMPLEMENT_MODEL = process.env.BACKLOG_IMPLEMENT_MODEL || '' // '' → Claude Code default

type RunUsage = { model?: string; costUSD?: number; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number }

function killTree(pid?: number) {
  if (!pid) return
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true })
    else process.kill(pid, 'SIGKILL')
  } catch {
    // already gone
  }
}

// Single-shot headless Claude Code run. Uses --output-format json so we capture
// token/cost usage; the model text is in `.result`. Optional `model` selects a
// cheaper tier. Hard timeout kills a hung run (exit 124) so it can't wedge the
// backlog in `running` forever.
function runClaudeHeadless(prompt: string, message: string, model?: string, timeoutMs = RESOLVE_TIMEOUT_MS): Promise<{ code: number; output: string; usage: RunUsage }> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const args = ['--print', '--dangerously-skip-permissions', '--add-dir', repoRoot(), '--output-format', 'json']
    if (model) args.push('--model', model)
    const child = spawn(claudeCodeCommand(), args, {
      cwd: repoRoot(), env: claudeCodeEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
    })
    const heartbeat = setInterval(() => touchBacklogRun({ pid: child.pid, status: 'running', message }), 10000)
    const finish = (code: number) => {
      if (settled) return
      settled = true
      clearInterval(heartbeat)
      clearTimeout(timer)
      // Parse the JSON envelope for the result text + usage; fall back to raw.
      let output = (stdout || stderr).trim()
      let usage: RunUsage = { model }
      let resolved = code
      try {
        const parsed = JSON.parse(stdout.trim()) as { result?: unknown; is_error?: boolean; total_cost_usd?: number; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } }
        if (typeof parsed.result === 'string') output = parsed.result.trim()
        usage = {
          model,
          costUSD: parsed.total_cost_usd,
          inputTokens: parsed.usage?.input_tokens,
          outputTokens: parsed.usage?.output_tokens,
          cacheReadTokens: parsed.usage?.cache_read_input_tokens
        }
        if (parsed.is_error && resolved === 0) resolved = 1
      } catch {
        // non-JSON output (e.g. early crash) — keep raw text, no usage
      }
      resolve({ code: resolved, output, usage })
    }
    const timer = setTimeout(() => {
      log('backlog', `Claude run exceeded ${Math.round(timeoutMs / 60000)} min — aborting.`, 'warn')
      killTree(child.pid)
      finish(124)
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk); log('backlog', String(chunk).trim(), 'warn') })
    child.on('error', () => finish(1))
    child.on('close', (exit) => finish(exit ?? 1))
    child.stdin.end(prompt)
  })
}

// Resolve an item end-to-end with the assigned AI, fully hands-off:
//  1. A non-Claude AI (Grok/Gemini/DeepSeek/Codex) first DRAFTS a resolution.
//  2. Claude Code then IMPLEMENTS it (or resolves directly when Claude is the
//     assignee / no AI key is available) and commits.
//  3. The fix is auto-VERIFIED; confidence >= threshold auto-approves (done),
//     below leaves it in review with the reason.
async function resolveTask(id: number, provider = 'auto'): Promise<number> {
  const tasks = getTasks()
  const task = tasks.find((item) => item.id === id)
  if (!task) { log('backlog', `Task ${id} not found`, 'error'); return 1 }
  // Auto-routing: pick the preferred funded AI now, transparently.
  if (provider === 'auto') {
    const picked = autoProvider()
    log('backlog', `Auto-routing #${id} → ${picked}.`)
    logActivity({ actor: 'system', event: 'auto.route', severity: 'info', source: 'backlog', taskId: id, message: `Auto selected ${picked} for #${id}.` })
    provider = picked
  }
  task.status = 'in-progress'
  saveTasks(tasks)
  const planLine = (task.plan && task.plan.trim()) || 'Investigate the relevant code, design a focused fix, and implement it.'
  touchBacklogRun({ pid: process.pid, status: 'running', startedAt: new Date().toISOString(), phase: task.lane ?? 'backlog', currentId: task.id, message: `Resolving backlog #${id} with ${provider}: ${task.title}` })
  logActivity({ actor: provider, event: 'resolve.start', severity: 'info', source: 'backlog', taskId: id, message: `Resolving #${id}: ${task.title}` })

  // Step 1 — non-Claude AI drafts a concrete resolution (Claude implements it).
  let proposal: string | null = null
  if (provider !== 'claude' && provider !== 'claude-code') {
    const engine = engineForProvider(provider)
    if (engine) {
      touchBacklogRun({ status: 'running', message: `${provider} is drafting a resolution for #${id}…` })
      const draftPrompt = [
        `You are resolving a backlog item for the Docmee codebase (a TypeScript monorepo).`,
        `Item #${task.id}: ${task.title}.`,
        `Lane: ${task.lane ?? 'unspecified'} · Phase: ${task.phase} · Priority: ${task.priority}.`,
        '',
        'Plan / instruction:',
        planLine,
        '',
        'Produce a concrete, ready-to-apply resolution:',
        '1. Root cause / what to change and why.',
        '2. The exact code changes (a diff or full file snippets with paths).',
        '3. Steps to apply, plus any commands/tests to run.',
        'Be specific and concise.'
      ].join('\n')
      proposal = await llmChat(draftPrompt, engine)
      if (proposal) {
        const t = getTasks()
        const u = t.find((item) => item.id === id)
        if (u) { u.result = proposal; u.resultProvider = `${provider}:${engine.model}`; saveTasks(t) }
        log('backlog', `${provider} drafted a resolution for #${id} — handing to Claude to implement.`)
        logActivity({ actor: provider, event: 'draft.done', severity: 'success', source: 'backlog', taskId: id, message: `${provider} drafted a fix for #${id} — handing to Claude.` })
      } else {
        log('backlog', `${provider} produced no draft for #${id} — Claude will resolve directly.`, 'warn')
      }
    } else {
      log('backlog', `No API key for "${provider}" — Claude will resolve #${id} directly.`, 'warn')
    }
  }

  // Step 2 — Claude Code implements (the AI's draft, or the plan directly) + commits.
  const implementMessage = `Resolving backlog #${id}: ${task.title}`
  const prompt = proposal
    ? [
        `Implement the resolution for Docmee backlog item #${task.id}: ${task.title}.`,
        `Lane: ${task.lane ?? 'unspecified'} · Phase: ${task.phase} · Priority: ${task.priority}.`,
        '',
        `${provider} proposed the solution below — use it as the basis, adapting where it does not match the actual code:`,
        '---',
        proposal,
        '---',
        '',
        'Requirements:',
        '- Work locally; keep changes scoped to this item.',
        '- Run the relevant local checks.',
        `- Commit with a clear message referencing "backlog #${task.id}".`,
        '- Report what you changed.'
      ].join('\n')
    : [
        `Resolve Docmee backlog item #${task.id}: ${task.title}.`,
        `Lane: ${task.lane ?? 'unspecified'} · Phase: ${task.phase} · Priority: ${task.priority}.`,
        '',
        'Plan / instruction:',
        planLine,
        '',
        'Requirements:',
        '- Work locally; keep changes scoped to this item.',
        '- Run the relevant local checks.',
        `- Commit with a clear message referencing "backlog #${task.id}".`,
        '- Report what you changed.'
      ].join('\n')
  touchBacklogRun({ status: 'running', message: proposal ? `Claude is implementing #${id} from ${provider}'s plan…` : implementMessage })
  const { code, usage } = await runClaudeHeadless(prompt, implementMessage, IMPLEMENT_MODEL || undefined)
  logUsage({ phase: 'implement', taskId: id, ...usage })
  const after = getTasks()
  const updated = after.find((item) => item.id === id)
  if (updated) {
    updated.status = code === 0 ? 'review' : 'blocked'
    if (code === 0) {
      const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot(), encoding: 'utf8', windowsHide: true })
      if (head.status === 0) updated.commit = (head.stdout || '').trim()
    }
    saveTasks(after)
  }
  touchBacklogRun({ status: code === 0 ? 'running' : 'failed', message: code === 0 ? `Backlog #${id} implemented — verifying…` : `Backlog #${id} resolution failed (exit ${code}).` })
  if (code === 0) {
    logActivity({ actor: 'claude', event: 'resolve.done', severity: 'success', source: 'backlog', taskId: id, message: `Implemented #${id}${updated?.commit ? ` (commit ${updated.commit})` : ''} — verifying.` })
  } else {
    logActivity({ actor: 'claude', event: 'resolve.fail', severity: 'error', source: 'backlog', taskId: id, message: `Resolution failed for #${id} (exit ${code}).` })
    return code
  }

  // Step 3 — auto-verify (verifyTask auto-approves when confidence >= threshold).
  try {
    await verifyTask(id, CONFIDENCE_THRESHOLD)
  } catch (error) {
    log('backlog', `Auto-verify failed for #${id} — ${(error as Error).message}. Left in review.`, 'warn')
  }
  return 0
}

// Parse the planning run's JSON ({confidence, plan}); fall back to a low score
// (so it errs toward requiring approval) if the model didn't return clean JSON.
function parsePlan(output: string): { confidence: number; plan: string } {
  const stripped = output.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const tryParse = (text: string) => {
    try {
      const parsed = JSON.parse(text) as { confidence?: unknown; plan?: unknown }
      if (typeof parsed.confidence === 'number') {
        return { confidence: Math.max(1, Math.min(10, Math.round(parsed.confidence))), plan: String(parsed.plan ?? text) }
      }
    } catch {
      // not JSON
    }
    return null
  }
  let result = tryParse(stripped)
  if (!result) {
    const match = stripped.match(/\{[\s\S]*\}/)
    if (match) result = tryParse(match[0])
  }
  return result ?? { confidence: 5, plan: output.trim().slice(0, 2000) || 'No plan produced.' }
}

// Auto-plan: Claude drafts a plan + self-rates confidence. >= threshold → plan
// auto-approved (and, with --auto, resolved immediately); below → plan-review.
async function planTask(id: number, threshold: number, auto: boolean, provider = 'claude'): Promise<void> {
  const tasks = getTasks()
  const task = tasks.find((item) => item.id === id)
  if (!task) { log('backlog', `Task ${id} not found`, 'error'); process.exitCode = 1; return }
  task.status = 'in-progress'
  saveTasks(tasks)
  const message = `Planning backlog #${id}: ${task.title}`
  touchBacklogRun({ pid: process.pid, status: 'running', startedAt: new Date().toISOString(), phase: task.lane ?? 'backlog', currentId: task.id, message })
  const prompt = [
    `Produce a resolution PLAN for Docmee backlog item #${task.id}: ${task.title}.`,
    `Lane: ${task.lane ?? 'unspecified'} · Phase: ${task.phase} · Priority: ${task.priority}.`,
    '',
    'Investigate the relevant code, then write a concise numbered plan to resolve it.',
    'Also rate your CONFIDENCE from 1-10 that this plan is correct and low-risk to auto-implement WITHOUT human review.',
    'Do NOT change any code now — planning only.',
    '',
    'Respond with ONLY a JSON object (no prose, no code fences):',
    '{"confidence": <integer 1-10>, "plan": "<numbered steps>"}'
  ].join('\n')
  const { output, usage } = await runClaudeHeadless(prompt, message, PLAN_MODEL)
  logUsage({ phase: 'plan', taskId: id, ...usage })
  const { confidence, plan } = parsePlan(output)
  const after = getTasks()
  const updated = after.find((item) => item.id === id)
  if (!updated) return
  updated.plan = plan
  updated.confidence = confidence
  if (confidence >= threshold) {
    updated.planApproved = true
    saveTasks(after)
    touchBacklogRun({ status: 'complete', message: `Plan auto-approved (confidence ${confidence}/10 ≥ ${threshold}).` })
    log('backlog', `Backlog #${id} plan confidence ${confidence}/10 ≥ ${threshold} — auto-approved.`)
    if (auto) await resolveTask(id, provider)
  } else {
    updated.planApproved = false
    updated.status = 'plan-review'
    saveTasks(after)
    touchBacklogRun({ status: 'complete', message: `Plan needs your approval (confidence ${confidence}/10 < ${threshold}).` })
    log('backlog', `Backlog #${id} plan confidence ${confidence}/10 < ${threshold} — awaiting approval.`)
  }
}

// Parse the verification run's JSON ({confidence, reason}); fall back low so it
// errs toward requiring review when the model didn't return clean JSON.
function parseVerify(output: string): { confidence: number; reason: string } {
  const stripped = output.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const tryParse = (text: string) => {
    try {
      const parsed = JSON.parse(text) as { confidence?: unknown; reason?: unknown }
      if (typeof parsed.confidence === 'number') {
        return { confidence: Math.max(1, Math.min(10, Math.round(parsed.confidence))), reason: String(parsed.reason ?? '').trim() }
      }
    } catch {
      // not JSON
    }
    return null
  }
  let result = tryParse(stripped)
  if (!result) {
    const match = stripped.match(/\{[\s\S]*\}/)
    if (match) result = tryParse(match[0])
  }
  return result ?? { confidence: 5, reason: output.trim().slice(0, 2000) || 'No verification output produced.' }
}

// Verify a fix actually works: Claude inspects the code/commit and rates 1-10 how
// sure the item is genuinely resolved. >= threshold → done; below → status
// 'review' with the reason captured so the user can read it and approve.
async function verifyTask(id: number, threshold: number): Promise<void> {
  const tasks = getTasks()
  const task = tasks.find((item) => item.id === id)
  if (!task) { log('backlog', `Task ${id} not found`, 'error'); process.exitCode = 1; return }
  const message = `Verifying backlog #${id}: ${task.title}`
  touchBacklogRun({ pid: process.pid, status: 'running', startedAt: new Date().toISOString(), phase: task.lane ?? 'backlog', currentId: task.id, message })
  const prompt = [
    `VERIFY whether Docmee backlog item #${task.id} is actually fixed: ${task.title}.`,
    `Lane: ${task.lane ?? 'unspecified'} · Phase: ${task.phase} · Priority: ${task.priority}.`,
    task.commit ? `A fix was committed at ${task.commit}.` : '',
    task.plan && task.plan.trim() ? `Intended fix / plan:\n${task.plan}` : '',
    '',
    'Investigate the relevant code (and the commit if given). Run or inspect the relevant checks.',
    'Do NOT change any code — verification only.',
    'Rate your CONFIDENCE from 1-10 that the item is genuinely resolved and working.',
    'The reason MUST clearly state what is verified, or what is missing/broken/unverified if not.',
    '',
    'Respond with ONLY a JSON object (no prose, no code fences):',
    '{"confidence": <integer 1-10>, "reason": "<one short paragraph>"}'
  ].filter(Boolean).join('\n')
  const { output, usage } = await runClaudeHeadless(prompt, message, VERIFY_MODEL)
  logUsage({ phase: 'verify', taskId: id, ...usage })
  const { confidence, reason } = parseVerify(output)
  const after = getTasks()
  const updated = after.find((item) => item.id === id)
  if (!updated) return
  updated.verifyConfidence = confidence
  updated.verifyReason = reason
  if (confidence >= threshold) {
    updated.status = 'done'
    saveTasks(after)
    touchBacklogRun({ status: 'complete', message: `Verified resolved (confidence ${confidence}/10 ≥ ${threshold}) — marked done.` })
    log('backlog', `Backlog #${id} verified ${confidence}/10 ≥ ${threshold} — marked done.`)
    logActivity({ actor: 'claude', event: 'verify.pass', severity: 'success', source: 'backlog', taskId: id, message: `Verified #${id} (${confidence}/10 ≥ ${threshold}) — done.` })
  } else {
    updated.status = 'review'
    saveTasks(after)
    touchBacklogRun({ status: 'complete', message: `Verification needs review (confidence ${confidence}/10 < ${threshold}).` })
    log('backlog', `Backlog #${id} verification ${confidence}/10 < ${threshold} — flagged for review.`)
    logActivity({ actor: 'claude', event: 'verify.flag', severity: 'warn', source: 'backlog', taskId: id, message: `#${id} flagged for review (confidence ${confidence}/10 < ${threshold}).` })
  }
}

// Sequentially work the whole backlog: for each open "todo" item Claude drafts a
// plan + confidence, then the gate decides — >= threshold auto-resolves (implement
// + commit), below queues it to plan-review for the user. One item at a time so the
// Claude runs never collide on git. Progress is streamed to backlog-run.json.
async function autoResolveAll(threshold: number): Promise<void> {
  const queue = getTasks().filter((task) => task.status === 'todo')
  const total = queue.length
  if (total === 0) {
    touchBacklogRun({ status: 'complete', autoResolve: true, total: 0, processed: 0, message: 'Auto-resolve: no open todo items.' })
    log('backlog', 'Auto-resolve: nothing to do.')
    return
  }
  let processed = 0
  let resolved = 0
  let queued = 0
  let failed = 0
  touchBacklogRun({ pid: process.pid, status: 'running', startedAt: new Date().toISOString(), autoResolve: true, total, processed, resolved, queued, failed, message: `Auto-resolving ${total} item(s) (threshold ${threshold}/10)…` })
  log('backlog', `Auto-resolve: starting on ${total} todo item(s) at threshold ${threshold}/10.`)
  for (const item of queue) {
    const pre = getTasks()
    const target = pre.find((task) => task.id === item.id)
    if (target) { target.assignee = 'claude'; saveTasks(pre) }
    touchBacklogRun({ status: 'running', autoResolve: true, total, processed, resolved, queued, failed, currentId: item.id, currentTitle: item.title, message: `(${processed + 1}/${total}) Planning #${item.id}: ${item.title}` })
    try {
      await planTask(item.id, threshold, true)
    } catch (error) {
      log('backlog', `Auto-resolve: #${item.id} errored — ${(error as Error).message}`, 'error')
    }
    const after = getTasks().find((task) => task.id === item.id)
    if (after?.status === 'review' || after?.status === 'done') resolved += 1
    else if (after?.status === 'plan-review') queued += 1
    else failed += 1
    processed += 1
    touchBacklogRun({ status: 'running', autoResolve: true, total, processed, resolved, queued, failed, currentId: item.id, message: `(${processed}/${total}) ${resolved} resolved · ${queued} need approval · ${failed} failed` })
  }
  touchBacklogRun({ status: 'complete', autoResolve: true, total, processed, resolved, queued, failed, currentId: null, message: `Auto-resolve done: ${resolved} resolved, ${queued} need approval, ${failed} failed.` })
  log('backlog', `Auto-resolve complete: ${resolved} resolved, ${queued} awaiting approval, ${failed} failed.`)
}

// Bulk verify every item awaiting review: run the verification check on each
// 'review' item in turn. >= threshold marks it done; below leaves it flagged
// with a reason. Mirrors auto-resolve but for the review -> done step.
async function verifyAllReview(threshold: number): Promise<void> {
  const queue = getTasks().filter((task) => task.status === 'review')
  const total = queue.length
  if (total === 0) {
    touchBacklogRun({ status: 'complete', verifyAll: true, autoResolve: false, total: 0, processed: 0, message: 'Verify-all: no items awaiting verification.' })
    log('backlog', 'Verify-all: nothing to verify.')
    return
  }
  let processed = 0
  let resolved = 0
  let queued = 0
  let failed = 0
  touchBacklogRun({ pid: process.pid, status: 'running', startedAt: new Date().toISOString(), verifyAll: true, autoResolve: false, total, processed, resolved, queued, failed, message: `Verifying ${total} item(s) awaiting review (threshold ${threshold}/10)…` })
  log('backlog', `Verify-all: starting on ${total} review item(s) at threshold ${threshold}/10.`)
  for (const item of queue) {
    touchBacklogRun({ status: 'running', verifyAll: true, total, processed, resolved, queued, failed, currentId: item.id, message: `(${processed + 1}/${total}) Verifying #${item.id}: ${item.title}` })
    try {
      await verifyTask(item.id, threshold)
    } catch (error) {
      log('backlog', `Verify-all: #${item.id} errored — ${(error as Error).message}`, 'error')
    }
    const after = getTasks().find((task) => task.id === item.id)
    if (after?.status === 'done') resolved += 1
    else if (after?.status === 'review') queued += 1
    else failed += 1
    processed += 1
    touchBacklogRun({ status: 'running', verifyAll: true, total, processed, resolved, queued, failed, currentId: item.id, message: `(${processed}/${total}) ${resolved} verified · ${queued} need review · ${failed} failed` })
  }
  touchBacklogRun({ status: 'complete', verifyAll: true, total, processed, resolved, queued, failed, currentId: null, message: `Verify-all done: ${resolved} verified, ${queued} need review, ${failed} failed.` })
  log('backlog', `Verify-all complete: ${resolved} verified, ${queued} need review, ${failed} failed.`)
}

backlogCmd
  .command('verify-all')
  .description('Verify every item awaiting review; confidence >= threshold marks done, else leaves it flagged with a reason')
  .option('--threshold <n>', `Confidence needed to auto-mark done (default ${CONFIDENCE_THRESHOLD})`)
  .action(async (opts: { threshold?: string }) => {
    await verifyAllReview(Number(opts.threshold) || CONFIDENCE_THRESHOLD)
  })

backlogCmd
  .command('auto-resolve')
  .description('Sequentially plan every open todo item; auto-resolve those above the confidence threshold, queue the rest for approval')
  .option('--threshold <n>', `Confidence needed to auto-resolve (default ${CONFIDENCE_THRESHOLD})`)
  .action(async (opts: { threshold?: string }) => {
    await autoResolveAll(Number(opts.threshold) || CONFIDENCE_THRESHOLD)
  })

backlogCmd
  .command('stop')
  .description('Clear a stuck/hung backlog run: kill its process and reset the run state to idle')
  .action(() => {
    let state: { pid?: number; currentId?: number } = {}
    try { state = JSON.parse(fs.readFileSync(backlogRunFile, 'utf8')) } catch { state = {} }
    killTree(state.pid)
    // If an item was left mid-run, drop it back from in-progress so it is actionable again.
    if (typeof state.currentId === 'number') {
      const tasks = getTasks()
      const stuck = tasks.find((item) => item.id === state.currentId)
      if (stuck && stuck.status === 'in-progress') { stuck.status = 'todo'; saveTasks(tasks) }
    }
    fs.writeFileSync(backlogRunFile, `${JSON.stringify({ status: 'idle', pid: 0, message: 'Run stopped by user.', heartbeatAt: new Date().toISOString() }, null, 2)}\n`)
    log('backlog', 'Backlog run stopped and state cleared')
    logActivity({ actor: 'system', event: 'run.stopped', severity: 'warn', source: 'backlog', message: 'Backlog run stopped and state cleared by user.' })
  })

backlogCmd
  .command('resolve')
  .description('Run a backlog item with the assigned AI (Claude Code edits+commits; other providers produce a resolution to review), then move it to review')
  .requiredOption('--id <id>')
  .option('--provider <provider>', 'claude | codex | grok | gemini | deepseek | glm (defaults to the item assignee)')
  .action(async (opts: { id: string; provider?: string }) => {
    touchBacklogRun({ autoResolve: false })
    const assignee = getTasks().find((item) => item.id === Number(opts.id))?.assignee
    const code = await resolveTask(Number(opts.id), opts.provider || assignee || 'auto')
    if (code !== 0) process.exitCode = code
  })

backlogCmd
  .command('plan')
  .description('Auto-generate a resolution plan + confidence; auto-resolve (with the assigned AI) when confidence is high enough')
  .requiredOption('--id <id>')
  .option('--threshold <n>', `Confidence needed to auto-approve (default ${CONFIDENCE_THRESHOLD})`)
  .option('--auto', 'Resolve immediately when the plan is auto-approved')
  .option('--provider <provider>', 'claude | codex | grok | gemini | deepseek | glm (defaults to the item assignee)')
  .action(async (opts: { id: string; threshold?: string; auto?: boolean; provider?: string }) => {
    touchBacklogRun({ autoResolve: false })
    const assignee = getTasks().find((item) => item.id === Number(opts.id))?.assignee
    await planTask(Number(opts.id), Number(opts.threshold) || CONFIDENCE_THRESHOLD, Boolean(opts.auto), opts.provider || assignee || 'auto')
  })

backlogCmd
  .command('verify')
  .description('Verify a fix actually works; confidence >= threshold auto-marks done, else flags for review with a reason')
  .requiredOption('--id <id>')
  .option('--threshold <n>', `Confidence needed to auto-resolve (default ${CONFIDENCE_THRESHOLD})`)
  .action(async (opts: { id: string; threshold?: string }) => {
    touchBacklogRun({ autoResolve: false })
    await verifyTask(Number(opts.id), Number(opts.threshold) || CONFIDENCE_THRESHOLD)
  })

backlogCmd
  .command('sync')
  .description('Auto-collect: scan code for TODO/FIXME and close items matching completed features/screens')
  .action(() => {
    const result = syncBacklog()
    log('backlog', `Backlog sync: +${result.added} new, -${result.removed} resolved, ${result.flagged} flagged, ${result.advanced} advanced to review (${result.scanned} TODO/FIXME found)`)
  })
