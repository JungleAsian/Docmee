import fs from 'node:fs'
import path from 'node:path'
import Link from 'next/link'
import { BuildProgressGauge } from '../build-progress-gauge'
import {
  backendStage,
  frontendStage,
  priorityDot,
  readDevelopmentSources,
  readDeploymentFeatures,
  stageDot,
  stageLabel,
  type DeploymentFeature,
  type StageStatus
} from '../docmee-deployment/data'
import { ClaudeDesignButton } from './claude-design-button'
import { DetailButton } from '../detail-button'
import { MockupFlow } from './mockup-flow'
import { MockupLibrary } from './mockup-library'
import { StatusDot } from '../status-dot'
import { AutoRefresh } from '../auto-refresh'
import { LaneFlowStrip } from '../lane-flow-strip'
import { LaneItemGauge } from '../lane-item-gauge'
import { runLiveness, isProcessAlive, heartbeatAge } from '../lib/run-live'
import { ElapsedTimer } from '../elapsed-timer'
import { Icon } from '../icons'
import { readJson } from '../lib/read-json'

const toolsRoot = path.resolve(process.cwd(), '..')
const readyFile = path.join(toolsRoot, 'logs', 'ready.json')
const startReadinessFile = path.join(toolsRoot, 'logs', 'start-readiness-ui-development.json')
const uiRunFile = path.join(toolsRoot, 'logs', 'ui-run.json')
const uiDevelopmentRecordsFile = path.join(toolsRoot, 'logs', 'ui-development-records.json')
const mockupsDir = path.join(toolsRoot, 'logs', 'mockups')
const savedMockupsDir = path.join(toolsRoot, 'mockup-library')
const uiDevelopmentPhase = 'UI-DEVELOPMENT'
const uiDesignSourceUrl = 'https://app.notion.com/p/38541c470daf810a903ae389776cdc17'

type PageProps = { searchParams?: { message?: string; error?: string } }
type Ready = { ready?: boolean; summary?: { critical?: number; warning?: number; pass?: number }; createdAt?: string }
type StartReadiness = { ready?: boolean; phase?: string; createdAt?: string; steps?: Array<{ name: string; status: 'pass' | 'fail'; message: string }> }
type FeatureRun = { pid?: number; phase?: string; workflow?: string; status?: string; heartbeatAt?: string; startedAt?: string; message?: string }
type UIDevelopmentRecord = { id: number; screen: string; phase: string; featuresCovered: string; status: 'complete' | 'planned' | 'running' | 'needs-review'; priority: 'critical' | 'high' | 'medium' | 'low'; source: string; nextStep: string; wiringConfidence?: number; wiringReason?: string; wiringCheckedAt?: string }

// Base URL of the running InboxOS app + the live route for each of the 17 screens,
// so the acceptance reviewer can deep-link straight to the real screen. A few sit
// inside another route (open a conversation / clinic) — see the hint column.
const INBOXOS_BASE = process.env.INBOXOS_URL || 'http://127.0.0.1:3000'
const SCREEN_LIVE_ROUTE: Record<number, { path: string; hint?: string }> = {
  1: { path: '/inbox' },
  2: { path: '/calendar' },
  3: { path: '/inbox', hint: 'open a conversation → Patient tab' },
  4: { path: '/studio/quick-replies' },
  5: { path: '/inbox', hint: 'open a conversation → AI assistant panel' },
  6: { path: '/studio/clinics' },
  7: { path: '/studio/kb' },
  8: { path: '/studio/clinics', hint: 'open a clinic → settings' },
  9: { path: '/studio/errors' },
  10: { path: '/studio/channels' },
  11: { path: '/alerts' },
  12: { path: '/studio/automations' },
  13: { path: '/studio/compliance' },
  14: { path: '/metrics' },
  15: { path: '/analytics' },
  16: { path: '/reports' },
  17: { path: '/inbox', hint: 'resize narrow / install as PWA' }
}

const sourceLinks = [
  ['UI/UX design for 17 screens', uiDesignSourceUrl],
  ['Backend design documentation', 'https://app.notion.com/p/38141c470daf8130b7d8dcd70fbb792a'],
  ['Backend records', 'https://app.notion.com/p/38441c470daf8186bd57cafb883bcfcc'],
  ['Frontend records', 'https://app.notion.com/p/38441c470daf8180ac53ca24439be793'],
  ['Canonical 41-feature list', 'https://app.notion.com/p/38341c470daf81f7941ad5509fc9bce3']
] as const

const auditCriteria = {
  backend: [
    'API route, server action, worker, queue, webhook, or integration exists where required.',
    'Data model, RLS, tenant scoping, and clinic separation are present for clinic or patient data.',
    'Error handling, audit events, tests, and local verification are recorded.',
    'Feature flags and license gates exist where the design calls for gated behavior.'
  ],
  frontend: [
    'The route, screen, or workflow is visible in the running app.',
    'The UI does not look like a placeholder or unfinished page.',
    'Mobile layout works on phone-sized screens.',
    'English and Spanish labels fit and are understandable for clinic staff.',
    'External-service states are visible or clearly marked as live-service validation.'
  ],
  ux: [
    'The screen matches a real doctor, secretary, clinic admin, or Admin Studio operator task.',
    'Conversation states, bot/human modes, urgency, appointments, tags, and patient details are scannable.',
    'Empty, loading, error, offline, permission-denied, and disconnected states are designed.',
    'Medical-safety and human-handoff moments are visually unmistakable.'
  ]
}

const focusPrompts = [
  {
    title: 'Unified Inbox + Handoff',
    priority: 'Critical',
    body: 'Create a high-fidelity Docmee Unified Inbox design for medical clinic secretaries. Include Active, Bot-handled, Assigned to secretary, and Closed tabs; mode rail colors for bot/human/waiting/urgent; patient context; tags; internal notes; appointment status; quick replies; assignment; bot pause/resume; and human handoff. Show desktop and mobile. Include Spanish and English labels. Emphasize patient safety, urgent cases, and avoiding accidental bot replies while a human is handling the conversation.'
  },
  {
    title: 'Medical Safety States',
    priority: 'Critical',
    body: 'Create the UI/UX design for Docmee medical safety moments: emergency detected, patient asks for diagnosis, patient asks for medication, bot cannot answer safely, and transfer to secretary/doctor is required. Show how the system blocks unsafe replies, explains the boundary, and escalates. Include the secretary view, Admin Studio rule configuration, and conversation state indicators in English and Spanish.'
  },
  {
    title: 'Bilingual UI Fit',
    priority: 'High',
    body: 'Audit and redesign Docmee bilingual UI examples for navigation, inbox, statuses, alerts, buttons, errors, onboarding, settings, and reports in English and Spanish. Ensure long Spanish labels fit compact operational screens and mobile layouts. Include language switching per user while preserving patient conversation language independently.'
  },
  {
    title: 'Integration States',
    priority: 'High',
    body: 'Design Docmee integration management states for WhatsApp Business API, Meta templates, Google Calendar, Facebook Messenger, Instagram Direct, email notifications, Deepgram audio transcription, and Google Sheets/CRM. Include connected, disconnected, pending setup, token expiring, permission failed, webhook failed, and live-service validation required states. Make it clear what a non-technical clinic admin can do next.'
  },
  {
    title: 'Mobile/PWA Operations',
    priority: 'High',
    body: 'Create a mobile-first Docmee PWA design for secretaries handling live patient conversations. Include inbox triage, urgent alerts, bot pause/resume, assignment, internal notes, appointment confirmation, quick replies, offline state, install prompt, and push notification behavior. Keep the flow fast, readable, and safe for real clinic operations.'
  }
]

function countStage(features: DeploymentFeature[], read: (item: DeploymentFeature) => StageStatus, status: StageStatus) {
  return features.filter((item) => read(item) === status).length
}

function percent(value: number, total: number) {
  if (!total) return 0
  return Math.round((value / total) * 100)
}

// The running Docmee product URL to review the implemented screens in. Reads
// APP_URL from .env.tools (set by the tunnel switcher) and falls back to the
// local product dev server (the dashboard is :4000, the product is :3000).
function reviewAppUrl() {
  try {
    const text = fs.readFileSync(path.join(toolsRoot, '.env.tools'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*APP_URL\s*=\s*(.+)\s*$/)
      if (match) {
        const value = match[1].trim().replace(/^['"]|['"]$/g, '').replace(/\/$/, '')
        if (value) return value
      }
    }
  } catch {
    // No .env.tools — fall through to the local default.
  }
  return 'http://localhost:3000'
}


function readUIDevelopmentRecords() {
  return readJson<UIDevelopmentRecord[]>(uiDevelopmentRecordsFile, [])
}

function uiDevelopmentPercent(rows: UIDevelopmentRecord[]) {
  if (!rows.length) return 0
  const score = rows.reduce((sum, row) => {
    if (row.status === 'complete') return sum + 100
    if (row.status === 'needs-review') return sum + 70
    if (row.status === 'running') return sum + 40
    return sum + 10
  }, 0)
  return Math.round(score / rows.length)
}

function uiRecordPercent(status: UIDevelopmentRecord['status']) {
  if (status === 'complete') return 100
  if (status === 'needs-review') return 70
  if (status === 'running') return 40
  return 10
}

function uiRecordGaugePercent(status: UIDevelopmentRecord['status']) {
  if (status === 'complete') return 100
  if (status === 'needs-review') return 80
  if (status === 'running') return 50
  return 10
}

function uiRecordGaugeTone(status: UIDevelopmentRecord['status']): 'emerald' | 'violet' | 'amber' | 'slate' {
  if (status === 'complete') return 'emerald'
  if (status === 'needs-review') return 'violet'
  if (status === 'running') return 'amber'
  return 'slate'
}

function uiRecordGaugeState(status: UIDevelopmentRecord['status']): 'progressing' | 'halted' | 'stopped' | 'complete' {
  if (status === 'complete') return 'complete'
  if (status === 'running') return 'progressing'
  if (status === 'needs-review') return 'halted'
  return 'stopped'
}

function featurePrompt(item: DeploymentFeature) {
  return `Use Claude Design to create or improve the Docmee Rev 1 design for this audit item.

Product: Docmee, a medical-clinic AI communication and appointment platform.
Audience: secretaries, doctors, clinic admins, Admin Studio operators.
Feature: Req ${item.id} - ${item.feature}
Area: ${item.area}
Phase: ${item.phase}
Priority: ${item.priority}
Backend status: ${stageLabel(backendStage(item))}
Frontend status: ${stageLabel(frontendStage(item))}

Design requirements:
- Create high-fidelity desktop and phone-sized layouts.
- Use a quiet, professional medical SaaS style with dense but readable operations screens.
- Include English and Spanish labels that fit.
- Include empty, loading, error, offline/disconnected, permission-denied, and success states.
- Make patient safety, bot mode, human mode, urgent status, assignment, and handoff visually clear where relevant.
- Prepare implementation handoff notes for Claude Code.

Backend evidence:
${item.evidence}

Frontend/UI follow-up:
${item.nextStep}`
}

function uiDevelopmentPrompt(records: UIDevelopmentRecord[]) {
  const open = records.filter((item) => item.status !== 'complete')
  const targetRows = (open.length > 0 ? open : records).slice(0, 8)
  return `Use Claude Design and Claude Code to continue Docmee UI Development from the 17-screen UI/UX design map.

Source: ${uiDesignSourceUrl}

Product: Docmee, a medical-clinic AI booking and patient-communication platform.
Audience: secretaries, doctors, clinic admins, and Admin Studio operators.

Design and implementation requirements:
- Build the real usable product UI, not a marketing page.
- Use a quiet, professional medical SaaS layout with dense but readable operational screens.
- English and Spanish labels must both fit.
- Mobile must be a real responsive reflow.
- Include empty, loading, error, offline/disconnected, permission-denied, and success states.
- Make patient safety, bot mode, human mode, urgent status, assignment, and handoff visually unmistakable.
- After a design is approved, implement it in the Docmee app and update tools/logs/ui-development-records.json.

Prioritize these open UI screens:
${targetRows.map((item) => `- Screen ${item.id}: ${item.screen} (Phase ${item.phase}, features ${item.featuresCovered}, ${item.priority}) - ${item.nextStep}`).join('\n')}

Deliverables:
1. High-fidelity desktop layout
2. Phone-sized responsive layout
3. Component states and interaction notes
4. Spanish and English label examples
5. Implementation handoff notes
6. Local code changes where the UI is ready to build`
}

function screenDesignPrompt(item: UIDevelopmentRecord) {
  return `Implement Docmee UI Screen ${item.id}: ${item.screen} from the approved Claude Design mockup provided below.

Source map: ${uiDesignSourceUrl}
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

function screenMockupPrompt(item: UIDevelopmentRecord) {
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

function mockupExists(id: number) {
  return fs.existsSync(path.join(mockupsDir, `screen-${id}.html`))
}

function savedMockups() {
  if (!fs.existsSync(savedMockupsDir)) return [] as string[]
  return fs.readdirSync(savedMockupsDir).filter((file) => file.endsWith('.html')).sort()
}

export default function DocmeeAuditPage({ searchParams }: PageProps) {
  const source = readDevelopmentSources().ui
  const sourceUrl = source?.url || uiDesignSourceUrl
  const reviewUrl = reviewAppUrl()
  const features = readDeploymentFeatures().sort((a, b) => a.id - b.id)
  const ready = readJson<Ready>(readyFile, { ready: false, summary: { critical: 1, warning: 0, pass: 0 } })
  const startReadiness = readJson<StartReadiness>(startReadinessFile, { ready: false, steps: [] })
  const run = readJson<FeatureRun>(uiRunFile, { status: 'idle', workflow: 'ui-development' })
  const uiDevelopmentRecords = readUIDevelopmentRecords().sort((a, b) => a.id - b.id)
  const uiDevelopmentOpen = uiDevelopmentRecords.filter((row) => row.status !== 'complete')
  const uiDevelopmentComplete = uiDevelopmentRecords.length - uiDevelopmentOpen.length
  // "Buildable" = screens still awaiting their first automated pass. Automation
  // (Start UI Development) only builds these; once a screen is built it becomes
  // needs-review and is reworked per-row via Improve Design, not the full queue.
  const uiDevelopmentBuildable = uiDevelopmentRecords.filter((row) => row.status !== 'complete' && row.status !== 'needs-review')
  const uiDevelopmentNeedsReview = uiDevelopmentRecords.filter((row) => row.status === 'needs-review')
  const uiRunActive = run.workflow === 'ui-development'
  const uiLiveness = runLiveness(run, isProcessAlive(run.pid))
  const uiDevelopmentLive = uiRunActive && uiLiveness.live
  const uiDevelopmentStale = uiRunActive && uiLiveness.stale
  const uiDevelopmentStartPassed = Boolean(startReadiness.ready && startReadiness.phase === uiDevelopmentPhase)
  const readyCritical = ready.summary?.critical ?? 1
  const designRun = readJson<{ pid?: number; status?: string; heartbeatAt?: string; startedAt?: string; total?: number; processed?: number; message?: string }>(path.join(toolsRoot, 'logs', 'design-run.json'), {})
  const mockupRunLive = designRun.status === 'running' && isProcessAlive(designRun.pid)
  // The gauge should reflect ANY active UI build — the ui-development watcher OR a
  // design/mockup/build/wiring run (design-run.json) — so it isn't gray while one runs.
  const uiBuildLive = uiDevelopmentLive || mockupRunLive
  const uiDevelopmentProgress = uiDevelopmentPercent(uiDevelopmentRecords)
  const uiDevelopmentGaugeState = uiDevelopmentOpen.length === 0 ? 'complete' : uiBuildLive ? 'progressing' : uiDevelopmentStartPassed ? 'halted' : 'stopped'
  // Bulk mockup controls: how many screens still lack a mockup, how many are
  // generated (savable), and whether a bulk run (design-run.json) is live.
  const missingMockupCount = uiDevelopmentRecords.filter((row) => !mockupExists(row.id)).length
  const approvedBuildableCount = uiDevelopmentRecords.filter((row) => row.status !== 'complete' && mockupExists(row.id)).length
  // Wiring stage: built screens that can be wiring-verified, and those a verify flagged as not fully wired.
  const builtScreenCount = uiDevelopmentRecords.filter((row) => row.status !== 'planned').length
  const wiringFlaggedCount = uiDevelopmentRecords.filter((row) => typeof row.wiringConfidence === 'number' && row.wiringConfidence < 8).length
  const generatedMockupCount = fs.existsSync(mockupsDir) ? fs.readdirSync(mockupsDir).filter((file) => /^screen-\d+\.html$/.test(file)).length : 0
  // Heartbeat/liveness for the design+mockup runs (Mockup all / Approve & build /
  // single design) so every running process — not just the ui-development build —
  // surfaces a heartbeat + progress, not only a Stop button.
  const designLiveness = runLiveness(designRun, isProcessAlive(designRun.pid))
  const designRunActive = mockupRunLive || designLiveness.live || designLiveness.stale
  const backendComplete = countStage(features, backendStage, 'complete')
  const frontendComplete = countStage(features, frontendStage, 'complete')
  const backendOpen = features.length - backendComplete
  const frontendOpen = features.length - frontendComplete
  const backendProgress = percent(backendComplete, features.length)
  const frontendProgress = percent(frontendComplete, features.length)
  return (
    <section className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Docmee UI Development</h1>
          <p className="mt-2 text-sm text-slate-400">UI development lane for the 17-screen Docmee Rev 1 design map: run the start check, launch automation, and track progress from the UI queue.</p>
        </div>
        <Link href={sourceUrl} target="_blank" className="rounded-md border border-slate-700 px-3 py-2 text-sm text-sky-300 hover:bg-slate-800">Open Notion Source</Link>
      </div>

      <AutoRefresh seconds={15} />
      <div className="mt-3">
        <LaneFlowStrip
          label="Screen workflow"
          stages={[
            { label: 'Generate mockup', tone: 'cyan' },
            { label: 'Preview', tone: 'sky' },
            { label: 'Approve & build', tone: 'amber' },
            { label: 'Review', tone: 'violet' },
            { label: 'Complete', tone: 'emerald' }
          ]}
        />
      </div>
      {searchParams?.message && <p className="mt-3 rounded-md border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-200">{searchParams.message}</p>}
      {searchParams?.error && <p className="mt-3 rounded-md border border-red-800 bg-red-950/30 p-3 text-sm text-red-200">{searchParams.error}</p>}
      {uiDevelopmentStale && <p className="mt-3 rounded-md border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-200">⚠ The UI development watcher process is alive but has not sent a heartbeat recently — it may be hung. You can start a new run.</p>}

      {designRunActive && (
        <div className={`mt-3 rounded-md border p-3 ${designLiveness.stale ? 'border-amber-800 bg-amber-950/30' : 'border-cyan-900 bg-cyan-950/20'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-cyan-100">{designRun.message ?? 'Design / mockup run in progress…'}</p>
              <p className="mt-0.5 text-xs text-cyan-300/80">
                {typeof designRun.processed === 'number' && typeof designRun.total === 'number' ? `${designRun.processed}/${designRun.total} · ` : ''}
                <ElapsedTimer startedAt={designRun.startedAt} processed={designRun.processed} total={designRun.total} prefix="⏱ " />
                {' · '}heartbeat {heartbeatAge(designRun.heartbeatAt)}
                {designLiveness.stale ? ' · ⚠ no recent heartbeat — may be hung' : ''}
                {designRun.pid ? ` · PID ${designRun.pid}` : ''}
              </p>
            </div>
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="ui-mockup-stop" />
              <button className="inline-flex shrink-0 items-center gap-1 rounded-md border border-red-700 bg-red-950/30 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-950/50"><Icon name="stop" className="h-3.5 w-3.5" />Stop run</button>
            </form>
          </div>
          {typeof designRun.total === 'number' && designRun.total > 0 && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-slate-800" title={`${designRun.processed ?? 0}/${designRun.total}`}>
              <div className={`h-full rounded ${designLiveness.stale ? 'bg-amber-500' : 'bg-cyan-500'}`} style={{ width: `${Math.round(((designRun.processed ?? 0) / designRun.total) * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      <div className="mt-4 rounded-md border border-cyan-800 bg-cyan-950/20 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 lg:flex-1">
            <h2 className="text-lg font-semibold text-cyan-100">UI Development Control</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-cyan-100/80">
              Run the same safe-start pattern as backend and frontend automation. The runner creates the UI development prompt from the 17-screen map, works through the full open queue, and keeps the DevTool heartbeat updated.
            </p>
          </div>
          <div className="flex w-full min-w-0 flex-col items-start gap-1 lg:w-auto lg:max-w-sm lg:shrink-0 lg:items-end">
            <BuildProgressGauge
              size="md"
              percent={uiDevelopmentProgress}
              state={uiDevelopmentGaugeState}
              label={uiBuildLive ? 'UI build running' : 'UI development progress'}
              message={uiDevelopmentLive ? run.message ?? 'UI development is running.' : mockupRunLive ? designRun.message ?? 'Building…' : `${uiDevelopmentComplete}/${uiDevelopmentRecords.length} UI screens complete`}
            />
            {uiBuildLive && <ElapsedTimer startedAt={uiDevelopmentLive ? run.startedAt : designRun.startedAt} processed={uiDevelopmentLive ? undefined : designRun.processed} total={uiDevelopmentLive ? undefined : designRun.total} prefix="⏱ building for " className="text-xs text-cyan-300/80" />}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {/* Build — generate the real screens */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 w-14 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Build</span>
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="phase-build-watch" />
              <input type="hidden" name="from" value={uiDevelopmentPhase} />
              <input type="hidden" name="workflow" value="ui-development" />
              <button disabled={!uiDevelopmentStartPassed || uiDevelopmentLive || uiDevelopmentBuildable.length === 0 || readyCritical > 0} className="rounded-md bg-cyan-500 px-2 py-0.5 text-[11px] leading-5 font-medium text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 inline-flex items-center gap-1" title={readyCritical > 0 ? `${readyCritical} critical setup issue(s) must be fixed first` : !uiDevelopmentStartPassed ? 'Run the UI start check first' : uiDevelopmentLive ? 'UI development is already running' : uiDevelopmentBuildable.length === 0 ? 'No screens left to build — all are built and awaiting review. Use Improve Design on a row to rework one.' : 'Start building the planned screens'}><Icon name="build" className="h-3.5 w-3.5" />Build screens</button>
            </form>
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="phase-build-stop" />
              <button disabled={!uiDevelopmentLive} className="rounded-md border border-red-800 px-2 py-0.5 text-[11px] leading-5 font-medium text-red-200 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500">Stop</button>
            </form>
            <details className="relative">
              <summary className="grid cursor-pointer list-none place-items-center rounded-md border border-slate-700 px-2 py-0.5 text-[11px] leading-5 text-slate-200 hover:bg-slate-800">Rebuild all ▾</summary>
              <form action="/api/actions" method="post" className="absolute left-0 z-20 mt-1 w-72 rounded-md border border-slate-700 bg-slate-900 p-3 shadow-lg">
                <input type="hidden" name="action" value="ui-build-all" />
                <p className="text-xs leading-5 text-slate-300">Sequentially build all <span className="font-semibold text-cyan-200">{uiDevelopmentRecords.filter((row) => row.status !== 'complete').length}</span> not-yet-approved screen(s) with Claude Code, one after another. Each lands in <span className="font-semibold text-cyan-200">review</span> for you to approve later. Runs unattended and uses Claude credits.</p>
                <button disabled={uiDevelopmentLive} className="mt-2 w-full rounded-md bg-cyan-500 px-2 py-0.5 text-[11px] leading-5 font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">Rebuild all sequentially</button>
              </form>
            </details>
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="start-readiness" />
              <input type="hidden" name="phase" value={uiDevelopmentPhase} />
              <input type="hidden" name="workflow" value="ui-development" />
              <input type="hidden" name="redirectTo" value="/docmee-audit" />
              <button className="rounded-md border border-slate-700 px-2 py-0.5 text-[11px] leading-5 text-slate-200 hover:bg-slate-800">Start check</button>
            </form>
          </div>

          {/* Mockups — design references */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 w-14 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Mockups</span>
            {mockupRunLive ? (
              <form action="/api/actions" method="post">
                <input type="hidden" name="action" value="ui-mockup-stop" />
                <button className="inline-flex items-center gap-1 rounded-md border border-red-800 px-2 py-0.5 text-[11px] leading-5 font-medium text-red-200 hover:bg-red-950/40" title={designRun.message ?? 'Stop bulk mockup generation'}>
                  <Icon name="stop" className="h-3.5 w-3.5" />Stop{typeof designRun.processed === 'number' && typeof designRun.total === 'number' ? ` (${designRun.processed}/${designRun.total})` : ''}
                </button>
              </form>
            ) : (
              <form action="/api/actions" method="post">
                <input type="hidden" name="action" value="ui-mockup-all" />
                <button
                  disabled={missingMockupCount === 0}
                  title={missingMockupCount === 0 ? 'Every screen already has a mockup' : `Sequentially generate mockups for the ${missingMockupCount} screen(s) without one`}
                  className="inline-flex items-center gap-1 rounded-md bg-cyan-500 px-2 py-0.5 text-[11px] leading-5 font-medium text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                >
                  <Icon name="plus" className="h-3.5 w-3.5" />Mockup all{missingMockupCount > 0 ? ` (${missingMockupCount})` : ''}
                </button>
              </form>
            )}
            <ClaudeDesignButton prompt={uiDevelopmentPrompt(uiDevelopmentRecords)} label="Manual" compact />
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="mockup-save-all" />
              <button
                disabled={generatedMockupCount === 0}
                title={generatedMockupCount === 0 ? 'No generated mockups to save yet' : `Save all ${generatedMockupCount} generated mockup(s) to the Library`}
                className="rounded-md border border-slate-700 px-2 py-0.5 text-[11px] leading-5 text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save all{generatedMockupCount > 0 ? ` (${generatedMockupCount})` : ''}
              </button>
            </form>
            <MockupLibrary files={savedMockups()} report={fs.existsSync(path.join(savedMockupsDir, 'UI-Design-Report.pdf')) ? 'UI-Design-Report.pdf' : undefined} />
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="mockup-report" />
              <button
                disabled={savedMockups().length === 0}
                title={savedMockups().length === 0 ? 'No saved mockups in the Library yet' : `Export all ${savedMockups().length} saved screen(s) to one PDF, saved in the Library`}
                className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-0.5 text-[11px] leading-5 text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon name="report" className="h-3.5 w-3.5" />PDF
              </button>
            </form>
            {fs.existsSync(path.join(savedMockupsDir, 'UI-Design-Report.pdf')) && (
              <a
                href="/api/mockup-library/UI-Design-Report.pdf"
                download="UI-Design-Report.pdf"
                className="inline-flex items-center justify-center rounded-md border border-emerald-700 bg-emerald-950/20 p-1.5 text-emerald-200 hover:bg-emerald-950/50"
              >
                <Icon name="download" className="h-4 w-4" label="Download UI Design Report PDF" />
              </a>
            )}
            <span className="mx-1 h-5 w-px bg-slate-700" aria-hidden="true" />
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="ui-build-approved-all" />
              <button
                disabled={approvedBuildableCount === 0 || mockupRunLive || uiDevelopmentLive}
                title={approvedBuildableCount === 0 ? 'No screens to build — generate a mockup first' : mockupRunLive || uiDevelopmentLive ? 'A build/design run is already in progress' : `Sequentially build the ${approvedBuildableCount} screen(s) that have an approved mockup (not yet complete) into real components`}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-2 py-0.5 text-[11px] leading-5 font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              >
                <Icon name="build" className="h-3.5 w-3.5" />Approve &amp; build all{approvedBuildableCount > 0 ? ` (${approvedBuildableCount})` : ''}
              </button>
            </form>
          </div>

          {/* Wiring — verify built screens are connected to the backend (no rebuild) */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 w-14 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Wiring</span>
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="ui-wiring-verify-all" />
              <button
                disabled={builtScreenCount === 0 || mockupRunLive || uiDevelopmentLive}
                title={builtScreenCount === 0 ? 'No built screens to verify' : mockupRunLive || uiDevelopmentLive ? 'A run is already in progress' : `Read-only check that all ${builtScreenCount} built screen(s) are wired to the backend (cheap model, no rebuild)`}
                className="inline-flex items-center gap-1 rounded-md border border-sky-700 bg-sky-950/30 px-2 py-0.5 text-[11px] leading-5 font-medium text-sky-100 hover:bg-sky-900/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon name="check" className="h-3.5 w-3.5" />Verify wiring{builtScreenCount > 0 ? ` (${builtScreenCount})` : ''}
              </button>
            </form>
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="ui-wiring-fix-all" />
              <button
                disabled={wiringFlaggedCount === 0 || mockupRunLive || uiDevelopmentLive}
                title={wiringFlaggedCount === 0 ? 'No screens flagged — run Verify wiring first' : mockupRunLive || uiDevelopmentLive ? 'A run is already in progress' : `Wire the ${wiringFlaggedCount} flagged screen(s) to the backend — targeted edits, no rebuild`}
                className="inline-flex items-center gap-1 rounded-md bg-cyan-500 px-2 py-0.5 text-[11px] leading-5 font-medium text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              >
                <Icon name="auto" className="h-3.5 w-3.5" />Wire flagged{wiringFlaggedCount > 0 ? ` (${wiringFlaggedCount})` : ''}
              </button>
            </form>
            <span className="text-[11px] text-slate-500">verifies the built screens connect to the API — does not rebuild</span>
          </div>

          {/* Review — see the result */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 w-14 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Review</span>
            <a href={`${reviewUrl}/inbox`} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-md bg-emerald-500 px-2 py-0.5 text-[11px] leading-5 font-semibold text-slate-950 hover:bg-emerald-400">Open inbox →</a>
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="app-launch" />
              <button className="rounded-md border border-slate-700 px-2 py-0.5 text-[11px] leading-5 text-slate-200 hover:bg-slate-800">Launch local</button>
            </form>
            <Link href="/deploy" className="rounded-md border border-sky-800 px-2 py-0.5 text-[11px] leading-5 text-sky-300 hover:bg-sky-950/40">Deploy →</Link>
          </div>

          {/* Setup & records — collapsed, low-frequency */}
          <details className="group">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md border border-slate-800 px-2.5 py-1.5 text-[11px] text-slate-400 hover:bg-slate-800/60">
              <span className="group-open:hidden">▸</span><span className="hidden group-open:inline">▾</span> Setup &amp; records
            </summary>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-slate-800 bg-slate-950/40 p-2.5">
              <form action="/api/actions" method="post" className="flex min-w-0 flex-col gap-1.5 sm:flex-row">
                <input type="hidden" name="action" value="set-development-source" />
                <input type="hidden" name="lane" value="ui" />
                <input type="hidden" name="redirectTo" value="/docmee-audit" />
                <input name="sourceUrl" defaultValue={sourceUrl} className="min-w-0 rounded-md border border-slate-700 bg-slate-950 px-2 py-0.5 text-[11px] leading-5 text-slate-100 sm:w-72" aria-label="UI Notion source URL" />
                <button className="rounded-md border border-slate-700 px-2 py-0.5 text-[11px] leading-5 text-slate-200 hover:bg-slate-800">Set Notion source</button>
              </form>
              <Link href="/rev1-coverage" className="rounded-md border border-slate-700 px-2 py-0.5 text-[11px] leading-5 text-slate-200 hover:bg-slate-800">Feature records</Link>
              <Link href="/docmee-deployment-frontend" className="rounded-md border border-slate-700 px-2 py-0.5 text-[11px] leading-5 text-slate-200 hover:bg-slate-800">Frontend records</Link>
              <details className="relative">
                <summary className="grid cursor-pointer list-none place-items-center rounded-md border border-red-800 px-2 py-0.5 text-[11px] leading-5 text-red-200 hover:bg-red-950/40">Reset design…</summary>
                <form action="/api/actions" method="post" className="absolute left-0 z-20 mt-1 w-64 rounded-md border border-red-800 bg-slate-900 p-3 shadow-lg">
                  <input type="hidden" name="action" value="ui-reset-screens" />
                  <p className="text-xs leading-5 text-slate-300">Reset all {uiDevelopmentRecords.length} screens back to <span className="font-semibold text-amber-200">planned</span>? This restarts the whole design process from Build screens.</p>
                  <button className="mt-2 w-full rounded-md bg-red-600 px-2 py-0.5 text-[11px] leading-5 font-semibold text-white hover:bg-red-500">Yes, reset all to planned</button>
                </form>
              </details>
            </div>
          </details>
        </div>
        {uiDevelopmentBuildable.length === 0 && uiDevelopmentNeedsReview.length > 0 && (
          <div className="mt-3 rounded-md border border-cyan-800 bg-cyan-950/30 p-3 text-sm text-cyan-100">
            All {uiDevelopmentNeedsReview.length} screens are built and awaiting review — there is nothing left for <span className="font-semibold">Start UI Development</span> to build, so it is disabled. To rework a specific screen, use <span className="font-semibold">Improve Design</span> on its row in the Feature Traceability Matrix below, then review and mark it complete.
          </div>
        )}
        <details className="group mt-3 text-xs leading-5 text-slate-400">
          <summary className="cursor-pointer list-none font-medium text-slate-300 marker:content-none">
            <span className="group-open:hidden">▸ </span><span className="hidden group-open:inline">▾ </span>How to review screens
          </summary>
          <p className="mt-2">
            To review: <span className="text-slate-200">Launch App Locally</span>, then <span className="text-slate-200">Review screens in app</span> to open the running product at {reviewUrl}. Click through each screen, compare it to the Notion design, then mark its row <span className="text-cyan-200">complete</span> in the queue below when it is accepted (each accepted screen takes the progress from 70% toward 100%).
          </p>
        </details>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className={readyCritical > 0 ? 'rounded border border-red-800 bg-red-950/30 p-3' : 'rounded border border-emerald-800 bg-emerald-950/30 p-3'}>
            <p className="text-xs text-slate-400">Ready Check</p>
            <p className={readyCritical > 0 ? 'mt-1 text-sm font-semibold text-red-200' : 'mt-1 text-sm font-semibold text-emerald-200'}>{readyCritical > 0 ? `${readyCritical} blocker(s)` : 'Ready'}</p>
          </div>
          <div className={uiDevelopmentStartPassed ? 'rounded border border-emerald-800 bg-emerald-950/30 p-3' : 'rounded border border-amber-800 bg-amber-950/30 p-3'}>
            <p className="text-xs text-slate-400">Start Check</p>
            <p className={uiDevelopmentStartPassed ? 'mt-1 text-sm font-semibold text-emerald-200' : 'mt-1 text-sm font-semibold text-amber-200'}>{uiDevelopmentStartPassed ? 'Passed' : 'Needed'}</p>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs text-slate-400">UI Queue</p>
            <p className="mt-1 text-sm font-semibold text-slate-200">{uiDevelopmentBuildable.length} to build</p>
            <p className="text-xs text-cyan-200/80">{uiDevelopmentNeedsReview.length} in review</p>
          </div>
          <div className={uiDevelopmentLive ? 'rounded border border-emerald-800 bg-emerald-950/30 p-3' : 'rounded border border-slate-800 bg-slate-950/40 p-3'}>
            <p className="text-xs text-slate-400">Automation</p>
            <p className={uiDevelopmentLive ? 'mt-1 text-sm font-semibold text-emerald-200' : 'mt-1 text-sm font-semibold text-slate-200'}>{uiDevelopmentLive ? 'Running' : run.workflow === 'ui-development' ? run.status ?? 'Idle' : 'Idle'}</p>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs text-slate-400">Heartbeat</p>
            <p className="mt-1 text-sm font-semibold text-slate-200">{run.workflow === 'ui-development' ? heartbeatAge(run.heartbeatAt) : 'not started'}</p>
          </div>
        </div>

        {(startReadiness.steps ?? []).length > 0 && startReadiness.phase === uiDevelopmentPhase && (
          <div className="mt-4 grid gap-2">
            {startReadiness.steps?.map((step) => (
              <div key={step.name} className="rounded border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm">
                <span className={step.status === 'pass' ? 'rounded bg-emerald-900 px-2 py-1 text-xs text-emerald-100' : 'rounded bg-red-900 px-2 py-1 text-xs text-red-100'}>{step.status === 'pass' ? 'pass' : 'needs attention'}</span>
                <span className="ml-2 font-medium text-slate-200">{step.name}</span>
                <p className="mt-2 text-xs text-slate-400">{step.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <details className="group mt-5 rounded-md border border-slate-800 bg-slate-900 p-4">
        <summary className="cursor-pointer list-none text-sm font-semibold text-slate-100 marker:content-none">
          <span className="text-slate-500 group-open:hidden">▸ </span><span className="hidden text-slate-500 group-open:inline">▾ </span>Backend &amp; frontend overview
          <span className="ml-2 text-xs font-normal text-slate-500">{features.length} features · {uiDevelopmentRecords.length} UI screens</span>
        </summary>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-md border border-slate-800 bg-slate-950/60 p-4">
            <p className="text-xs text-slate-500">Designed features</p>
            <p className="mt-2 text-3xl font-semibold">{features.length}</p>
          </div>
          <div className="rounded-md border border-emerald-900 bg-emerald-950/20 p-4">
            <p className="text-xs text-emerald-200/70">Backend complete</p>
            <p className="mt-2 text-3xl font-semibold text-emerald-200">{backendComplete}/{features.length}</p>
            <p className="mt-1 text-xs text-emerald-100/70">{backendProgress}% recorded</p>
          </div>
          <div className="rounded-md border border-cyan-900 bg-cyan-950/20 p-4">
            <p className="text-xs text-cyan-200/70">Frontend accepted</p>
            <p className="mt-2 text-3xl font-semibold text-cyan-100">{frontendComplete}/{features.length}</p>
            <p className="mt-1 text-xs text-cyan-100/70">{frontendOpen} still need acceptance if nonzero</p>
          </div>
          <div className="rounded-md border border-amber-900 bg-amber-950/20 p-4">
            <p className="text-xs text-amber-200/70">UI screens</p>
            <p className="mt-2 text-3xl font-semibold text-amber-200">{uiDevelopmentRecords.length}</p>
            <p className="mt-1 text-xs text-amber-100/70">{uiDevelopmentBuildable.length} to build · {uiDevelopmentNeedsReview.length} in review</p>
          </div>
        </div>
        {(backendOpen > 0 || frontendOpen > 0) && (
          <div className="mt-4 rounded-md border border-amber-800 bg-amber-950/20 p-4">
            <h2 className="text-sm font-semibold text-amber-100">Open UI development work detected</h2>
            <p className="mt-2 text-sm leading-6 text-amber-100/80">
              Backend open: {backendOpen}. Frontend open: {frontendOpen}. UI screens to build: {uiDevelopmentBuildable.length} ({uiDevelopmentNeedsReview.length} built and awaiting review). Use the UI queue for build work and the feature matrix for traceability.
            </p>
          </div>
        )}
      </details>

      <details open className="group mt-5 rounded-md border border-slate-800 bg-slate-900 p-4">
        <summary className="cursor-pointer list-none text-sm font-semibold text-slate-100 marker:content-none">
          <span className="text-slate-500 group-open:hidden">▸ </span><span className="hidden text-slate-500 group-open:inline">▾ </span>17-Screen UI Development Queue
          <span className="ml-2 text-xs font-normal text-slate-500">{uiDevelopmentRecords.length} screens</span>
        </summary>
        <div className="mt-4">
          <p className="text-sm text-slate-400">Loaded from the UI/UX design map. Each row is a buildable UI screen covering one or more Docmee Rev 1 features.</p>
          <details className="group mt-3 rounded-md border border-slate-800 bg-slate-950/40 p-2 text-[11px]">
            <summary className="cursor-pointer list-none font-semibold uppercase tracking-wide text-slate-400 marker:content-none">
              <span className="group-open:hidden">▸ </span><span className="hidden group-open:inline">▾ </span>Development stages
            </summary>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-md border border-cyan-700 bg-cyan-950/30 px-2 py-0.5 leading-5 font-medium text-cyan-100"><Icon name="plus" className="h-3 w-3" />Generate mockup</span>
              <span className="text-slate-500" aria-hidden="true">→</span>
              <span className="inline-flex items-center gap-1 rounded-md border border-cyan-700 bg-cyan-950/30 px-2 py-0.5 leading-5 font-medium text-cyan-100"><Icon name="eye" className="h-3 w-3" />Preview</span>
              <span className="text-slate-500" aria-hidden="true">→</span>
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-600 bg-amber-950/20 px-2 py-0.5 leading-5 font-medium text-amber-200"><Icon name="library" className="h-3 w-3" />Save</span>
              <span className="text-slate-500">(→ Library)</span>
              <span className="text-slate-500" aria-hidden="true">→</span>
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-2 py-0.5 leading-5 font-semibold text-slate-950"><Icon name="build" className="h-3 w-3" />Approve &amp; Build</span>
              <span className="text-slate-500" aria-hidden="true">→</span>
              <span className="inline-flex items-center gap-1 rounded-md border border-cyan-600 bg-cyan-950/40 px-2 py-0.5 leading-5 font-medium text-cyan-100"><Icon name="build" className="h-3 w-3" />Built</span>
              <span className="text-slate-500" aria-hidden="true">→</span>
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-2 py-0.5 leading-5 font-semibold text-slate-950"><Icon name="check" className="h-3 w-3" />Approve</span>
              <span className="text-slate-500" aria-hidden="true">→</span>
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-600 bg-emerald-950/40 px-2 py-0.5 leading-5 font-medium text-emerald-200"><Icon name="check" className="h-3 w-3" />Sent to Docmee</span>
            </div>
            <p className="mt-2 text-slate-500">Each row shows only the buttons for its current stage — e.g. a screen with no mockup yet shows just <span className="text-cyan-100">Generate mockup</span>; the rest appear as it advances.</p>
          </details>
        </div>
        <div className="mt-4 overflow-x-auto rounded-md border border-slate-800">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="bg-slate-950 text-slate-300">
              <tr>
                <th className="w-12 p-3"><span className="sr-only">Progress</span></th>
                <th className="p-3">Screen</th>
                <th className="whitespace-nowrap p-3">Phase</th>
                <th className="p-3">Features</th>
                <th className="whitespace-nowrap p-3">Priority</th>
                <th className="whitespace-nowrap p-3">Status</th>
                <th className="p-3">Next UI work</th>
                <th className="whitespace-nowrap p-3">Progress</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {uiDevelopmentRecords.map((item) => (
                <tr key={item.id} className="bg-slate-950/50 align-top">
                  <td className="p-3"><LaneItemGauge percent={uiRecordGaugePercent(item.status)} tone={uiRecordGaugeTone(item.status)} title={item.status} /></td>
                  <td className="min-w-[220px] p-3 font-medium text-slate-100">
                    Screen {item.id}: {item.screen}
                    {SCREEN_LIVE_ROUTE[item.id] && (
                      <a
                        href={`${INBOXOS_BASE}${SCREEN_LIVE_ROUTE[item.id]!.path}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 flex items-center gap-1 text-[11px] font-normal text-cyan-400 hover:text-cyan-300"
                        title={`Open the live screen in InboxOS (${INBOXOS_BASE}${SCREEN_LIVE_ROUTE[item.id]!.path})${SCREEN_LIVE_ROUTE[item.id]!.hint ? ` — ${SCREEN_LIVE_ROUTE[item.id]!.hint}` : ''} — sign in as studio@demo.test for /studio screens`}
                      >
                        <Icon name="eye" className="h-3 w-3" />Open live ↗{SCREEN_LIVE_ROUTE[item.id]!.hint ? <span className="text-slate-500">({SCREEN_LIVE_ROUTE[item.id]!.hint})</span> : null}
                      </a>
                    )}
                  </td>
                  <td className="whitespace-nowrap p-3 text-slate-300">{item.phase}</td>
                  <td className="min-w-[160px] p-3 text-xs text-slate-400">{item.featuresCovered}</td>
                  <td className="whitespace-nowrap p-3"><StatusDot tone={priorityDot(item.priority)} label={`Priority: ${item.priority}`} /></td>
                  <td className="min-w-[280px] p-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex items-center justify-center rounded-md px-2 py-1 ${item.status === 'needs-review' || item.status === 'complete' ? 'border border-cyan-600 bg-cyan-950/40 text-cyan-100' : 'border border-slate-700 bg-slate-900/60 text-slate-600'}`}
                        title={item.status === 'needs-review' || item.status === 'complete' ? 'Built — Claude Code implemented this screen in the Docmee codebase' : 'Not built yet'}
                        aria-label={item.status === 'needs-review' || item.status === 'complete' ? 'Built' : 'Not built'}
                      >
                        <Icon name="build" className="h-3.5 w-3.5" />
                      </span>
                      {(item.status === 'needs-review' || item.status === 'complete') && (
                        typeof item.wiringConfidence === 'number' ? (
                          <span
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium leading-5 ${item.wiringConfidence >= 8 ? 'border border-emerald-600 bg-emerald-950/40 text-emerald-200' : 'border border-amber-600 bg-amber-950/30 text-amber-200'}`}
                            title={`${item.wiringConfidence >= 8 ? 'Wired' : 'Needs wiring'} — ${item.wiringReason ?? 'backend wiring confidence'}`}
                            aria-label={`${item.wiringConfidence >= 8 ? 'Wired' : 'Needs wiring'} ${item.wiringConfidence}/10`}
                          >
                            <Icon name="auto" className="h-3.5 w-3.5" />{item.wiringConfidence}/10
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[11px] font-medium leading-5 text-slate-500" title="Backend wiring not verified yet — run Verify wiring" aria-label="Wiring not verified"><Icon name="auto" className="h-3.5 w-3.5" />?</span>
                        )
                      )}
                      {(item.status === 'needs-review' || item.status === 'complete') && typeof item.wiringConfidence === 'number' && item.wiringConfidence < 8 && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-amber-700/60 bg-amber-950/10 px-1 py-0.5" title={`Wiring ${item.wiringConfidence}/10 is below 8 — approve as-is, revise (rebuild), or auto-fix the wiring`}>
                          <form action="/api/actions" method="post" className="inline">
                            <input type="hidden" name="action" value="ui-wiring-accept" />
                            <input type="hidden" name="id" value={item.id} />
                            <button className="inline-flex items-center justify-center rounded-md bg-emerald-500 p-1 text-slate-950 hover:bg-emerald-400" title="Approve the wiring as-is despite the low score (clears the flag; does not change build status)" aria-label={`Approve wiring for screen ${item.id} as-is`}><Icon name="check" className="h-3.5 w-3.5" /></button>
                          </form>
                          <form action="/api/actions" method="post" className="inline">
                            <input type="hidden" name="action" value="ui-screen-status" />
                            <input type="hidden" name="id" value={item.id} />
                            <input type="hidden" name="status" value="planned" />
                            <button className="inline-flex items-center justify-center rounded-md border border-amber-600 p-1 text-amber-200 hover:bg-amber-950/40" title="Revise — re-queue this screen to be rebuilt from scratch (run Build screens / Approve & build after)" aria-label={`Revise screen ${item.id} (re-queue to rebuild)`}><Icon name="refresh" className="h-3.5 w-3.5" /></button>
                          </form>
                          <form action="/api/actions" method="post" className="inline">
                            <input type="hidden" name="action" value="ui-wiring-fix" />
                            <input type="hidden" name="id" value={item.id} />
                            <button className="inline-flex items-center justify-center rounded-md bg-cyan-500 p-1 text-slate-950 hover:bg-cyan-400" title="Fix — let Claude wire this one screen to the backend (targeted edit, no rebuild)" aria-label={`Auto-fix wiring for screen ${item.id}`}><Icon name="build" className="h-3.5 w-3.5" /></button>
                          </form>
                        </span>
                      )}
                      <span
                        className={`inline-flex items-center justify-center rounded-md px-2 py-1 ${item.status === 'complete' ? 'border border-emerald-600 bg-emerald-950/40 text-emerald-200' : 'border border-slate-700 bg-slate-900/60 text-slate-600'}`}
                        title={item.status === 'complete' ? 'Approved and sent to the Docmee application' : 'Not sent to Docmee yet'}
                        aria-label={item.status === 'complete' ? 'Sent to Docmee' : 'Not sent to Docmee'}
                      >
                        <Icon name="check" className="h-3.5 w-3.5" />
                      </span>
                      {item.status !== 'complete' && (
                        <MockupFlow
                          screenId={item.id}
                          screenLabel={`Screen ${item.id}: ${item.screen}`}
                          screenName={item.screen}
                          hasMockup={mockupExists(item.id)}
                          mockupPrompt={screenMockupPrompt(item)}
                          buildPrompt={screenDesignPrompt(item)}
                        />
                      )}
                      {item.status === 'needs-review' && (
                        <form action="/api/actions" method="post">
                          <input type="hidden" name="action" value="ui-screen-status" />
                          <input type="hidden" name="id" value={item.id} />
                          <input type="hidden" name="status" value="complete" />
                          <button className="inline-flex items-center justify-center rounded-md bg-emerald-500 p-1 text-slate-950 hover:bg-emerald-400" title="Approve this screen and mark the task complete" aria-label="Approve screen"><Icon name="check" className="h-3.5 w-3.5" /></button>
                        </form>
                      )}
                      {item.status === 'complete' && (
                        <form action="/api/actions" method="post">
                          <input type="hidden" name="action" value="ui-screen-status" />
                          <input type="hidden" name="id" value={item.id} />
                          <input type="hidden" name="status" value="needs-review" />
                          <button className="inline-flex items-center justify-center rounded-md border border-slate-600 p-1 text-slate-300 hover:bg-slate-800" title="Re-open this screen for another review/rework pass" aria-label="Re-open screen"><Icon name="refresh" className="h-3.5 w-3.5" /></button>
                        </form>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap p-3"><DetailButton buttonLabel="" icon="eye" title={`Screen ${item.id}: ${item.screen} — Next UI work`} body={item.nextStep} /></td>
                  <td className="min-w-[220px] p-3">
                    <BuildProgressGauge
                      size="sm"
                      percent={uiRecordPercent(item.status)}
                      state={uiRecordGaugeState(item.status)}
                      label={item.status === 'needs-review' ? 'Needs review' : item.status}
                      message={item.status === 'complete' ? 'Accepted in UI queue' : item.status === 'running' ? 'Automation is working this screen' : item.status === 'needs-review' ? 'Review before marking complete' : 'Waiting for full-queue automation'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <div className="mt-5 space-y-5">
          <details className="group rounded-md border border-slate-800 bg-slate-900 p-4">
            <summary className="cursor-pointer list-none text-sm font-semibold text-slate-100 marker:content-none">
              <span className="text-slate-500 group-open:hidden">▸ </span><span className="hidden text-slate-500 group-open:inline">▾ </span>UI Development Criteria
              <span className="ml-2 text-xs font-normal text-slate-500">backend · frontend · UX checks</span>
            </summary>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              {Object.entries(auditCriteria).map(([label, rows]) => (
                <div key={label} className="rounded-md border border-slate-800 bg-slate-950/50 p-3">
                  <h3 className="text-sm font-semibold capitalize text-slate-100">{label}</h3>
                  <ul className="mt-3 space-y-2 text-xs leading-5 text-slate-400">
                    {rows.map((row) => <li key={row}>- {row}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </details>

          <details className="group rounded-md border border-slate-800 bg-slate-900 p-4">
            <summary className="cursor-pointer list-none text-sm font-semibold text-slate-100 marker:content-none">
              <span className="text-slate-500 group-open:hidden">▸ </span><span className="hidden text-slate-500 group-open:inline">▾ </span>High-Priority Design Prompts
              <span className="ml-2 text-xs font-normal text-slate-500">{focusPrompts.length} cross-cutting UI/UX passes</span>
            </summary>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {focusPrompts.map((prompt) => (
                <article key={prompt.title} className="rounded-md border border-slate-800 bg-slate-950/50 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500">{prompt.priority}</p>
                      <h3 className="mt-1 text-sm font-semibold text-slate-100">{prompt.title}</h3>
                    </div>
                    <ClaudeDesignButton prompt={prompt.body} label="Use Design" compact className="shrink-0" />
                  </div>
                  <div className="mt-3"><DetailButton buttonLabel="View prompt" title={prompt.title} body={prompt.body} /></div>
                </article>
              ))}
            </div>
          </details>

          <details className="group rounded-md border border-slate-800 bg-slate-900 p-4">
            <summary className="cursor-pointer list-none text-sm font-semibold text-slate-100 marker:content-none">
              <span className="text-slate-500 group-open:hidden">▸ </span><span className="hidden text-slate-500 group-open:inline">▾ </span>Feature Traceability Matrix
              <span className="ml-2 text-xs font-normal text-slate-500">{features.length} rows</span>
            </summary>
            <p className="mt-2 text-sm text-slate-400">Every feature remains traceable while UI work is driven by the 17-screen queue.</p>
            <div className="mt-4 overflow-x-auto rounded-md border border-slate-800">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-950 text-slate-300">
                  <tr>
                    <th className="whitespace-nowrap p-3">Req</th>
                    <th className="p-3">Feature</th>
                    <th className="whitespace-nowrap p-3">Area</th>
                    <th className="whitespace-nowrap p-3">Backend</th>
                    <th className="whitespace-nowrap p-3">Frontend</th>
                    <th className="p-3">UI development note</th>
                    <th className="whitespace-nowrap p-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {features.map((item) => {
                    const backend = backendStage(item)
                    const frontend = frontendStage(item)
                    const note = frontend !== 'complete'
                      ? item.nextStep
                      : `${item.feature} is recorded as frontend complete. Run a UI/UX design QA pass for mobile, bilingual labels, error states, and Claude Code handoff quality.`
                    return (
                      <tr key={item.id} className="bg-slate-950/50 align-top">
                        <td className="whitespace-nowrap p-3 font-mono text-xs text-slate-400">{item.id}</td>
                        <td className="min-w-[220px] p-3 font-medium text-slate-100">
                          <div>{item.feature}</div>
                          <span className="mt-2 inline-flex items-center gap-2 text-xs text-slate-400"><StatusDot tone={priorityDot(item.priority)} label={`Priority: ${item.priority}`} /> {item.priority}</span>
                        </td>
                        <td className="whitespace-nowrap p-3 text-slate-300">{item.area}</td>
                        <td className="whitespace-nowrap p-3"><StatusDot tone={stageDot(backend)} label={stageLabel(backend)} /></td>
                        <td className="whitespace-nowrap p-3"><StatusDot tone={stageDot(frontend)} label={stageLabel(frontend)} /></td>
                        <td className="whitespace-nowrap p-3"><DetailButton buttonLabel="View" title={`Req ${item.id}: ${item.feature}`} body={note} /></td>
                        <td className="p-3">
                          <ClaudeDesignButton prompt={featurePrompt(item)} label={frontend === 'complete' ? 'Improve Design' : 'Build Missing'} compact />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {source && <p className={source.status === 'error' ? 'mt-3 text-xs text-red-300' : 'mt-3 text-xs text-slate-500'}>{source.message ?? 'Notion source linked.'}{source.syncedAt ? ` Synced ${new Date(source.syncedAt).toLocaleString()}.` : ''}</p>}
          </details>

          <details className="group rounded-md border border-slate-800 bg-slate-900 p-4">
            <summary className="cursor-pointer list-none text-sm font-semibold text-slate-100 marker:content-none">
              <span className="text-slate-500 group-open:hidden">▸ </span><span className="hidden text-slate-500 group-open:inline">▾ </span>Source records, UI summary &amp; decision rule
            </summary>
            <div className="mt-4 grid gap-5 lg:grid-cols-2">
              <div className="rounded-md border border-slate-800 bg-slate-950/50 p-4">
                <h2 className="text-sm font-semibold">Source Records</h2>
                <div className="mt-3 space-y-2">
                  {sourceLinks.map(([label, href]) => (
                    <a key={href} href={href} target="_blank" rel="noreferrer" className="block rounded border border-slate-800 px-3 py-2 text-sm text-cyan-100 hover:bg-slate-800">
                      {label}
                    </a>
                  ))}
                </div>
              </div>

              <div className="rounded-md border border-slate-800 bg-slate-950/50 p-4">
                <h2 className="text-sm font-semibold">UI Summary</h2>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between rounded border border-slate-800 px-3 py-2"><span>Backend open</span><span>{backendOpen}</span></div>
                  <div className="flex justify-between rounded border border-slate-800 px-3 py-2"><span>Backend progress</span><span className="text-emerald-200">{backendProgress}%</span></div>
                  <div className="flex justify-between rounded border border-slate-800 px-3 py-2"><span>Frontend open</span><span>{frontendOpen}</span></div>
                  <div className="flex justify-between rounded border border-slate-800 px-3 py-2"><span>Frontend progress</span><span className="text-cyan-200">{frontendProgress}%</span></div>
                  <div className="flex justify-between rounded border border-slate-800 px-3 py-2"><span>UI to build</span><span>{uiDevelopmentBuildable.length}</span></div>
                  <div className="flex justify-between rounded border border-slate-800 px-3 py-2"><span>UI in review</span><span className="text-cyan-200">{uiDevelopmentNeedsReview.length}</span></div>
                  <div className="flex justify-between rounded border border-slate-800 px-3 py-2"><span>UI progress</span><span className="text-amber-200">{uiDevelopmentProgress}%</span></div>
                </div>
              </div>

              <div className="rounded-md border border-amber-900/70 bg-amber-950/20 p-4 lg:col-span-2">
                <h2 className="text-sm font-semibold text-amber-100">Decision Rule</h2>
                <p className="mt-2 text-sm leading-6 text-amber-100/80">
                  Keep backend status unchanged unless the issue is truly API, data, worker, or integration behavior. Missing screens, weak UX, mobile gaps, untranslated labels, or unclear states belong in UI Development and should go through the 17-screen design map first.
                </p>
              </div>
            </div>
          </details>
      </div>
    </section>
  )
}
