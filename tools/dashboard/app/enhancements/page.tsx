import path from 'node:path'
import Link from 'next/link'
import { BuildProgressGauge } from '../build-progress-gauge'
import { StatusDot } from '../status-dot'
import { DetailButton } from '../detail-button'
import { AutoRefresh } from '../auto-refresh'
import { LaneFlowStrip } from '../lane-flow-strip'
import { LaneItemGauge } from '../lane-item-gauge'
import { runLiveness, isProcessAlive } from '../lib/run-live'
import { readJson } from '../lib/read-json'

const toolsRoot = path.resolve(process.cwd(), '..')
const enhancementsFile = path.join(toolsRoot, 'logs', 'enhancements.json')
const readyFile = path.join(toolsRoot, 'logs', 'ready.json')
const startReadinessFile = path.join(toolsRoot, 'logs', 'start-readiness-enhancements-development.json')
const featureRunFile = path.join(toolsRoot, 'logs', 'feature-run.json')

type EnhancementStatus = 'complete' | 'planned' | 'missing'
type Enhancement = {
  id: number
  phase: string
  area: string
  enhancement: string
  status: EnhancementStatus
  priority: 'critical' | 'high' | 'medium' | 'low'
  source: string
  nextStep: string
}
type PageProps = { searchParams?: { message?: string; error?: string } }
type Ready = { ready?: boolean; summary?: { critical?: number; warning?: number; pass?: number }; createdAt?: string }
type StartReadiness = { ready?: boolean; phase?: string; createdAt?: string; steps?: Array<{ name: string; status: 'pass' | 'fail'; message: string }> }
type FeatureRun = { pid?: number; phase?: string; workflow?: string; status?: string; heartbeatAt?: string; message?: string }

const defaultEnhancements: Enhancement[] = [
  { id: 1, phase: 'Sentinel Platform', area: 'Navigation', enhancement: 'Rename current Sentinel surface to Forge and make Sentinel the parent platform', status: 'planned', priority: 'critical', source: 'Sentinel Platform restructure', nextStep: 'Add Forge page, update sidebar label, and keep current Sentinel issue scanner behavior under Forge.' },
  { id: 2, phase: 'Sentinel Platform', area: 'Runtime', enhancement: 'Add Sentinel Daemon with independent API, tray indicator, Beacon, Healer, and subsystem startup', status: 'missing', priority: 'critical', source: 'Sentinel Daemon spec', nextStep: 'Build daemon process, health API on port 4001, local config merge, PID/log files, and dashboard self-healing policy.' },
  { id: 3, phase: 'Production Guardian', area: 'VPS uptime', enhancement: 'Add Guardian production uptime monitor as a VPS systemd service', status: 'missing', priority: 'critical', source: 'Guardian Production Uptime Spec V1', nextStep: 'Create Guardian daemon, .env.guardian, heartbeat/audit/check logs, systemd unit, and Sentinel issue handoff.' },
  { id: 4, phase: 'Production Guardian', area: 'Smoke tests', enhancement: 'Add Guardian canary business logic checks for login, inbox, queue, and AI reply flow', status: 'missing', priority: 'high', source: 'Guardian Production Uptime Spec V1', nextStep: 'Create safe test clinic canary flow, cleanup routine, and escalation after repeated failures.' },
  { id: 5, phase: 'Sentinel Platform', area: 'Aegis', enhancement: 'Add Aegis product integrity monitor page and issue source', status: 'missing', priority: 'high', source: 'Sentinel Platform restructure', nextStep: 'Create /aegis dashboard shell, define log schema, and add Aegis heartbeat into Sentinel/Beacon.' },
  { id: 6, phase: 'Deployment', area: 'Public access', enhancement: 'Replace ngrok and Tailscale dependency with Cloudflare Tunnel mode', status: 'planned', priority: 'high', source: 'Cloudflare Tunnel architecture decision', nextStep: 'Add Cloudflare public URL mode, tunnel deployment guide, DevTools Access URL, and Guardian public URL sync.' },
  { id: 7, phase: 'DevTools', area: 'Agents', enhancement: 'Add Sentinel executor with direct-call agents and Claude Code agents behind permission envelopes', status: 'missing', priority: 'medium', source: 'Sentinel Agent Executor spec', nextStep: 'Add task writer, session guard, executor, verifier, audit logging, and task log polling.' },
  { id: 8, phase: 'DevTools', area: 'Deployment', enhancement: 'Add .env readiness gate before VPS .env sync and deploy', status: 'complete', priority: 'medium', source: 'DevTools enhancement', nextStep: 'Keep using Check .env Readiness on the Deploy page before VPS deployment.' }
]

function readEnhancements() {
  const customEnhancements = readJson<Enhancement[]>(enhancementsFile, [])
  const customIds = new Set(customEnhancements.map((item) => item.id))
  return [
    ...defaultEnhancements.filter((item) => !customIds.has(item.id)),
    ...customEnhancements
  ]
}

function priorityDotTone(priority: Enhancement['priority']) {
  if (priority === 'critical') return 'red' as const
  if (priority === 'high') return 'orange' as const
  if (priority === 'medium') return 'amber' as const
  return 'slate' as const
}

function enhancementPercent(status: EnhancementStatus) {
  if (status === 'complete') return 100
  if (status === 'planned') return 25
  return 0
}

function laneGauge(status: EnhancementStatus): { percent: number; tone: 'emerald' | 'amber' | 'slate' } {
  if (status === 'complete') return { percent: 100, tone: 'emerald' }
  if (status === 'planned') return { percent: 45, tone: 'amber' }
  return { percent: 8, tone: 'slate' }
}

function overallPercent(items: Enhancement[]) {
  if (items.length === 0) return 0
  return Math.round(items.reduce((sum, item) => sum + enhancementPercent(item.status), 0) / items.length)
}

function countBy<T extends string>(rows: Enhancement[], read: (row: Enhancement) => T) {
  return rows.reduce<Record<T, number>>((acc, row) => {
    const key = read(row)
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {} as Record<T, number>)
}

export default function EnhancementsPage({ searchParams }: PageProps) {
  const enhancements = readEnhancements().sort((a, b) => a.id - b.id)
  const statusCounts = countBy(enhancements, (row) => row.status)
  const phaseCounts = countBy(enhancements.filter((row) => row.status !== 'complete'), (row) => row.phase)
  const ready = readJson<Ready>(readyFile, { ready: false, summary: { critical: 1, warning: 0, pass: 0 } })
  const startReadiness = readJson<StartReadiness>(startReadinessFile, { ready: false, steps: [] })
  const run = readJson<FeatureRun>(featureRunFile, { status: 'idle' })
  const readyCritical = ready.summary?.critical ?? 1
  const openQueue = enhancements.filter((row) => row.status !== 'complete')
  const complete = statusCounts.complete ?? 0
  const planned = statusCounts.planned ?? 0
  const missing = statusCounts.missing ?? 0
  const percent = overallPercent(enhancements)
  const nextPhase = openQueue[0]?.phase ?? 'Enhancements'
  const startCheckPassed = Boolean(startReadiness.ready && startReadiness.phase === nextPhase)
  const enhancementRunActive = run.workflow === 'enhancements-development'
  const enhancementLiveness = runLiveness(run, isProcessAlive(run.pid))
  const live = enhancementRunActive && enhancementLiveness.live
  const staleRun = enhancementRunActive && enhancementLiveness.stale
  const gaugeState = openQueue.length === 0 ? 'complete' : live ? 'progressing' : planned > 0 ? 'halted' : 'stopped'
  const priorityOrder: Record<Enhancement['priority'], number> = { critical: 0, high: 1, medium: 2, low: 3 }
  const nextQueue = openQueue
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || a.id - b.id)
    .slice(0, 12)

  return (
    <section className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Enhancements</h1>
          <p className="mt-2 text-sm text-slate-400">
            Post-feature development queue. After the 41 designed features are complete, new development goes here unless it is a bug, deployment blocker, or production incident.
          </p>
        </div>
        <Link href="/codex-switch" className="min-h-11 rounded-md border border-slate-700 px-3 py-2 text-sm text-sky-300 hover:bg-slate-800">
          Prepare Codex
        </Link>
      </div>

      <AutoRefresh seconds={15} />
      <div className="mt-3">
        <LaneFlowStrip
          label="Workflow"
          stages={[
            { label: 'Start check', tone: 'cyan' },
            { label: 'Enhancement automation · Claude', tone: 'amber' },
            { label: 'Review', tone: 'violet' },
            { label: 'Complete', tone: 'emerald' }
          ]}
        />
      </div>
      {staleRun && <p className="mt-3 rounded-md border border-amber-800 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">⚠ The enhancement watcher process is alive but has not sent a heartbeat recently — it may be hung. You can start a new run.</p>}
      {searchParams?.message && <p className="mt-3 rounded-md border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-200">{searchParams.message}</p>}
      {searchParams?.error && <p className="mt-3 rounded-md border border-red-800 bg-red-950/30 p-3 text-sm text-red-200">{searchParams.error}</p>}

      <div className="mt-4 rounded-md border border-cyan-800 bg-cyan-950/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-cyan-100">Enhancement Control</h2>
            <p className="mt-2 text-sm leading-6 text-cyan-100/80">
              Review the enhancement queue, run readiness before starting work, then move implementation through local validation and deployment.
            </p>
          </div>
          <BuildProgressGauge size="md" percent={percent} state={gaugeState} label={live ? 'Enhancements running' : 'Enhancement progress'} message={live ? run.message ?? 'Enhancement automation is running.' : `${complete}/${enhancements.length} complete, ${planned} planned, ${missing} missing`} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <form action="/api/actions" method="post">
            <input type="hidden" name="action" value="start-readiness" />
            <input type="hidden" name="phase" value={nextPhase} />
            <input type="hidden" name="workflow" value="enhancements-development" />
            <button className="min-h-11 rounded-md border border-cyan-700 px-3 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-950/40">Run Start Check</button>
          </form>
          <form action="/api/actions" method="post">
            <input type="hidden" name="action" value="phase-build-watch" />
            <input type="hidden" name="from" value={nextPhase} />
            <input type="hidden" name="workflow" value="enhancements-development" />
            <button disabled={!startCheckPassed || live || openQueue.length === 0 || readyCritical > 0} title={readyCritical > 0 ? `${readyCritical} critical setup issue(s) must be fixed first` : !startCheckPassed ? `Run the start check for ${nextPhase} first` : live ? 'Enhancement automation is already running' : openQueue.length === 0 ? 'No open enhancements to work on' : 'Start enhancement automation'} className="min-h-11 rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">Start Enhancements</button>
          </form>
          <form action="/api/actions" method="post">
            <input type="hidden" name="action" value="phase-build-stop" />
            <button disabled={!live} className="min-h-11 rounded-md border border-red-800 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500">Stop</button>
          </form>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className={readyCritical > 0 ? 'rounded border border-red-800 bg-red-950/30 p-3' : 'rounded border border-emerald-800 bg-emerald-950/30 p-3'}>
            <p className="text-xs text-slate-400">Ready Check</p>
            <p className={readyCritical > 0 ? 'mt-1 text-sm font-semibold text-red-200' : 'mt-1 text-sm font-semibold text-emerald-200'}>{readyCritical > 0 ? `${readyCritical} blocker(s)` : 'Ready'}</p>
          </div>
          <div className={startCheckPassed ? 'rounded border border-emerald-800 bg-emerald-950/30 p-3' : 'rounded border border-amber-800 bg-amber-950/30 p-3'}>
            <p className="text-xs text-slate-400">Start Check</p>
            <p className={startCheckPassed ? 'mt-1 text-sm font-semibold text-emerald-200' : 'mt-1 text-sm font-semibold text-amber-200'}>{startCheckPassed ? `Passed for ${nextPhase}` : `Needed for ${nextPhase}`}</p>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/40 p-3"><p className="text-xs text-slate-400">Current queue</p><p className="mt-1 text-sm font-semibold text-slate-200">{openQueue.length} open</p></div>
          <div className={live ? 'rounded border border-emerald-800 bg-emerald-950/30 p-3' : 'rounded border border-slate-800 bg-slate-950/40 p-3'}><p className="text-xs text-slate-400">Watcher</p><p className={live ? 'mt-1 text-sm font-semibold text-emerald-200' : 'mt-1 text-sm font-semibold text-slate-200'}>{live ? 'Running' : run.status ?? 'Idle'}</p></div>
          <Link href="/deploy" className="rounded border border-slate-800 bg-slate-950/40 p-3 hover:border-cyan-700"><p className="text-xs text-slate-400">Deployment</p><p className="mt-1 text-sm font-semibold text-cyan-200">Continue to Deploy →</p></Link>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-md border border-slate-800 bg-slate-900 p-4"><p className="text-xs text-slate-500">Enhancements</p><p className="mt-2 text-3xl font-semibold">{enhancements.length}</p></div>
          <div className="rounded-md border border-red-900 bg-red-950/20 p-4"><p className="text-xs text-red-200/70">Missing</p><p className="mt-2 text-3xl font-semibold text-red-200">{missing}</p></div>
          <div className="rounded-md border border-amber-900 bg-amber-950/20 p-4"><p className="text-xs text-amber-200/70">Planned</p><p className="mt-2 text-3xl font-semibold text-amber-200">{planned}</p></div>
          <div className="rounded-md border border-emerald-900 bg-emerald-950/20 p-4"><p className="text-xs text-emerald-200/70">Complete</p><p className="mt-2 text-3xl font-semibold text-emerald-200">{complete}</p></div>
        </div>
      </div>

      <details className="mt-4 rounded-md border border-slate-800 bg-slate-900 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-200 hover:text-white">Next enhancement queue <span className="ml-1 text-xs font-normal text-slate-500">({nextQueue.length} shown)</span></summary>
        <div className="mt-4 grid gap-5 xl:grid-cols-[1fr_380px]">
          <div className="rounded-md border border-slate-800 bg-slate-950/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Next Enhancement Queue</h2>
                <p className="mt-1 text-xs text-slate-400">Sorted by priority. These are separate from product feature development.</p>
              </div>
              <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">{nextQueue.length} shown</span>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {nextQueue.map((item) => (
                <article key={item.id} className="rounded-md border border-slate-800 bg-slate-950/50 p-3">
                  <div className="flex items-start gap-3">
                    <LaneItemGauge percent={laneGauge(item.status).percent} tone={laneGauge(item.status).tone} title={item.status} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-slate-500">Enh {item.id} · {item.phase} · {item.area}</p>
                      <h3 className="mt-1 text-sm font-semibold text-slate-100">{item.enhancement}</h3>
                    </div>
                    <StatusDot tone={priorityDotTone(item.priority)} label={`Priority: ${item.priority}`} />
                  </div>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-cyan-200">Next step &amp; source</summary>
                    <p className="mt-2 rounded border border-cyan-900/70 bg-cyan-950/20 p-2 text-xs leading-5 text-cyan-100">Next: {item.nextStep}</p>
                    <p className="mt-2 text-xs leading-5 text-slate-400">Source: {item.source}</p>
                  </details>
                </article>
              ))}
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-md border border-slate-800 bg-slate-950/40 p-4">
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
            <details className="rounded-md border border-amber-900/70 bg-amber-950/20 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-amber-100">Enhancement Rule</summary>
              <p className="mt-2 text-sm leading-6 text-amber-100/80">
                All new development after the 41 features are complete goes here by default. Bugs, deployment blockers, and production incidents stay on their own operational pages.
              </p>
            </details>
            <details className="rounded-md border border-slate-800 bg-slate-900 p-4">
              <summary className="cursor-pointer text-sm font-semibold">Source</summary>
              <p className="mt-2 break-all text-xs leading-5 text-slate-400">Notion Sentinel, Sentinel Daemon, Guardian, and Cloudflare Tunnel specs. Optional override: tools/logs/enhancements.json</p>
            </details>
          </div>
        </div>
      </details>

      <details className="mt-4 rounded-md border border-slate-800 bg-slate-900 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-200 hover:text-white">All enhancements <span className="ml-1 text-xs font-normal text-slate-500">({enhancements.length} total)</span></summary>
        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-slate-900 text-slate-300">
              <tr>
                <th className="p-3">Progress</th>
                <th className="p-3">Enh</th>
                <th className="p-3">Phase</th>
                <th className="p-3">Area</th>
                <th className="p-3">Enhancement</th>
                <th className="p-3">Priority</th>
                <th className="p-3">Next Step</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {enhancements.map((item) => (
                <tr key={item.id} className="bg-slate-950/60 align-top">
                  <td className="p-3"><LaneItemGauge percent={laneGauge(item.status).percent} tone={laneGauge(item.status).tone} title={item.status} /></td>
                  <td className="p-3 font-mono text-xs text-slate-400">{item.id}</td>
                  <td className="p-3 whitespace-nowrap">{item.phase}</td>
                  <td className="p-3">{item.area}</td>
                  <td className="p-3 font-medium text-slate-100">{item.enhancement}</td>
                  <td className="p-3"><StatusDot tone={priorityDotTone(item.priority)} label={`Priority: ${item.priority}`} /></td>
                  <td className="whitespace-nowrap p-3"><DetailButton buttonLabel="View" title={item.enhancement} body={item.nextStep} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}
