import path from 'node:path'
import Link from 'next/link'
import { BuildProgressGauge } from '../build-progress-gauge'
import { CompactSection, SimpleStatusCard } from '../compact-ui'
import { StatusDot } from '../status-dot'
import { DetailButton } from '../detail-button'
import { AutoRefresh } from '../auto-refresh'
import { LaneFlowStrip } from '../lane-flow-strip'
import { LaneItemGauge } from '../lane-item-gauge'
import { runLiveness, isProcessAlive, heartbeatAge } from '../lib/run-live'
import { readJson } from '../lib/read-json'

const toolsRoot = path.resolve(process.cwd(), '..')
const coverageFile = path.join(toolsRoot, 'logs', 'rev1-feature-coverage.json')
const featureRunFile = path.join(toolsRoot, 'logs', 'feature-run.json')
const readyFile = path.join(toolsRoot, 'logs', 'ready.json')
const startReadinessFile = path.join(toolsRoot, 'logs', 'start-readiness-features-development.json')
const postDeploymentFile = path.join(toolsRoot, 'logs', 'post-deployment.json')

type FeatureStatus = 'complete' | 'partial' | 'missing'
type StageStatus = 'complete' | 'pending' | 'needs-audit'
type Feature = {
  id: number
  phase: string
  area: string
  feature: string
  status: FeatureStatus
  backendStatus?: StageStatus
  frontendStatus?: StageStatus
  priority: 'critical' | 'high' | 'medium' | 'low'
  evidence: string
  nextStep: string
}
type PageProps = { searchParams?: { message?: string; error?: string } }
type BuildRun = {
  pid?: number
  phase?: string
  workflow?: string
  status?: string
  message?: string
  heartbeatAt?: string
  githubStatus?: string
  githubMessage?: string
  githubBranch?: string
  lastCommitHash?: string
  pushedAt?: string
}
type Ready = { ready?: boolean; summary?: { critical?: number; warning?: number; pass?: number }; createdAt?: string }
type StartReadiness = { ready?: boolean; phase?: string; createdAt?: string; steps?: Array<{ name: string; status: 'pass' | 'fail'; message: string }> }
type PostDeploymentRun = { target?: 'local' | 'vps'; createdAt?: string; summary?: { pass?: number; warning?: number; fail?: number } }

function readFeatures() {
  return readJson<Feature[]>(coverageFile, [])
}

function statusTone(status: FeatureStatus) {
  if (status === 'complete') return 'border-emerald-700 bg-emerald-950/30 text-emerald-200'
  if (status === 'partial') return 'border-amber-700 bg-amber-950/30 text-amber-200'
  return 'border-red-700 bg-red-950/30 text-red-200'
}

function stageLabel(status: StageStatus) {
  if (status === 'complete') return 'Complete'
  if (status === 'needs-audit') return 'Needs audit'
  return 'Pending'
}

function statusDotTone(status: FeatureStatus) {
  if (status === 'complete') return 'green' as const
  if (status === 'partial') return 'amber' as const
  return 'red' as const
}

function priorityDotTone(priority: Feature['priority']) {
  if (priority === 'critical') return 'red' as const
  if (priority === 'high') return 'orange' as const
  if (priority === 'medium') return 'amber' as const
  return 'slate' as const
}

function stageDotTone(status: StageStatus) {
  if (status === 'complete') return 'green' as const
  if (status === 'needs-audit') return 'cyan' as const
  return 'amber' as const
}

function backendStage(item: Feature): StageStatus {
  if (item.backendStatus) return item.backendStatus
  return item.status === 'complete' ? 'complete' : 'pending'
}

function frontendStage(item: Feature): StageStatus {
  if (item.frontendStatus) return item.frontendStatus
  return item.status === 'complete' ? 'needs-audit' : 'pending'
}

function featurePercent(status: FeatureStatus) {
  if (status === 'complete') return 100
  if (status === 'partial') return 50
  return 0
}

function lanePercent(status: FeatureStatus) {
  if (status === 'complete') return 100
  if (status === 'partial') return 55
  return 8
}

function laneTone(status: FeatureStatus) {
  if (status === 'complete') return 'emerald' as const
  if (status === 'partial') return 'amber' as const
  return 'slate' as const
}

function featureGaugeState(item: Feature, run: BuildRun, live: boolean): 'progressing' | 'halted' | 'stopped' | 'complete' {
  if (item.status === 'complete') return 'complete'
  if ((run.workflow === 'features-development' || run.workflow === 'frontend-development') && live && run.phase === item.phase) return 'progressing'
  if (item.status === 'partial') return 'halted'
  return 'stopped'
}

function featureGaugeLabel(item: Feature, run: BuildRun, live: boolean) {
  if (item.status === 'complete') return 'Complete'
  if ((run.workflow === 'features-development' || run.workflow === 'frontend-development') && live && run.phase === item.phase) return 'Developing'
  if (item.status === 'partial') return 'Partial'
  return 'Not started'
}

function overallFeaturePercent(features: Feature[]) {
  if (features.length === 0) return 0
  const total = features.reduce((sum, item) => sum + featurePercent(item.status), 0)
  return Math.round(total / features.length)
}

function countBy<T extends string>(rows: Feature[], read: (row: Feature) => T) {
  return rows.reduce<Record<T, number>>((acc, row) => {
    const key = read(row)
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {} as Record<T, number>)
}

function currentPhase(openItems: Feature[], run: BuildRun) {
  if ((run.workflow === 'features-development' || run.workflow === 'frontend-development') && ['starting', 'running', 'paused'].includes(run.status ?? '') && run.phase) return run.phase
  return openItems[0]?.phase || 'Phase 1'
}

function heartbeatState(run: BuildRun, live: boolean) {
  if (run.status === 'paused') return 'paused'
  if (!live && ['starting', 'running'].includes(run.status ?? '')) return 'dead'
  if (!live) return 'stopped'
  if (!run.heartbeatAt) return 'checking'

  const ageMs = Date.now() - new Date(run.heartbeatAt).getTime()
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'checking'
  if (ageMs <= 60000) return 'normal'
  if (ageMs <= 120000) return 'delayed'
  return 'lost'
}

function heartbeatTone(state: string) {
  if (state === 'normal') return 'border-emerald-800 bg-emerald-950/30 text-emerald-100'
  if (state === 'paused' || state === 'delayed' || state === 'checking') return 'border-amber-800 bg-amber-950/30 text-amber-100'
  if (state === 'lost' || state === 'dead') return 'border-red-800 bg-red-950/30 text-red-100'
  return 'border-slate-800 bg-slate-950/40 text-slate-200'
}

function heartbeatLabel(state: string) {
  if (state === 'normal') return 'live'
  if (state === 'paused') return 'paused'
  if (state === 'delayed') return 'delayed'
  if (state === 'lost') return 'heartbeat lost'
  if (state === 'dead') return 'process stopped'
  if (state === 'checking') return 'checking'
  return 'not running'
}

function githubSyncTone(status?: string) {
  if (status === 'pushed') return 'border-emerald-800 bg-emerald-950/30 text-emerald-100'
  if (status === 'pending') return 'border-amber-800 bg-amber-950/30 text-amber-100'
  if (status === 'failed') return 'border-red-800 bg-red-950/30 text-red-100'
  if (status === 'skipped') return 'border-slate-700 bg-slate-900 text-slate-200'
  return 'border-slate-800 bg-slate-950/40 text-slate-200'
}

function githubSyncLabel(status?: string) {
  if (status === 'pushed') return 'pushed'
  if (status === 'pending') return 'pushing'
  if (status === 'failed') return 'push failed'
  if (status === 'skipped') return 'no new commit'
  return 'not synced yet'
}

function formatDateTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return date.toLocaleString()
}

function localCheckPassed() {
  const runs = readJson<PostDeploymentRun[]>(postDeploymentFile, [])
  const latestLocal = runs.find((run) => (run.target ?? 'local') === 'local')
  return Boolean(latestLocal && (latestLocal.summary?.fail ?? 1) === 0)
}

export default function FeaturesDevelopmentPage({ searchParams }: PageProps) {
  const features = readFeatures().sort((a, b) => {
    const phaseOrder = a.phase.localeCompare(b.phase)
    if (phaseOrder !== 0) return phaseOrder
    return a.id - b.id
  })
  const statusCounts = countBy(features, (row) => row.status)
  const phaseCounts = countBy(features.filter((row) => row.status !== 'complete'), (row) => row.phase)
  const priorityOrder: Record<Feature['priority'], number> = { critical: 0, high: 1, medium: 2, low: 3 }
  const nextClaudeQueue = features
    .filter((row) => row.status !== 'complete')
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || a.phase.localeCompare(b.phase) || a.id - b.id)
    .slice(0, 12)
  const openQueue = features
    .filter((row) => row.status !== 'complete')
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || a.phase.localeCompare(b.phase) || a.id - b.id)
  const run = readJson<BuildRun>(featureRunFile, { status: 'idle', workflow: 'features-development' })
  const ready = readJson<Ready>(readyFile, { ready: false, summary: { critical: 1, warning: 0, pass: 0 } })
  const startReadiness = readJson<StartReadiness>(startReadinessFile, { ready: false, steps: [] })
  const { live, stale: staleRun } = runLiveness(run, isProcessAlive(run.pid))
  const nextPhase = currentPhase(openQueue, run)
  const startCheckPassed = Boolean(startReadiness.ready && startReadiness.phase === nextPhase)
  const readyCritical = ready.summary?.critical ?? 1
  const allFeaturesComplete = features.length > 0 && openQueue.length === 0
  const localPassed = localCheckPassed()
  const featureWorkflowActive = run.workflow === 'features-development' || run.workflow === 'frontend-development'
  const featureHeartbeatState = heartbeatState(run, live)
  const featureHeartbeatAge = heartbeatAge(run.heartbeatAt)
  const missing = statusCounts.missing ?? 0
  const partial = statusCounts.partial ?? 0
  const complete = statusCounts.complete ?? 0
  const backendComplete = features.filter((item) => backendStage(item) === 'complete').length
  const frontendComplete = features.filter((item) => frontendStage(item) === 'complete').length
  const frontendNeedsAudit = features.filter((item) => frontendStage(item) === 'needs-audit').length
  const overallPercent = overallFeaturePercent(features)
  const overallGaugeState = allFeaturesComplete ? 'complete' : live && featureWorkflowActive ? 'progressing' : partial > 0 ? 'halted' : 'stopped'
  // Backend-only: this page starts the backend feature automation. Frontend
  // development now has its own page (Frontend Build Control) + run file, so it
  // is no longer auto-started from here.
  const automationFrom = nextPhase
  const automationWorkflow = 'features-development'
  const automationStartPassed = startCheckPassed
  const automationComplete = allFeaturesComplete
  const automationButtonLabel = 'Start Feature Automation'
  const automationDescription = allFeaturesComplete
    ? 'All backend feature items are complete.'
    : `Starts the backend watcher from ${nextPhase} and connects it to the heartbeat.`

  return (
    <section className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Features Development</h1>
          <p className="mt-2 text-sm text-slate-400">
            Docmee feature development coverage from the 41-feature design. Use this as Claude&apos;s continuation queue.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action="/api/actions" method="post">
            <input type="hidden" name="action" value="start-readiness" />
            <input type="hidden" name="phase" value={nextPhase} />
            <input type="hidden" name="workflow" value="features-development" />
            <button className="min-h-11 rounded-md border border-cyan-700 px-3 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-950/40">Run Start Check</button>
          </form>
          <form action="/api/actions" method="post">
            <input type="hidden" name="action" value="phase-build-watch" />
            <input type="hidden" name="from" value={automationFrom} />
            <input type="hidden" name="workflow" value={automationWorkflow} />
            <button disabled={!automationStartPassed || live || automationComplete || readyCritical > 0} title={readyCritical > 0 ? `${readyCritical} critical setup issue(s) must be fixed first` : !automationStartPassed ? `Run the start check for ${nextPhase} first` : live ? 'Feature automation is already running' : automationComplete ? 'All features are complete' : automationDescription} className="min-h-11 rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">{automationButtonLabel}</button>
          </form>
        </div>
      </div>

      <AutoRefresh seconds={15} />
      <div className="mt-3">
        <LaneFlowStrip
          label="Workflow"
          stages={[
            { label: 'Start check', tone: 'cyan' },
            { label: 'Feature automation · Claude', tone: 'amber' },
            { label: 'Local app check', tone: 'sky' },
            { label: 'Deploy to VPS', tone: 'emerald' }
          ]}
        />
      </div>

      {staleRun && <p className="mt-3 rounded-md border border-amber-800 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">⚠ The feature watcher process is alive but has not sent a heartbeat recently — it may be hung. You can start a new run.</p>}
      {searchParams?.message && <p className="mt-3 rounded-md border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-200">{searchParams.message}</p>}
      {searchParams?.error && <p className="mt-3 rounded-md border border-red-800 bg-red-950/30 p-3 text-sm text-red-200">{searchParams.error}</p>}

      {frontendNeedsAudit > 0 && (
        <div className="mt-5 rounded-md border border-cyan-800 bg-cyan-950/20 p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-cyan-100/80">{frontendNeedsAudit} frontend item(s) need development/acceptance. Frontend development now runs from its own page.</p>
            <a href="/frontend-build-control" className="min-h-11 rounded-md border border-cyan-700 px-3 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-950/40">Open Frontend Build Control →</a>
          </div>
        </div>
      )}

      <div className="mt-5 rounded-md border border-cyan-800 bg-cyan-950/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-cyan-100">Feature Automation Control</h2>
            <p className="mt-2 text-sm leading-6 text-cyan-100/80">
              Run the start check, launch automated development for the open feature queue, check the app locally, then continue to VPS deployment.
            </p>
          </div>
          <BuildProgressGauge
            size="md"
            percent={overallPercent}
            state={overallGaugeState}
            label="Feature progress"
            message={`${complete}/${features.length} complete, ${partial} partial, ${missing} missing`}
          />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          <Link href="/ready" className={readyCritical > 0 ? 'rounded border border-red-800 bg-red-950/30 p-3 hover:bg-red-950/50' : 'rounded border border-emerald-800 bg-emerald-950/30 p-3 hover:bg-emerald-950/40'}>
            <p className="text-xs text-slate-400">Ready Check</p>
            <p className={readyCritical > 0 ? 'mt-1 text-sm font-semibold text-red-200' : 'mt-1 text-sm font-semibold text-emerald-200'}>{readyCritical > 0 ? `${readyCritical} blocker(s)` : 'Ready'}</p>
            <p className="mt-1 text-xs text-slate-500">{readyCritical > 0 ? 'Open blocker details' : 'Open readiness details'}</p>
          </Link>
          <div className={startCheckPassed ? 'rounded border border-emerald-800 bg-emerald-950/30 p-3' : 'rounded border border-amber-800 bg-amber-950/30 p-3'}>
            <p className="text-xs text-slate-400">Start Check</p>
            <p className={automationStartPassed ? 'mt-1 text-sm font-semibold text-emerald-200' : 'mt-1 text-sm font-semibold text-amber-200'}>{startCheckPassed ? `Passed for ${nextPhase}` : `Needed for ${nextPhase}`}</p>
          </div>
          <div className={live ? 'rounded border border-amber-800 bg-amber-950/30 p-3' : 'rounded border border-slate-800 bg-slate-950/40 p-3'}>
            <p className="text-xs text-slate-400">Automation</p>
            <p className={live ? 'mt-1 text-sm font-semibold text-amber-200' : 'mt-1 text-sm font-semibold text-slate-200'}>{live ? run.status ?? 'running' : 'not running'}</p>
          </div>
          <Link href="/install-monitor" className={`rounded border p-3 ${heartbeatTone(featureHeartbeatState)}`}>
            <p className="text-xs opacity-75">Heartbeat</p>
            <p className="mt-1 text-sm font-semibold">{heartbeatLabel(featureHeartbeatState)}</p>
            <p className="mt-1 text-xs opacity-75">
              {run.workflow === 'frontend-development' ? 'Frontend Development' : featureWorkflowActive ? 'Features Development' : run.workflow ? 'Shared watcher' : 'No feature run'}
              {featureHeartbeatAge ? ` · ${featureHeartbeatAge}` : ''}
            </p>
          </Link>
          <div className={localPassed ? 'rounded border border-emerald-800 bg-emerald-950/30 p-3' : 'rounded border border-slate-800 bg-slate-950/40 p-3'}>
            <p className="text-xs text-slate-400">Local app check</p>
            <p className={localPassed ? 'mt-1 text-sm font-semibold text-emerald-200' : 'mt-1 text-sm font-semibold text-slate-200'}>{localPassed ? 'passed' : 'not passed yet'}</p>
          </div>
          <div className={`rounded border p-3 ${githubSyncTone(run.githubStatus)}`}>
            <p className="text-xs opacity-75">GitHub Sync</p>
            <p className="mt-1 text-sm font-semibold">{githubSyncLabel(run.githubStatus)}</p>
            <p className="mt-1 truncate text-xs opacity-75">
              {run.lastCommitHash ? `${run.githubBranch ?? 'branch'} · ${run.lastCommitHash}` : run.githubMessage ?? 'Waiting for first feature commit'}
            </p>
          </div>
          <div className={allFeaturesComplete && localPassed ? 'rounded border border-emerald-800 bg-emerald-950/30 p-3' : 'rounded border border-slate-800 bg-slate-950/40 p-3'}>
            <p className="text-xs text-slate-400">VPS deploy</p>
            <p className={allFeaturesComplete && localPassed ? 'mt-1 text-sm font-semibold text-emerald-200' : 'mt-1 text-sm font-semibold text-slate-200'}>{allFeaturesComplete && localPassed ? 'ready' : 'locked'}</p>
          </div>
        </div>
        {(run.githubMessage || run.pushedAt) && (
          <div className={`mt-3 rounded border p-3 text-sm ${githubSyncTone(run.githubStatus)}`}>
            <p className="font-semibold">GitHub Sync Details</p>
            <p className="mt-1 text-xs opacity-80">{run.githubMessage}</p>
            {run.pushedAt && <p className="mt-1 text-xs opacity-70">Last pushed: {formatDateTime(run.pushedAt)}</p>}
          </div>
        )}
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <form action="/api/actions" method="post" className="rounded border border-slate-800 bg-slate-950/40 p-3">
            <input type="hidden" name="action" value="start-readiness" />
            <input type="hidden" name="phase" value={nextPhase} />
            <input type="hidden" name="workflow" value="features-development" />
            <button className="w-full min-h-11 rounded-md border border-cyan-700 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-950/40">Run Start Check</button>
            <p className="mt-2 text-xs text-slate-500">Prepares context and dry-runs automation from {nextPhase}.</p>
          </form>
          <form action="/api/actions" method="post" className="rounded border border-slate-800 bg-slate-950/40 p-3">
            <input type="hidden" name="action" value="phase-build-watch" />
            <input type="hidden" name="from" value={automationFrom} />
            <input type="hidden" name="workflow" value={automationWorkflow} />
            <button disabled={!automationStartPassed || live || automationComplete || readyCritical > 0} title={readyCritical > 0 ? `${readyCritical} critical setup issue(s) must be fixed first` : !automationStartPassed ? `Run the start check for ${nextPhase} first` : live ? 'Feature automation is already running' : automationComplete ? 'All features are complete' : automationDescription} className="w-full min-h-11 rounded-md bg-cyan-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">Start All Open Features</button>
            <p className="mt-2 text-xs text-slate-500">{automationDescription}</p>
          </form>
          <form action="/api/actions" method="post" className="rounded border border-slate-800 bg-slate-950/40 p-3">
            <input type="hidden" name="action" value="app-launch" />
            <button disabled={!allFeaturesComplete} title={allFeaturesComplete ? 'Launch the product app locally' : 'All features must be complete before launching locally'} className="w-full min-h-11 rounded-md border border-emerald-700 px-3 py-2 text-sm text-emerald-100 hover:bg-emerald-950/40 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500">Launch App Locally</button>
            <p className="mt-2 text-xs text-slate-500">Opens the local app and posts access details to Discord.</p>
          </form>
          <Link
            href="/deploy"
            aria-disabled={!(allFeaturesComplete && localPassed)}
            className={allFeaturesComplete && localPassed
              ? 'rounded border border-emerald-700 bg-emerald-950/20 p-3 text-center text-sm text-emerald-100 hover:bg-emerald-950/40'
              : 'pointer-events-none rounded border border-slate-800 bg-slate-950/40 p-3 text-center text-sm text-slate-500'}
          >
            <span className="block min-h-11 py-2 font-medium">Continue to Deploy →</span>
            <span className="block text-xs">{allFeaturesComplete && localPassed ? 'Open deployment guide.' : 'Complete features and local checks first.'}</span>
          </Link>
        </div>
      </div>

      <details className="mt-5 rounded-md border border-cyan-800 bg-cyan-950/20 p-4">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-cyan-100">Development Stages</h2>
            <p className="mt-1 text-xs text-cyan-100/70">Backend {backendComplete}/{features.length} · Frontend accepted {frontendComplete}/{features.length} · {frontendNeedsAudit} need audit</p>
          </div>
          <span className="rounded border border-slate-700 px-2 py-1 text-xs text-cyan-200 details-toggle-label">Expand</span>
        </summary>
        <p className="mt-3 text-sm leading-6 text-cyan-100/80">
          Feature completion is now split into backend/local-code completion and frontend product acceptance. A backend-complete feature is not launch-accepted until the frontend/design stage also passes.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <SimpleStatusCard label="Features" value={features.length} />
          <SimpleStatusCard label="Missing" value={missing} tone="red" />
          <SimpleStatusCard label="Partial" value={partial} tone="amber" />
          <SimpleStatusCard label="Complete" value={complete} tone="emerald" />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded border border-emerald-800 bg-emerald-950/30 p-3">
            <p className="text-xs text-emerald-200/70">Backend completed</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-200">{backendComplete}/{features.length}</p>
            <p className="mt-1 text-xs text-emerald-100/70">API, data, worker, routing, tests, or local implementation evidence exists.</p>
          </div>
          <div className="rounded border border-cyan-800 bg-cyan-950/30 p-3">
            <p className="text-xs text-cyan-200/70">Frontend needs audit</p>
            <p className="mt-2 text-2xl font-semibold text-cyan-100">{frontendNeedsAudit}</p>
            <p className="mt-1 text-xs text-cyan-100/70">UI/UX, design match, mobile layout, and product acceptance still need review.</p>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs text-slate-400">Frontend accepted</p>
            <p className="mt-2 text-2xl font-semibold text-slate-100">{frontendComplete}/{features.length}</p>
            <p className="mt-1 text-xs text-slate-500">Only count features here after visual/product acceptance passes.</p>
          </div>
        </div>
      </details>

      <div className="mt-5">
      <CompactSection title="Claude Next Work Queue" subtitle="Open feature queue sorted by criticality, plus open-by-phase, completion rule, and source." badge={<span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">{nextClaudeQueue.length} shown</span>}>
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Claude Next Work Queue</h2>
              <p className="mt-1 text-xs text-slate-400">Sorted by criticality. Build these before claiming feature development complete.</p>
            </div>
            <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">{nextClaudeQueue.length} shown</span>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {nextClaudeQueue.map((item) => (
              <article key={item.id} className="rounded-md border border-slate-800 bg-slate-950/50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-slate-500">Req {item.id} · {item.phase} · {item.area}</p>
                    <h3 className="mt-1 text-sm font-semibold text-slate-100">{item.feature}</h3>
                  </div>
                  <div className="flex items-start gap-2">
                    <BuildProgressGauge
                      size="sm"
                      showLabel={false}
                      percent={featurePercent(item.status)}
                      state={featureGaugeState(item, run, live)}
                      centerText={`${featurePercent(item.status)}%`}
                    />
                    <div className="flex items-center gap-2">
                      <StatusDot tone={statusDotTone(item.status)} label={item.status} />
                      <StatusDot tone={priorityDotTone(item.priority)} label={`Priority: ${item.priority}`} />
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-400">{item.evidence}</p>
                <p className="mt-3 rounded border border-cyan-900/70 bg-cyan-950/20 p-2 text-xs leading-5 text-cyan-100">
                  Next: {item.nextStep}
                </p>
              </article>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
            <h2 className="text-sm font-semibold">Open by Phase</h2>
            <div className="mt-3 space-y-2">
              {Object.entries(phaseCounts).map(([phase, count]) => (
                <div key={phase} className="flex items-center justify-between rounded border border-slate-800 px-3 py-2 text-sm">
                  <span>{phase}</span>
                  <span className="rounded bg-slate-800 px-2 py-1 text-xs">{count} open</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-md border border-red-900/70 bg-red-950/20 p-4">
            <h2 className="text-sm font-semibold text-red-100">Completion Rule</h2>
            <p className="mt-2 text-sm leading-6 text-red-100/80">
              Do not mark feature development complete until every feature is complete and the 8-step acceptance test passes on the VPS.
            </p>
          </div>
          <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
            <h2 className="text-sm font-semibold">Source</h2>
            <p className="mt-2 break-all text-xs leading-5 text-slate-400">
              tools/logs/rev1-feature-coverage.json
            </p>
          </div>
        </div>
      </div>
      </CompactSection>
      </div>

      <div className="mt-5">
      <CompactSection title="All Feature Details" subtitle="Full backend/frontend status table for every Docmee feature." badge={<span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">{features.length} rows</span>}>
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-slate-900 text-slate-300">
            <tr>
              <th className="p-3"></th>
              <th className="p-3">Req</th>
              <th className="p-3">Phase</th>
              <th className="p-3">Area</th>
              <th className="p-3">Feature</th>
              <th className="p-3">Progress</th>
              <th className="p-3">Backend</th>
              <th className="p-3">Frontend</th>
              <th className="p-3">Status</th>
              <th className="p-3">Priority</th>
              <th className="p-3">Next Step</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {features.map((item) => (
              <tr key={item.id} className="bg-slate-950/60 align-top">
                <td className="p-3"><LaneItemGauge percent={lanePercent(item.status)} tone={laneTone(item.status)} title={item.status} /></td>
                <td className="p-3 font-mono text-xs text-slate-400">{item.id}</td>
                <td className="p-3 whitespace-nowrap">{item.phase}</td>
                <td className="p-3">{item.area}</td>
                <td className="p-3 font-medium text-slate-100">{item.feature}</td>
                <td className="p-3">
                  <BuildProgressGauge
                    size="sm"
                    showLabel
                    percent={featurePercent(item.status)}
                    state={featureGaugeState(item, run, live)}
                    label={featureGaugeLabel(item, run, live)}
                    message={`${featurePercent(item.status)}% feature progress`}
                    centerText={`${featurePercent(item.status)}%`}
                  />
                </td>
                <td className="p-3"><StatusDot tone={stageDotTone(backendStage(item))} label={stageLabel(backendStage(item))} /></td>
                <td className="p-3"><StatusDot tone={stageDotTone(frontendStage(item))} label={stageLabel(frontendStage(item))} /></td>
                <td className="p-3"><span className={`rounded border px-2 py-1 text-xs ${statusTone(item.status)}`}>{item.status}</span></td>
                <td className="p-3"><StatusDot tone={priorityDotTone(item.priority)} label={`Priority: ${item.priority}`} /></td>
                <td className="whitespace-nowrap p-3"><DetailButton buttonLabel="View" title={`Req ${item.id}: ${item.feature}`} body={item.nextStep} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </CompactSection>
      </div>
    </section>
  )
}
