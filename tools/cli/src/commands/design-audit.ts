import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { Command } from 'commander'
import { claudeCodeCommand, claudeCodeEnvironment } from '../lib/claude-code.js'
import { log } from '../lib/logger.js'
import { logsDir, promptsDir, toolsRoot } from '../lib/paths.js'
import { closeDiscordClient, sendNotification } from '../../../discord/src/bot.js'

type DesignAuditStatus = 'complete' | 'planned' | 'running' | 'needs-review'
type DesignAuditItem = {
  id: number
  area: string
  audit: string
  status: DesignAuditStatus
  priority: 'critical' | 'high' | 'medium' | 'low'
  source: string
  nextStep: string
}

const designAuditRecordsFile = path.join(logsDir, 'design-audit-records.json')
const featureRunFile = path.join(logsDir, 'feature-run.json')
const featureCoverageFile = path.join(logsDir, 'rev1-feature-coverage.json')

function repoRoot() {
  return path.resolve(toolsRoot, '..')
}

function defaultDesignAudits(): DesignAuditItem[] {
  return [
    {
      id: 1,
      area: 'Master Audit',
      audit: 'Full backend, frontend, and UI/UX audit against the Docmee Rev 1 design records',
      status: 'planned',
      priority: 'critical',
      source: 'Docmee Rev 1 backend design, frontend records, and 41-feature coverage',
      nextStep: 'Use Claude Design to create a master audit, identify missing screens/states, and prepare Claude Code handoff notes.'
    },
    {
      id: 2,
      area: 'Unified Inbox',
      audit: 'Secretary inbox, bot/human handoff, urgent status, patient context, assignment, and notes',
      status: 'planned',
      priority: 'critical',
      source: 'Docmee Rev 1 operational workflow',
      nextStep: 'Design desktop and mobile inbox states, then record missing implementation work.'
    },
    {
      id: 3,
      area: 'Medical Safety',
      audit: 'Emergency, diagnosis, medication, unsafe answer blocking, and escalation states',
      status: 'planned',
      priority: 'critical',
      source: 'Medical-clinic AI safety requirements',
      nextStep: 'Design patient-safe states in English and Spanish and produce implementation notes.'
    },
    {
      id: 4,
      area: 'Bilingual UX',
      audit: 'English and Spanish UI fit across navigation, inbox, alerts, settings, onboarding, and reports',
      status: 'planned',
      priority: 'high',
      source: 'Frontend records and bilingual product requirement',
      nextStep: 'Audit long Spanish labels on dense operational screens and mobile layouts.'
    },
    {
      id: 5,
      area: 'Integrations',
      audit: 'WhatsApp, Meta templates, Google Calendar, Messenger, Instagram, email, Deepgram, CRM, and Sheets states',
      status: 'planned',
      priority: 'high',
      source: 'Backend integration design and frontend records',
      nextStep: 'Design connected, disconnected, pending, permission failed, webhook failed, and live validation states.'
    },
    {
      id: 6,
      area: 'Mobile PWA',
      audit: 'Mobile operations for secretaries handling live patient conversations',
      status: 'planned',
      priority: 'high',
      source: 'Frontend mobile/PWA requirement',
      nextStep: 'Create mobile-first triage, urgent alerts, pause/resume, offline, install, and push notification designs.'
    }
  ]
}

function readDesignAudits() {
  if (!fs.existsSync(designAuditRecordsFile)) return defaultDesignAudits()
  try {
    const custom = JSON.parse(fs.readFileSync(designAuditRecordsFile, 'utf8')) as DesignAuditItem[]
    const customIds = new Set(custom.map((item) => item.id))
    return [...defaultDesignAudits().filter((item) => !customIds.has(item.id)), ...custom]
  } catch {
    return defaultDesignAudits()
  }
}

function writeDesignAudits(items: DesignAuditItem[]) {
  fs.mkdirSync(logsDir, { recursive: true })
  fs.writeFileSync(designAuditRecordsFile, `${JSON.stringify(items, null, 2)}\n`)
}

function touchDesignAuditRun(partial: Record<string, unknown>) {
  let current = {}
  if (fs.existsSync(featureRunFile)) {
    try {
      current = JSON.parse(fs.readFileSync(featureRunFile, 'utf8')) as Record<string, unknown>
    } catch {
      current = {}
    }
  }
  fs.mkdirSync(logsDir, { recursive: true })
  fs.writeFileSync(featureRunFile, `${JSON.stringify({
    ...current,
    ...partial,
    pid: partial.pid ?? process.pid,
    workflow: 'design-audit',
    heartbeatAt: new Date().toISOString()
  }, null, 2)}\n`)
}

function priorityRank(priority: DesignAuditItem['priority']) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[priority]
}

function openDesignAudits() {
  const audits = readDesignAudits()
  if (!fs.existsSync(designAuditRecordsFile)) writeDesignAudits(audits)
  return audits
    .filter((item) => item.status !== 'complete')
    .sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority) || left.id - right.id)
}

function featureCoverageSummary() {
  if (!fs.existsSync(featureCoverageFile)) return 'No local feature coverage file was found.'
  try {
    const features = JSON.parse(fs.readFileSync(featureCoverageFile, 'utf8')) as Array<{
      id: number
      feature: string
      area: string
      priority: string
      status?: string
      backendStatus?: string
      frontendStatus?: string
      nextStep?: string
    }>
    const open = features.filter((item) => item.status !== 'complete' || item.frontendStatus !== 'complete')
    return [
      `Feature rows: ${features.length}`,
      `Open backend/frontend rows: ${open.length}`,
      '',
      ...open.slice(0, 20).map((item) => `- Req ${item.id}: ${item.feature} (${item.area}, ${item.priority}) - backend ${item.backendStatus ?? item.status ?? 'pending'}, frontend ${item.frontendStatus ?? 'pending'}; next: ${item.nextStep ?? 'audit required'}`)
    ].join('\n')
  } catch {
    return 'Feature coverage file exists but could not be parsed.'
  }
}

function writeDesignAuditPrompt(items: DesignAuditItem[]) {
  fs.mkdirSync(promptsDir, { recursive: true })
  const promptFile = path.join(promptsDir, 'DESIGN-AUDIT-CONTEXT.md')
  const selected = items.slice(0, 6)
  const lines = [
    '# Docmee Claude Design Audit Automation',
    '',
    'Continue the Docmee Rev 1 design audit from the open design-audit queue.',
    '',
    'Goal:',
    '- Use Claude Design for visual audit/design work wherever that feature is available.',
    '- Compare backend behavior, frontend records, and UI/UX design coverage against the Docmee Rev 1 product design.',
    '- For anything missing or weak, create implementation handoff notes that Claude Code can build from.',
    '',
    'Source records:',
    '- Backend design: https://app.notion.com/p/38141c470daf8130b7d8dcd70fbb792a',
    '- Backend records: https://app.notion.com/p/38441c470daf8186bd57cafb883bcfcc',
    '- Frontend records: https://app.notion.com/p/38441c470daf8180ac53ca24439be793',
    '- Canonical 41-feature list: https://app.notion.com/p/38341c470daf81f7941ad5509fc9bce3',
    '',
    'Rules:',
    '- Treat this as design audit and handoff first. Do not mark product implementation complete unless code and local verification support it.',
    '- Update tools/logs/design-audit-records.json after each completed or materially advanced audit item.',
    '- Add missing build work as clear notes that can be handed to Claude Code.',
    '- Keep English and Spanish UI labels in scope.',
    '- Include desktop and phone-sized states for any new or improved design.',
    '- Cover empty, loading, error, offline, permission-denied, disconnected, connected, and success states where relevant.',
    '- Make medical safety, bot mode, human mode, urgent status, assignment, and handoff visually unmistakable.',
    '- Run relevant local checks before stopping if you change code.',
    '',
    `Open audit count: ${items.length}`,
    '',
    'Local feature coverage snapshot:',
    featureCoverageSummary(),
    '',
    'Start with these audit items:',
    '',
    ...selected.flatMap((item) => [
      `## Audit ${item.id}: ${item.audit}`,
      `Area: ${item.area}`,
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

function runClaudeDesignAudit(promptFile: string, item: DesignAuditItem) {
  return new Promise<number>((resolve) => {
    const prompt = fs.readFileSync(promptFile, 'utf8')
    let output = ''
    touchDesignAuditRun({
      phase: 'DESIGN-AUDIT',
      status: 'running',
      startedAt: new Date().toISOString(),
      message: `Running Claude Design audit ${item.id}: ${item.area}`
    })
    const child = spawn(claudeCodeCommand(), ['--print', '--dangerously-skip-permissions', '--add-dir', repoRoot()], {
      cwd: repoRoot(),
      env: claudeCodeEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    const heartbeat = setInterval(() => {
      touchDesignAuditRun({
        pid: child.pid,
        phase: 'DESIGN-AUDIT',
        status: 'running',
        message: `Running Claude Design audit ${item.id}: ${item.area}`
      })
    }, 10000)
    child.stdout.on('data', (chunk) => {
      const text = String(chunk)
      output += text
      log('design-audit', text.trim())
    })
    child.stderr.on('data', (chunk) => {
      const text = String(chunk)
      output += text
      log('design-audit', text.trim(), 'warn')
    })
    child.on('close', (code) => {
      clearInterval(heartbeat)
      touchDesignAuditRun({
        pid: child.pid,
        phase: 'DESIGN-AUDIT',
        status: code === 0 ? 'complete' : 'failed',
        message: code === 0 ? `Design audit session finished. ${output ? 'Review output and audit records.' : 'No output recorded.'}` : `Design audit session failed with exit code ${code}.`
      })
      resolve(code ?? 1)
    })
    child.stdin.end(prompt)
  })
}

export const designAuditCmd = new Command('design-audit').description('Manage Docmee Claude Design audit automation')

designAuditCmd.command('watch')
  .description('Start automated Claude Design audit from the open audit queue')
  .action(async () => {
    const open = openDesignAudits()
    if (open.length === 0) {
      touchDesignAuditRun({ phase: 'DESIGN-AUDIT', status: 'complete', message: 'All design audit items are complete' })
      await sendNotification('Design audit automation completed. All audit items are marked complete.', 'development')
      await closeDiscordClient()
      return
    }
    const item = open[0]
    const promptFile = writeDesignAuditPrompt(open)
    await sendNotification(`Design audit automation started. ${open.length} open item(s). Working on audit ${item.id} - ${item.area}.`, 'development')
    const code = await runClaudeDesignAudit(promptFile, item)
    if (code !== 0) {
      await sendNotification(`Design audit automation failed during audit ${item.id} - ${item.area}.`, 'critical')
      await closeDiscordClient()
      process.exitCode = code
      return
    }
    const remaining = openDesignAudits().length
    await sendNotification(`Design audit automation session finished. ${remaining} audit item(s) remain open.`, 'development')
    await closeDiscordClient()
  })
