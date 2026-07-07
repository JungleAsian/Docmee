import path from 'node:path'
import Link from 'next/link'
import { BuildProgressGauge } from '../build-progress-gauge'
import { frontendStage, priorityDot, readDeploymentFeatures, stageDot, stageLabel, type DeploymentFeature } from '../docmee-deployment/data'
import { StatusDot } from '../status-dot'
import { AutoRefresh } from '../auto-refresh'
import { readJson } from '../lib/read-json'
import { runLiveness, isProcessAlive } from '../lib/run-live'
import { LaneFlowStrip } from '../lane-flow-strip'
import { LaneItemGauge } from '../lane-item-gauge'

const toolsRoot = path.resolve(process.cwd(), '..')
const startReadinessFile = path.join(toolsRoot, 'logs', 'start-readiness-frontend-development.json')
const featureRunFile = path.join(toolsRoot, 'logs', 'frontend-run.json')
const readyFile = path.join(toolsRoot, 'logs', 'ready.json')

type PageProps = { searchParams?: { message?: string; error?: string } }
type StartReadiness = { ready?: boolean; phase?: string; createdAt?: string; steps?: Array<{ name: string; status: 'pass' | 'fail'; message: string }> }
type FeatureRun = { pid?: number; phase?: string; status?: string; startedAt?: string; heartbeatAt?: string; message?: string }

function groupedByArea(rows: DeploymentFeature[]) {
  return rows.reduce<Record<string, DeploymentFeature[]>>((acc, row) => {
    acc[row.area] = acc[row.area] ?? []
    acc[row.area].push(row)
    return acc
  }, {})
}

function progress(done: number, total: number) {
  if (!total) return 0
  return Math.round((done / total) * 100)
}

export default function FrontendBuildControlPage({ searchParams }: PageProps) {
  const features = readDeploymentFeatures().sort((a, b) => a.id - b.id)
  const accepted = features.filter((item) => frontendStage(item) === 'complete')
  const needsAudit = features.filter((item) => frontendStage(item) === 'needs-audit')
  const pending = features.filter((item) => frontendStage(item) === 'pending')
  const percent = progress(accepted.length, features.length)
  const startReadiness = readJson<StartReadiness>(startReadinessFile, { ready: false, steps: [] })
  const startCheckCurrent = startReadiness.phase === 'FRONTEND'
  const startCheckPassed = Boolean(startReadiness.ready && startCheckCurrent)
  const featureRun = readJson<FeatureRun>(featureRunFile, { status: 'stopped' })
  const ready = readJson<{ summary?: { critical?: number } }>(readyFile, { summary: { critical: 1 } })
  const readyCritical = ready.summary?.critical ?? 1
  const { live, stale: staleRun } = runLiveness(featureRun, isProcessAlive(featureRun.pid))
  const rows = [...needsAudit, ...pending, ...accepted]
  const areaGroups = groupedByArea(rows)

  return (
    <section className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-cyan-200/80">Frontend lane</p>
          <h1 className="text-2xl font-semibold">Frontend Build Control</h1>
          <p className="mt-2 text-sm text-slate-400">Track frontend acceptance, UI build progress, and final readiness before deployment.</p>
        </div>
        <div className="responsive-actions">
          <Link href="/rev1-coverage" className="min-h-11 rounded-md border border-cyan-700 px-3 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-950/40">
            Features Development
          </Link>
          <Link href="/docmee-deployment-frontend" className="min-h-11 rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">
            Frontend Deployment
          </Link>
        </div>
      </div>

      <AutoRefresh seconds={15} />
      <div className="mt-3">
        <LaneFlowStrip
          label="Workflow"
          stages={[
            { label: 'Start check', tone: 'cyan' },
            { label: 'Frontend dev · Claude', tone: 'amber' },
            { label: 'Local UI verify', tone: 'sky' },
            { label: 'Deploy', tone: 'emerald' }
          ]}
        />
      </div>

      {searchParams?.message && <p className="mt-3 text-sm text-emerald-300">{searchParams.message}</p>}
      {searchParams?.error && <p className="mt-3 text-sm text-red-300">{searchParams.error}</p>}
      {staleRun && <p className="mt-3 rounded-md border border-amber-800 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">⚠ The frontend watcher process is alive but has not sent a heartbeat recently — it may be hung. You can start a new run.</p>}

      <div className={startCheckPassed ? 'mt-4 rounded-md border border-emerald-800 bg-emerald-950/30 p-4' : 'mt-4 rounded-md border border-amber-800 bg-amber-950/30 p-4'}>
        <div className="flex flex-col items-stretch gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h2 className={startCheckPassed ? 'text-sm font-semibold text-emerald-100' : 'text-sm font-semibold text-amber-100'}>
              {startCheckPassed ? 'Frontend Start Check passed' : 'Frontend Start Check needed'}
            </h2>
            <p className="mt-1 text-sm text-slate-300">
              {startCheckPassed ? 'Frontend build control can proceed with the acceptance queue.' : 'Run the frontend start check before using this lane for deployment decisions.'}
            </p>
          </div>
          <div className="responsive-actions">
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="start-readiness" />
              <input type="hidden" name="phase" value="FRONTEND" />
              <input type="hidden" name="workflow" value="frontend-development" />
              <input type="hidden" name="redirectTo" value="/frontend-build-control" />
              <button className="min-h-11 rounded-md bg-slate-100 px-3 py-2 text-sm font-medium text-slate-950">Run Start Check</button>
            </form>
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="phase-build-watch" />
              <input type="hidden" name="from" value="FRONTEND" />
              <input type="hidden" name="workflow" value="frontend-development" />
              <button disabled={!startCheckPassed || live || needsAudit.length === 0 || readyCritical > 0} title={readyCritical > 0 ? `${readyCritical} critical setup issue(s) must be fixed first` : !startCheckPassed ? 'Run the frontend start check first' : live ? 'Frontend automation is already running' : needsAudit.length === 0 ? 'No frontend items currently need audit' : 'Start frontend development automation'} className="min-h-11 rounded-md bg-cyan-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">Start Frontend Development</button>
            </form>
            <Link href="/ready" className="min-h-11 rounded-md border border-slate-700 px-3 py-2 text-sm text-sky-300 hover:bg-slate-800">Open Ready Details</Link>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded border border-slate-800 bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Frontend queue</div>
            <div className={needsAudit.length > 0 ? 'mt-1 text-sm text-amber-300' : 'mt-1 text-sm text-emerald-300'}>
              {needsAudit.length > 0 ? `${needsAudit.length} need audit` : 'Accepted'}
            </div>
            <div className="mt-1 text-xs text-slate-500">{features.length} total frontend records</div>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Local UI check</div>
            <div className="mt-1 text-sm text-cyan-300">Required</div>
            <div className="mt-1 text-xs text-slate-500">Launch app before acceptance</div>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Frontend heartbeat</div>
            <div className={live ? 'mt-1 text-sm text-emerald-300' : 'mt-1 text-sm text-slate-300'}>{live ? 'Live' : 'Not running'}</div>
            <div className="mt-1 text-xs text-slate-500">{featureRun.heartbeatAt ? new Date(featureRun.heartbeatAt).toLocaleString() : 'No heartbeat yet'}</div>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Safe state</div>
            <div className={startCheckPassed ? 'mt-1 text-sm text-emerald-300' : 'mt-1 text-sm text-amber-300'}>{startCheckPassed ? 'Ready' : 'Check first'}</div>
            <div className="mt-1 text-xs text-slate-500">{startReadiness.createdAt && startCheckCurrent ? new Date(startReadiness.createdAt).toLocaleString() : 'No frontend check recorded'}</div>
          </div>
        </div>

        <div className="mt-4 rounded border border-slate-800 bg-slate-950/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <BuildProgressGauge percent={percent} state={percent === 100 ? 'complete' : 'halted'} label={percent === 100 ? 'Complete' : 'Needs audit'} message={`${accepted.length}/${features.length} accepted · ${needsAudit.length} need audit`} size="md" />
            <div className="text-right text-xs text-slate-500">
              <div>{pending.length} pending</div>
              <div>{featureRun.heartbeatAt ? `Heartbeat ${new Date(featureRun.heartbeatAt).toLocaleTimeString()}` : 'No heartbeat yet'}</div>
            </div>
          </div>
          <div className="mt-3 h-3 rounded bg-slate-800">
            <div className="h-3 rounded bg-cyan-500" style={{ width: `${percent}%` }} />
          </div>
          <div className="responsive-actions mt-3">
            <Link href="/rev1-coverage" className="min-h-11 rounded-md bg-cyan-600 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-500">
              Open Feature Queue
            </Link>
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="app-launch" />
              <button className="min-h-11 rounded-md border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800">Launch App Locally</button>
            </form>
            <Link href="/deploy" className="min-h-11 rounded-md border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800">
              Continue to Deploy →
            </Link>
          </div>
        </div>

        {(startReadiness.steps ?? []).length > 0 && startCheckCurrent && (
          <div className="mt-4 grid gap-2">
            {startReadiness.steps?.map((step) => (
              <div key={step.name} className="flex flex-wrap items-start gap-2 rounded border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm">
                <span className={step.status === 'pass' ? 'rounded bg-emerald-900 px-2 py-1 text-xs text-emerald-100' : 'rounded bg-red-900 px-2 py-1 text-xs text-red-100'}>{step.status === 'pass' ? 'pass' : 'needs attention'}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-200">{step.name}</div>
                  <div className="mt-1 text-slate-400">{step.message}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <details className="mt-6 rounded-md border border-slate-800 bg-slate-900 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-200 hover:text-white">Frontend workflow &amp; lane notes <span className="ml-1 text-xs font-normal text-slate-500">(show details)</span></summary>
        <div className="mt-4 space-y-3 text-sm text-slate-300">
          <p>1. Run Start Check.</p>
          <p>2. Open Feature Queue and review records marked Needs audit.</p>
          <p>3. Launch the local app and verify each screen or workflow.</p>
          <p>4. Confirm mobile layout, labels, and visual completion.</p>
          <p>5. Deploy only after frontend acceptance is recorded.</p>
        </div>
        <p className="mt-4 max-w-4xl text-sm leading-6 text-slate-400">
          Dedicated control view for Docmee frontend work. Use this to track visual/product acceptance, UI build progress, mobile behavior, language labels, and final frontend readiness before VPS deployment.
        </p>
        <div className="mt-4 rounded border border-amber-900/70 bg-amber-950/20 p-3 text-sm text-amber-100/80">
          Frontend Build Control is separate from backend Build Control. Backend can be complete while frontend still needs product acceptance.
        </div>
      </details>

      <details className="mt-6 rounded-md border border-slate-800 bg-slate-900 p-4">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Frontend records by area</h2>
          <BuildProgressGauge percent={percent} state={percent === 100 ? 'complete' : 'halted'} label={`${percent}% accepted`} message={`${needsAudit.length} need audit`} />
        </summary>
        <div className="mt-4 space-y-4">
          {Object.entries(areaGroups).map(([area, areaRows]) => {
            const areaAccepted = areaRows.filter((item) => frontendStage(item) === 'complete').length
            return (
              <details key={area} className="rounded-md border border-slate-800 bg-slate-950/40 p-3">
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">{area}</h3>
                    <p className="mt-1 text-xs text-slate-500">{areaAccepted}/{areaRows.length} accepted</p>
                  </div>
                  <BuildProgressGauge percent={progress(areaAccepted, areaRows.length)} state={areaAccepted === areaRows.length ? 'complete' : 'halted'} showLabel={false} size="sm" />
                </summary>
                <div className="mt-3 grid gap-2">
                  {areaRows.map((item) => {
                    const stage = frontendStage(item)
                    const gauge = stage === 'complete' ? { percent: 100, tone: 'emerald' as const } : stage === 'needs-audit' ? { percent: 60, tone: 'amber' as const } : { percent: 10, tone: 'slate' as const }
                    return (
                      <div key={item.id} className="responsive-record-row gap-3 rounded border border-slate-800 px-3 py-2">
                        <LaneItemGauge percent={gauge.percent} tone={gauge.tone} title={stage} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-slate-200">Req {item.id} · {item.feature}</div>
                          <div className="text-xs text-slate-500">{item.phase} · {item.area}</div>
                        </div>
                        <div className="responsive-record-row-actions flex items-center gap-2">
                          <StatusDot tone={stageDot(stage)} label={stageLabel(stage)} />
                          <StatusDot tone={priorityDot(item.priority)} label={`Priority: ${item.priority}`} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </details>
            )
          })}
        </div>
      </details>
    </section>
  )
}
