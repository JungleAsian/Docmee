import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { Command } from 'commander'
import { claudeCodeCommand, claudeCodeEnvironment } from '../lib/claude-code.js'
import { log } from '../lib/logger.js'
import { logsDir, promptsDir, toolsRoot } from '../lib/paths.js'
import { closeDiscordClient, sendNotification } from '../../../discord/src/bot.js'

type UIStatus = 'complete' | 'planned' | 'running' | 'needs-review'
type UIItem = {
  id: number
  screen: string
  phase: string
  featuresCovered: string
  status: UIStatus
  priority: 'critical' | 'high' | 'medium' | 'low'
  source: string
  nextStep: string
}

const uiDevelopmentRecordsFile = path.join(logsDir, 'ui-development-records.json')
const uiRunFile = path.join(logsDir, 'ui-run.json')
const sourceUrl = 'https://app.notion.com/p/38541c470daf810a903ae389776cdc17'

function repoRoot() {
  return path.resolve(toolsRoot, '..')
}

function readUIItems() {
  if (!fs.existsSync(uiDevelopmentRecordsFile)) return []
  try {
    return JSON.parse(fs.readFileSync(uiDevelopmentRecordsFile, 'utf8')) as UIItem[]
  } catch {
    return []
  }
}

function writeUIItems(items: UIItem[]) {
  fs.mkdirSync(logsDir, { recursive: true })
  fs.writeFileSync(uiDevelopmentRecordsFile, `${JSON.stringify(items.sort((a, b) => a.id - b.id), null, 2)}\n`)
}

function updateUIItem(id: number, patch: Partial<UIItem>) {
  const items = readUIItems()
  const next = items.map((item) => item.id === id ? { ...item, ...patch } : item)
  writeUIItems(next)
}

function touchUIRun(partial: Record<string, unknown>) {
  let current = {}
  if (fs.existsSync(uiRunFile)) {
    try {
      current = JSON.parse(fs.readFileSync(uiRunFile, 'utf8')) as Record<string, unknown>
    } catch {
      current = {}
    }
  }
  fs.mkdirSync(logsDir, { recursive: true })
  fs.writeFileSync(uiRunFile, `${JSON.stringify({
    ...current,
    ...partial,
    pid: partial.pid ?? process.pid,
    workflow: 'ui-development',
    heartbeatAt: new Date().toISOString()
  }, null, 2)}\n`)
}

function priorityRank(priority: UIItem['priority']) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[priority]
}

function openUIItems() {
  // Only screens still awaiting their first automated pass are "open". A screen
  // the automation already implemented is marked `needs-review` (human acceptance
  // is the next step, not another automated pass) — excluding it stops re-runs
  // from re-developing every reviewed screen in an endless, token-burning loop.
  return readUIItems()
    .filter((item) => item.status !== 'complete' && item.status !== 'needs-review')
    .sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority) || Number(left.phase) - Number(right.phase) || left.id - right.id)
}

function writeUIPrompt(items: UIItem[], currentItem?: UIItem) {
  fs.mkdirSync(promptsDir, { recursive: true })
  const promptFile = path.join(promptsDir, 'UI-DEVELOPMENT-CONTEXT.md')
  const selected = [currentItem, ...items.filter((item) => item.id !== currentItem?.id)].filter((item): item is UIItem => Boolean(item)).slice(0, 8)
  const lines = [
    '# Docmee UI Development',
    '',
    'Continue Docmee UI development from the 17-screen UI/UX design map.',
    '',
    `Source: ${sourceUrl}`,
    '',
    'Base design rules:',
    '- Use Claude Design for visual design work wherever available, then implement accepted UI in code.',
    '- Build the usable Docmee product experience, not a marketing page.',
    '- Keep a quiet, professional medical SaaS style with dense but readable operational screens.',
    '- English and Spanish labels must both fit without layout breakage.',
    '- Mobile must be a real responsive reflow, not a shrunken desktop.',
    '- Include empty, loading, error, offline/disconnected, permission-denied, and success states.',
    '- Patient safety, bot/human mode, urgent state, assignment, and handoff must be visually unmistakable.',
    '- Update tools/logs/ui-development-records.json after each completed or materially advanced screen.',
    '- Mark a screen complete only when code and local verification support it.',
    '- If a screen is implemented but still needs human acceptance, mark it needs-review and explain the remaining review step.',
    '- Run relevant local checks before stopping.',
    '- Commit useful completed work with a clear message.',
    '',
    `Open UI screen count: ${items.length}`,
    '',
    currentItem ? `Current automation target: Screen ${currentItem.id} - ${currentItem.screen}` : 'Current automation target: first open screen',
    '',
    'Start with these UI screens:',
    '',
    ...selected.flatMap((item) => [
      `## Screen ${item.id}: ${item.screen}`,
      `Phase: ${item.phase}`,
      `Features covered: ${item.featuresCovered}`,
      `Status: ${item.status}`,
      `Priority: ${item.priority}`,
      `Source: ${item.source}`,
      `Next step: ${item.nextStep}`,
      ''
    ])
  ]
  fs.writeFileSync(promptFile, `${lines.join('\n')}\n`)
  return promptFile
}

function runClaudeUI(promptFile: string, item: UIItem) {
  return new Promise<number>((resolve) => {
    const prompt = fs.readFileSync(promptFile, 'utf8')
    let output = ''
    touchUIRun({
      phase: 'UI-DEVELOPMENT',
      status: 'running',
      startedAt: new Date().toISOString(),
      message: `Developing UI screen ${item.id}: ${item.screen}`
    })
    const child = spawn(claudeCodeCommand(), ['--print', '--dangerously-skip-permissions', '--add-dir', repoRoot()], {
      cwd: repoRoot(),
      env: claudeCodeEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    const heartbeat = setInterval(() => {
      touchUIRun({
        pid: child.pid,
        phase: 'UI-DEVELOPMENT',
        status: 'running',
        message: `Developing UI screen ${item.id}: ${item.screen}`
      })
    }, 10000)
    child.stdout.on('data', (chunk) => {
      const text = String(chunk)
      output += text
      log('ui-development', text.trim())
    })
    child.stderr.on('data', (chunk) => {
      const text = String(chunk)
      output += text
      log('ui-development', text.trim(), 'warn')
    })
    child.on('close', (code) => {
      clearInterval(heartbeat)
      touchUIRun({
        pid: child.pid,
        phase: 'UI-DEVELOPMENT',
        status: code === 0 ? 'complete' : 'failed',
        message: code === 0 ? `UI development session finished. ${output ? 'Review output and UI records.' : 'No output recorded.'}` : `UI development session failed with exit code ${code}.`
      })
      resolve(code ?? 1)
    })
    child.stdin.end(prompt)
  })
}

export const uiDevelopmentCmd = new Command('ui-development').description('Manage Docmee UI development automation')

uiDevelopmentCmd.command('watch')
  .description('Start automated Claude UI development from the 17-screen UI queue')
  .action(async () => {
    const initialOpen = openUIItems()
    if (initialOpen.length === 0) {
      touchUIRun({ phase: 'UI-DEVELOPMENT', status: 'complete', message: 'All UI development screens are complete' })
      await sendNotification('UI development automation completed. All UI screens are marked complete.', 'development')
      await closeDiscordClient()
      return
    }
    const plannedIds = new Set(initialOpen.map((item) => item.id))
    let processed = 0
    let failed: UIItem | null = null
    await sendNotification(`UI development automation started. ${initialOpen.length} open screen(s). Running the full queue.`, 'development')

    while (plannedIds.size > 0) {
      const open = openUIItems().filter((item) => plannedIds.has(item.id))
      const item = open[0]
      if (!item) break
      plannedIds.delete(item.id)
      updateUIItem(item.id, { status: 'running' })
      const promptFile = writeUIPrompt(open.length > 0 ? open : [item], item)
      const code = await runClaudeUI(promptFile, item)
      processed += 1
      const latest = readUIItems().find((row) => row.id === item.id)
      if (code !== 0) {
        failed = item
        if (latest?.status === 'running') {
          updateUIItem(item.id, {
            status: 'needs-review',
            nextStep: `${latest.nextStep}\nAutomation failed during this screen. Review the UI development log, fix the blocker, and rerun Start UI Development.`
          })
        }
        break
      }
      if (!latest || latest.status === 'running') {
        updateUIItem(item.id, {
          status: 'needs-review',
          nextStep: `${latest?.nextStep ?? item.nextStep}\nAutomation completed a pass for this screen. Review local changes, run acceptance checks, then mark complete if the UI matches the design.`
        })
      }
    }

    const remaining = openUIItems().length
    touchUIRun({
      phase: 'UI-DEVELOPMENT',
      status: failed ? 'failed' : remaining === 0 ? 'complete' : 'needs-review',
      message: failed
        ? `UI development automation failed during screen ${failed.id}: ${failed.screen}. ${remaining} screen(s) remain open.`
        : `UI development automation finished ${processed} screen pass(es). ${remaining} screen(s) remain open or need review.`
    })
    await sendNotification(
      failed
        ? `UI development automation failed during screen ${failed.id} - ${failed.screen}. ${remaining} screen(s) remain open.`
        : `UI development automation finished the queued run. ${processed} screen pass(es) processed; ${remaining} screen(s) remain open or need review.`,
      failed ? 'critical' : 'development'
    )
    await closeDiscordClient()
    if (failed) process.exitCode = 1
  })
