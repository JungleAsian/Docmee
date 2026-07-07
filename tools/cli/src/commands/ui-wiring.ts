import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { Command } from 'commander'
import { claudeCodeCommand, claudeCodeEnvironment } from '../lib/claude-code.js'
import { log } from '../lib/logger.js'
import { logsDir, toolsRoot } from '../lib/paths.js'
import { logActivity } from '../lib/activity.js'

// Verify + wire ALREADY-BUILT UI screens to the backend — operates on the
// existing apps/inboxos components, never rebuilds from the mockup. Verify is
// read-only (cheap model) and scores wiring confidence; wire is a targeted edit
// that connects the gaps without redesigning the UI.
type UIRecord = {
  id: number
  screen: string
  phase: string
  featuresCovered: string
  status: string
  priority: string
  source: string
  nextStep: string
  wiringConfidence?: number
  wiringReason?: string
  wiringCheckedAt?: string
}

const recordsFile = path.join(logsDir, 'ui-development-records.json')
const designRunFile = path.join(logsDir, 'design-run.json')
const repoRoot = path.resolve(toolsRoot, '..')
const WIRING_THRESHOLD = 8
const TIMEOUT_MS = 10 * 60 * 1000
const VERIFY_MODEL = process.env.UI_WIRING_VERIFY_MODEL || 'haiku'
const FIX_MODEL = process.env.UI_WIRING_FIX_MODEL || ''

function readRecords(): UIRecord[] {
  try { const r = JSON.parse(fs.readFileSync(recordsFile, 'utf8')); return Array.isArray(r) ? r : [] } catch { return [] }
}
function saveRecords(records: UIRecord[]) {
  fs.writeFileSync(recordsFile, `${JSON.stringify(records, null, 2)}\n`)
}
function readDesignRun(): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(designRunFile, 'utf8')) as Record<string, unknown> } catch { return {} }
}
function touchDesignRun(partial: Record<string, unknown>) {
  fs.mkdirSync(logsDir, { recursive: true })
  fs.writeFileSync(designRunFile, `${JSON.stringify({ ...readDesignRun(), ...partial, workflow: 'claude-design', heartbeatAt: new Date().toISOString() }, null, 2)}\n`)
}
function killTree(pid?: number) {
  if (!pid) return
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true })
    else process.kill(pid, 'SIGKILL')
  } catch { /* gone */ }
}

function runClaude(prompt: string, message: string, model?: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const args = ['--print', '--dangerously-skip-permissions', '--add-dir', repoRoot, '--output-format', 'json']
    if (model) args.push('--model', model)
    const child = spawn(claudeCodeCommand(), args, { cwd: repoRoot, env: claudeCodeEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    const heartbeat = setInterval(() => touchDesignRun({ pid: process.pid, status: 'running', message }), 10000)
    const finish = (code: number) => {
      if (settled) return
      settled = true
      clearInterval(heartbeat)
      clearTimeout(timer)
      let output = (stdout || stderr).trim()
      try { const j = JSON.parse(stdout.trim()) as { result?: unknown }; if (typeof j.result === 'string') output = j.result.trim() } catch { /* keep raw */ }
      resolve({ code, output })
    }
    const timer = setTimeout(() => { killTree(child.pid); finish(124) }, TIMEOUT_MS)
    child.stdout.on('data', (c) => { stdout += String(c) })
    child.stderr.on('data', (c) => { stderr += String(c) })
    child.on('error', () => finish(1))
    child.on('close', (e) => finish(e ?? 1))
    child.stdin.end(prompt)
  })
}

function parseVerify(output: string): { confidence: number; reason: string } {
  const stripped = output.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const tryParse = (text: string) => {
    try {
      const parsed = JSON.parse(text) as { confidence?: unknown; reason?: unknown }
      if (typeof parsed.confidence === 'number') return { confidence: Math.max(1, Math.min(10, Math.round(parsed.confidence))), reason: String(parsed.reason ?? '').trim() }
    } catch { /* not JSON */ }
    return null
  }
  let result = tryParse(stripped)
  if (!result) { const m = stripped.match(/\{[\s\S]*\}/); if (m) result = tryParse(m[0]) }
  return result ?? { confidence: 5, reason: output.trim().slice(0, 1500) || 'No verification output produced.' }
}

function verifyPrompt(rec: UIRecord): string {
  return [
    `VERIFY the backend wiring of the already-built Docmee UI Screen ${rec.id}: ${rec.screen} (implemented in apps/inboxos).`,
    `Features: ${rec.featuresCovered} · Phase ${rec.phase}.`,
    '',
    'Do NOT change any code — verification only. Inspect this screen\'s component(s) in apps/inboxos and the Docmee API in apps/api.',
    'Check whether:',
    '- every interactive element (button, form, list, filter, action) calls a REAL backend endpoint or data hook — not placeholder / mock / hardcoded data,',
    '- the referenced endpoints actually exist in apps/api,',
    '- loading / error / empty states bind to real query/mutation state.',
    '',
    'Rate CONFIDENCE 1-10 that the screen is fully wired to the backend.',
    'Respond with ONLY a JSON object (no prose, no code fences):',
    '{"confidence": <integer 1-10>, "reason": "<one short paragraph: what is wired, and what is missing/unwired>"}'
  ].join('\n')
}

function fixPrompt(rec: UIRecord): string {
  return [
    `WIRE the already-built Docmee UI Screen ${rec.id}: ${rec.screen} (in apps/inboxos) to the backend.`,
    `Features: ${rec.featuresCovered} · Phase ${rec.phase}.`,
    rec.wiringReason ? `Known wiring gaps from verification:\n${rec.wiringReason}` : '',
    '',
    'Connect every interactive element to its real backend endpoint / data hook using existing apps/api routes and the app\'s API client/hooks.',
    'Do NOT redesign the UI — only add or fix the data + action wiring (queries, mutations, state binding). Keep the existing layout.',
    `Run the relevant local checks and commit referencing "wire screen ${rec.id}". Report what you wired.`
  ].filter(Boolean).join('\n')
}

async function verifyScreen(rec: UIRecord): Promise<number> {
  const { output } = await runClaude(verifyPrompt(rec), `Verify wiring #${rec.id}: ${rec.screen}`, VERIFY_MODEL)
  const { confidence, reason } = parseVerify(output)
  const records = readRecords()
  const updated = records.find((r) => r.id === rec.id)
  if (updated) { updated.wiringConfidence = confidence; updated.wiringReason = reason; updated.wiringCheckedAt = new Date().toISOString(); saveRecords(records) }
  const wired = confidence >= WIRING_THRESHOLD
  logActivity({ actor: 'claude', event: wired ? 'wiring.pass' : 'wiring.flag', severity: wired ? 'success' : 'warn', source: 'ui', taskId: rec.id, message: `Screen #${rec.id} wiring ${confidence}/10 — ${wired ? 'wired' : 'needs wiring'}.` })
  log('ui-wiring', `Screen #${rec.id} wiring confidence ${confidence}/10 — ${wired ? 'wired' : 'needs wiring'}.`)
  return confidence
}

async function fixScreen(rec: UIRecord): Promise<number> {
  const { code } = await runClaude(fixPrompt(rec), `Wire #${rec.id}: ${rec.screen}`, FIX_MODEL || undefined)
  logActivity({ actor: 'claude', event: 'wiring.fix', severity: code === 0 ? 'success' : 'error', source: 'ui', taskId: rec.id, message: code === 0 ? `Wired screen #${rec.id}.` : `Wiring screen #${rec.id} failed (exit ${code}).` })
  log('ui-wiring', code === 0 ? `Screen #${rec.id} wired.` : `Screen #${rec.id} wiring failed (exit ${code}).`, code === 0 ? 'info' : 'warn')
  return code
}

const stopped = () => { const s = readDesignRun().status; return s === 'stopped' || s === 'stopping' }

export const uiWiringCmd = new Command('ui-wiring').description('Verify + wire already-built UI screens to the backend (no rebuild)')

uiWiringCmd.command('verify').description('Verify one built screen\'s backend wiring').requiredOption('--id <id>').action(async (opts: { id: string }) => {
  const rec = readRecords().find((r) => r.id === Number(opts.id))
  if (!rec) { log('ui-wiring', `Screen ${opts.id} not found`, 'error'); process.exitCode = 1; return }
  touchDesignRun({ pid: process.pid, status: 'running', startedAt: new Date().toISOString(), currentId: rec.id, message: `Verifying wiring for screen #${rec.id}` })
  await verifyScreen(rec)
  touchDesignRun({ status: 'complete', currentId: null, message: `Wiring verified for screen #${rec.id}.` })
})

uiWiringCmd.command('verify-all').description('Verify backend wiring for every built screen (read-only, cheap model)').action(async () => {
  const queue = readRecords().filter((r) => r.status !== 'planned').sort((a, b) => a.id - b.id)
  const total = queue.length
  if (total === 0) { touchDesignRun({ status: 'complete', message: 'No built screens to verify.' }); log('ui-wiring', 'No built screens to verify.', 'warn'); return }
  let pass = 0
  let flag = 0
  touchDesignRun({ pid: process.pid, status: 'running', startedAt: new Date().toISOString(), total, processed: 0, message: `Verifying wiring for ${total} screen(s)…` })
  logActivity({ actor: 'claude', event: 'wiring.verify-all.start', severity: 'info', source: 'ui', message: `Verifying backend wiring for ${total} screen(s).` })
  for (const [index, rec] of queue.entries()) {
    if (stopped()) { log('ui-wiring', 'Stopped by user.', 'warn'); break }
    touchDesignRun({ status: 'running', total, processed: index, currentId: rec.id, message: `(${index + 1}/${total}) Verifying wiring #${rec.id}: ${rec.screen}` })
    const conf = await verifyScreen(rec)
    if (conf >= WIRING_THRESHOLD) pass += 1; else flag += 1
  }
  touchDesignRun({ status: 'complete', total, processed: total, currentId: null, message: `Wiring verify done: ${pass} wired, ${flag} need wiring.` })
  logActivity({ actor: 'claude', event: 'wiring.verify-all.done', severity: flag ? 'warn' : 'success', source: 'ui', message: `Wiring verify finished — ${pass} wired, ${flag} need wiring.` })
})

uiWiringCmd.command('fix').description('Wire one built screen to the backend').requiredOption('--id <id>').action(async (opts: { id: string }) => {
  const rec = readRecords().find((r) => r.id === Number(opts.id))
  if (!rec) { log('ui-wiring', `Screen ${opts.id} not found`, 'error'); process.exitCode = 1; return }
  touchDesignRun({ pid: process.pid, status: 'running', startedAt: new Date().toISOString(), currentId: rec.id, message: `Wiring screen #${rec.id}` })
  const code = await fixScreen(rec)
  touchDesignRun({ status: code === 0 ? 'complete' : 'failed', currentId: null, message: code === 0 ? `Wired screen #${rec.id}.` : `Wiring screen #${rec.id} failed.` })
})

uiWiringCmd.command('fix-all').description('Wire every screen flagged by verify (wiring confidence below threshold)').action(async () => {
  const queue = readRecords().filter((r) => typeof r.wiringConfidence === 'number' && r.wiringConfidence < WIRING_THRESHOLD).sort((a, b) => a.id - b.id)
  const total = queue.length
  if (total === 0) { touchDesignRun({ status: 'complete', message: 'No flagged screens to wire — run Verify wiring first.' }); log('ui-wiring', 'No flagged screens to wire.', 'warn'); return }
  let fixed = 0
  let failed = 0
  touchDesignRun({ pid: process.pid, status: 'running', startedAt: new Date().toISOString(), total, processed: 0, message: `Wiring ${total} flagged screen(s)…` })
  logActivity({ actor: 'claude', event: 'wiring.fix-all.start', severity: 'info', source: 'ui', message: `Wiring ${total} flagged screen(s).` })
  for (const [index, rec] of queue.entries()) {
    if (stopped()) { log('ui-wiring', 'Stopped by user.', 'warn'); break }
    touchDesignRun({ status: 'running', total, processed: index, currentId: rec.id, message: `(${index + 1}/${total}) Wiring #${rec.id}: ${rec.screen}` })
    const code = await fixScreen(rec)
    if (code === 0) fixed += 1; else failed += 1
  }
  touchDesignRun({ status: 'complete', total, processed: total, currentId: null, message: `Wiring done: ${fixed} wired, ${failed} failed.` })
  logActivity({ actor: 'claude', event: 'wiring.fix-all.done', severity: failed ? 'warn' : 'success', source: 'ui', message: `Wiring finished — ${fixed} wired, ${failed} failed.` })
})
