import path from 'node:path'
import Link from 'next/link'
import { activeIssues, readAudit, readIssues, readTray } from '../lib/sentinel-platform'
import { AutoRefresh } from '../auto-refresh'
import { readJson } from '../lib/read-json'
import { BuildProgressGauge } from '../build-progress-gauge'
import { LaneItemGauge } from '../lane-item-gauge'

export const dynamic = 'force-dynamic'

const toolsRoot = path.resolve(process.cwd(), '..')
const logsRoot = path.join(toolsRoot, 'logs')
const featureCoverageFile = path.join(logsRoot, 'rev1-feature-coverage.json')
const deploymentRecordsFile = path.join(logsRoot, 'docmee-deployment-records.json')
const startReadinessFile = path.join(logsRoot, 'start-readiness.json')

type StageStatus = 'complete' | 'pending' | 'needs-audit'
type DeploymentFeature = { status?: string; backendStatus?: StageStatus; frontendStatus?: StageStatus }
type DeploymentRecords = { groups?: Array<{ id?: string; summary?: { designedFeatures?: number; complete?: number; pending?: number; needsAudit?: number } }> }
type StartReadiness = { phase?: string; steps?: Array<{ name?: string; message?: string }> }

function stageFor(item: DeploymentFeature, field: 'backendStatus' | 'frontendStatus'): StageStatus {
  const explicit = item[field]
  if (explicit === 'complete' || explicit === 'pending' || explicit === 'needs-audit') return explicit
  if (field === 'backendStatus') return item.status === 'complete' ? 'complete' : 'pending'
  return item.status === 'complete' ? 'needs-audit' : 'pending'
}

function summary(features: DeploymentFeature[], field: 'backendStatus' | 'frontendStatus') {
  return features.reduce(
    (acc, item) => {
      const stage = stageFor(item, field)
      if (stage === 'needs-audit') acc.needsAudit += 1
      else acc[stage] += 1
      return acc
    },
    { designedFeatures: features.length, complete: 0, pending: 0, needsAudit: 0 }
  )
}

function matches(actual: ReturnType<typeof summary>, expected: ReturnType<typeof summary>) {
  return actual.designedFeatures === expected.designedFeatures && actual.complete === expected.complete && actual.pending === expected.pending && actual.needsAudit === expected.needsAudit
}

function displaySummary(s: { designedFeatures?: number; complete?: number; pending?: number; needsAudit?: number }) {
  return `${s.complete ?? 0}/${s.designedFeatures ?? 0} complete · ${s.pending ?? 0} pending · ${s.needsAudit ?? 0} audit`
}

export default function HealerPage({ searchParams }: { searchParams?: { message?: string; error?: string } }) {
  const tray = readTray()
  const issues = activeIssues(readIssues()).filter((issue) => issue.source === 'devtools-healer' || issue.category === 'frontend-acceptance-drift')
  const audit = readAudit().filter((entry) => (entry.subsystem ?? '').toLowerCase() === 'healer').slice(0, 12)
  const features = readJson<DeploymentFeature[]>(featureCoverageFile, [])
  const records = readJson<DeploymentRecords>(deploymentRecordsFile, {})
  const readiness = readJson<StartReadiness>(startReadinessFile, {})
  const expectedBackend = summary(features, 'backendStatus')
  const expectedFrontend = summary(features, 'frontendStatus')
  const actualBackend = records.groups?.find((group) => group.id === 'backend')?.summary ?? {}
  const actualFrontend = records.groups?.find((group) => group.id === 'frontend')?.summary ?? {}
  const backendOk = matches({ designedFeatures: 0, complete: 0, pending: 0, needsAudit: 0, ...actualBackend }, expectedBackend)
  const frontendOk = matches({ designedFeatures: 0, complete: 0, pending: 0, needsAudit: 0, ...actualFrontend }, expectedFrontend)
  const queueStep = readiness.steps?.find((step) => step.name === 'Frontend Queue')
  const driftClear = backendOk && frontendOk
  // Overall recovery health: derived-record alignment counts for most of the
  // signal, with open Healer issues docking the score so the header gauge
  // reflects both drift and outstanding corrections.
  const driftHealth = (backendOk ? 50 : 0) + (frontendOk ? 50 : 0)
  const healthPercent = issues.length > 0 ? Math.max(0, driftHealth - 25) : driftHealth
  const healthState = healthPercent >= 100 ? 'complete' : healthPercent === 0 ? 'halted' : 'progressing'
  const healthMessage = driftClear && issues.length === 0 ? 'Derived records aligned' : !driftClear ? 'Drift in derived records' : `${issues.length} open issue${issues.length === 1 ? '' : 's'}`
  const backendPercent = expectedBackend.designedFeatures > 0 ? (expectedBackend.complete / expectedBackend.designedFeatures) * 100 : 0
  const frontendPercent = expectedFrontend.designedFeatures > 0 ? (expectedFrontend.complete / expectedFrontend.designedFeatures) * 100 : 0

  return (
    <section className="w-full space-y-6">
      <AutoRefresh seconds={15} />
      <div className="flex flex-col items-stretch gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-cyan-200/80">Sentinel subsystem</p>
          <h1 className="text-2xl font-semibold">Healer</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-400">
            Deterministic recovery and safe correction. Forge detects development signal drift; Healer performs only allowed, low-risk corrections.
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-3 sm:items-end">
          <BuildProgressGauge size="sm" percent={healthPercent} state={healthState} label="Recovery health" message={healthMessage} />
          <div className="responsive-actions">
            <Link href="/sentinel" className="min-h-11 rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">Sentinel</Link>
            <Link href="/forge" className="min-h-11 rounded-md border border-cyan-700 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-950/40">Forge</Link>
          </div>
        </div>
      </div>

      {searchParams?.message && <p className="rounded-md border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-200">{searchParams.message}</p>}
      {searchParams?.error && <p className="rounded-md border border-red-800 bg-red-950/30 p-3 text-sm text-red-200">{searchParams.error}</p>}

      <div className="grid gap-3 md:grid-cols-4">
        <StatusCard label="Daemon" value={tray.state === 'healthy' ? 'Healthy' : tray.state ?? 'Unknown'} tone={tray.state === 'healthy' ? 'emerald' : 'amber'} />
        <StatusCard label="Healer Issues" value={String(issues.length)} tone={issues.length > 0 ? 'amber' : 'emerald'} />
        <StatusCard label="Derived Records" value={driftClear ? 'Aligned' : 'Drift'} tone={driftClear ? 'emerald' : 'amber'} />
        <StatusCard label="Auto Correct" value="Enabled" tone="cyan" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold">Frontend Acceptance Drift</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Source of truth is `rev1-feature-coverage.json`. Healer only refreshes derived summaries and readiness text.
              </p>
            </div>
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="healer-refresh-derived-deployment-records" />
              <button className="min-h-11 rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500">Refresh Derived Records</button>
            </form>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <DriftRow title="Backend summary" ok={backendOk} expected={displaySummary(expectedBackend)} actual={displaySummary(actualBackend)} percent={backendPercent} />
            <DriftRow title="Frontend summary" ok={frontendOk} expected={displaySummary(expectedFrontend)} actual={displaySummary(actualFrontend)} percent={frontendPercent} />
          </div>
          <div className="mt-3 rounded border border-slate-800 bg-slate-950/40 p-3 text-sm">
            <div className="text-xs text-slate-500">Frontend Queue message</div>
            <div className="mt-1 text-slate-300">{queueStep?.message ?? 'No frontend queue step recorded.'}</div>
          </div>
        </div>

        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-semibold">Permission Envelope</h2>
          <div className="mt-3 space-y-2 text-sm">
            {['refresh-derived-deployment-records', 'kill-dashboard-process', 'clear-next-cache', 'restart-dashboard-process', 'kill-port-conflict'].map((action) => (
              <div key={action} className="rounded border border-emerald-900/70 bg-emerald-950/20 px-3 py-2 text-emerald-100">{action}</div>
            ))}
            {['modify-source-files', 'modify-phase-state', 'modify-env-files', 'run-git-commands'].map((action) => (
              <div key={action} className="rounded border border-red-900/70 bg-red-950/20 px-3 py-2 text-red-100">{action} denied</div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-semibold">Recent Healer Activity</h2>
        <div className="mt-4 space-y-2">
          {audit.map((entry, index) => (
            <div key={`${entry.ts ?? entry.createdAt ?? index}-${entry.action ?? index}`} className="rounded border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={entry.outcome === 'success' ? 'text-emerald-300' : entry.outcome === 'failed' ? 'text-red-300' : 'text-slate-300'}>{entry.action ?? 'activity'}</span>
                <span className="text-xs text-slate-500">{entry.ts ? new Date(entry.ts).toLocaleString() : entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'no time'}</span>
              </div>
              <p className="mt-1 text-xs text-slate-400">{entry.message ?? entry.outcome ?? 'No details.'}</p>
            </div>
          ))}
          {audit.length === 0 && <div className="rounded border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-500">No Healer activity recorded yet.</div>}
        </div>
      </div>
    </section>
  )
}

function StatusCard({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'amber' | 'cyan' }) {
  const cls = tone === 'emerald' ? 'border-emerald-800 bg-emerald-950/20 text-emerald-200' : tone === 'amber' ? 'border-amber-800 bg-amber-950/20 text-amber-200' : 'border-cyan-800 bg-cyan-950/20 text-cyan-200'
  return (
    <div className={`rounded-md border p-4 ${cls}`}>
      <div className="text-xs opacity-70">{label}</div>
      <div className="mt-2 text-xl font-semibold">{value}</div>
    </div>
  )
}

function DriftRow({ title, ok, expected, actual, percent }: { title: string; ok: boolean; expected: string; actual: string; percent: number }) {
  return (
    <div className={`rounded-md border p-3 ${ok ? 'border-emerald-800 bg-emerald-950/20' : 'border-amber-800 bg-amber-950/20'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className={ok ? 'text-sm font-semibold text-emerald-200' : 'text-sm font-semibold text-amber-200'}>{title}</div>
        <LaneItemGauge percent={percent} tone={ok ? 'emerald' : 'amber'} title={`${title} complete`} />
      </div>
      <div className="mt-2 text-xs text-slate-400">Expected: {expected}</div>
      <div className="mt-1 text-xs text-slate-400">Actual: {actual}</div>
    </div>
  )
}
