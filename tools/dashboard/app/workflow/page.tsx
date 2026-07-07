import fs from 'node:fs'
import path from 'node:path'
import Link from 'next/link'
import { StatusDot } from '../status-dot'
import { DeployEverythingPanel } from '../deploy-everything-panel'
import { BacklogFlowStrip } from '../backlog-flow-strip'
import { AutoRefresh } from '../auto-refresh'
import { runLiveness } from '../lib/run-live'
import { maybeAutoSyncBacklog } from '../lib/backlog-autosync'

const logsRoot = path.resolve(process.cwd(), '..', 'logs')

type RunState = { pid?: number; status?: string; phase?: string; message?: string; heartbeatAt?: string; workflow?: string }
type VerifyStage = { key: string; label: string; status: string; message?: string }
type VerifyRun = { pid?: number; status?: string; currentStage?: string; percent?: number; overall?: 'pass' | 'fail' | null; startedAt?: string; finishedAt?: string; heartbeatAt?: string; stages?: VerifyStage[] }

function verifyStageTone(status: string) {
  if (status === 'pass') return 'bg-emerald-900 text-emerald-100'
  if (status === 'fail') return 'bg-red-900 text-red-100'
  if (status === 'warning') return 'bg-amber-900 text-amber-100'
  if (status === 'running') return 'bg-cyan-900 text-cyan-100'
  return 'bg-slate-800 text-slate-300'
}

function readJson<T>(file: string, fallback: T): T {
  const target = path.join(logsRoot, file)
  if (!fs.existsSync(target)) return fallback
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8')) as T
  } catch {
    return fallback
  }
}

function isAlive(pid?: number) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function laneState(run: RunState) {
  const live = isAlive(run.pid) && ['starting', 'running', 'paused'].includes(run.status ?? '')
  return {
    live,
    tone: (live ? 'green' : run.status === 'failed' ? 'red' : run.status === 'complete' ? 'green' : 'slate') as 'green' | 'red' | 'amber' | 'slate',
    label: live ? 'Running' : run.status === 'complete' ? 'Complete' : run.status === 'failed' ? 'Failed' : 'Idle'
  }
}

function pct(done: number, total: number) {
  if (!total) return 0
  return Math.round((done / total) * 100)
}

type Feature = { status?: string; frontendStatus?: string }
type Screen = { status?: string }
type Phase = { id: string; status?: string }

export default function WorkflowPage() {
  maybeAutoSyncBacklog()
  const build = readJson<RunState>('build-run.json', { status: 'idle' })
  const backend = readJson<RunState>('feature-run.json', { status: 'idle' })
  const frontend = readJson<RunState>('frontend-run.json', { status: 'idle' })
  const ui = readJson<RunState>('ui-run.json', { status: 'idle' })
  // Backend + Enhancements share feature-run.json; split by workflow so each lane shows its own state.
  const enhancementsActive = backend.workflow === 'enhancements-development'
  const backendRun: RunState = enhancementsActive ? { status: 'idle' } : backend
  const enhancementsRun: RunState = enhancementsActive ? backend : { status: 'idle' }

  const phases = readJson<Phase[]>('phases.json', [])
  const phaseDone = phases.filter((p) => /^P\d{2}$/.test(p.id) && p.status === 'done').length
  const phaseTotal = phases.filter((p) => /^P\d{2}$/.test(p.id)).length || 19

  const features = readJson<Feature[]>('rev1-feature-coverage.json', [])
  const backendDone = features.filter((f) => f.status === 'complete').length
  const frontendDone = features.filter((f) => f.frontendStatus === 'complete').length

  const screens = readJson<Screen[]>('ui-development-records.json', [])
  const uiDone = screens.filter((s) => s.status === 'complete').length

  const enhancements = readJson<Array<{ status?: string }>>('enhancements.json', [])
  const enhancementsDone = enhancements.filter((e) => e.status === 'complete').length

  const ready = readJson<{ summary?: { critical?: number } }>('ready.json', { summary: { critical: 1 } })
  const readyCritical = ready.summary?.critical ?? 1

  const postRuns = readJson<Array<{ summary?: { fail?: number; pass?: number }; createdAt?: string }>>('post-deployment.json', [])
  const lastDeployCheck = postRuns[0]

  const backlog = readJson<Array<{ status?: string }>>('backlog.json', [])
  const backlogOpen = backlog.filter((t) => t.status !== 'done').length

  const verify = readJson<VerifyRun>('verify-run.json', { status: 'idle' })
  const verifyState = runLiveness(verify, isAlive(verify.pid))
  const verifyRunning = verifyState.live

  const lanes = [
    { key: 'build', name: 'Build', run: build, href: '/build-control', detail: `${phaseDone}/${phaseTotal} phases`, percent: pct(phaseDone, phaseTotal) },
    { key: 'backend', name: 'Backend', run: backendRun, href: '/rev1-coverage', detail: `${backendDone}/${features.length || 41} features`, percent: pct(backendDone, features.length || 41) },
    { key: 'frontend', name: 'Frontend', run: frontend, href: '/frontend-build-control', detail: `${frontendDone}/${features.length || 41} frontend`, percent: pct(frontendDone, features.length || 41) },
    { key: 'ui', name: 'UI', run: ui, href: '/docmee-audit', detail: `${uiDone}/${screens.length || 17} screens`, percent: pct(uiDone, screens.length || 17) },
    { key: 'enhancements', name: 'Enhancements', run: enhancementsRun, href: '/enhancements', detail: `${enhancementsDone}/${enhancements.length} done`, percent: pct(enhancementsDone, enhancements.length) }
  ]

  return (
    <section className="w-full">
      <AutoRefresh seconds={6} />
      <div>
        <h1 className="text-2xl font-semibold">Workflow</h1>
        <p className="mt-2 text-sm text-slate-400">The Docmee development → deployment pipeline. Each lane builds locally, gets verified, deploys to the VPS, then is monitored.</p>
      </div>

      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-slate-400">0 · Plan</h2>
      <p className="mt-1 text-xs text-slate-500">Ad-hoc work outside the structured lanes (bugs, infra, ideas).</p>
      <Link href="/backlog" className="mt-3 flex items-center justify-between rounded-md border border-slate-800 bg-slate-900 p-4 hover:border-slate-600">
        <span className="font-semibold text-slate-100">Backlog</span>
        <span className="text-sm text-slate-400">{backlogOpen} open item{backlogOpen === 1 ? '' : 's'} →</span>
      </Link>
      <div className="mt-3"><BacklogFlowStrip /></div>

      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-slate-400">1 · Develop</h2>
      <p className="mt-1 text-xs text-slate-500">Five independent lanes. Each commits locally; nothing is pushed until Deploy.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {lanes.map((lane) => {
          const state = laneState(lane.run)
          return (
            <Link key={lane.key} href={lane.href} className="rounded-md border border-slate-800 bg-slate-900 p-4 hover:border-slate-600">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-100">{lane.name}</span>
                <StatusDot tone={state.tone} label={state.label} />
              </div>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded bg-slate-800">
                <div className="h-full rounded bg-cyan-500" style={{ width: `${lane.percent}%` }} />
              </div>
              <p className="mt-2 text-xs text-slate-400">{lane.detail} · {lane.percent}%</p>
              {lane.run.message && <p className="mt-1 truncate text-xs text-slate-500" title={lane.run.message}>{lane.run.message}</p>}
            </Link>
          )
        })}
      </div>

      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-slate-400">2 · Verify</h2>
      <p className="mt-1 text-xs text-slate-500">Gates and checks that must pass before deploying.</p>

      <div className="mt-3 rounded-md border border-cyan-900 bg-cyan-950/15 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-cyan-100">Full Verification</h3>
            <p className="mt-1 text-xs text-slate-400">One click runs Readiness → Six Gates → Pre-deployment in sequence.</p>
          </div>
          <div className="flex items-center gap-3">
            {verify.status && verify.status !== 'idle' && (
              <span className="text-xs text-slate-400">
                {verifyRunning
                  ? `Running · ${verify.percent ?? 0}%`
                  : verify.overall === 'pass' ? '✓ All passed' : verify.overall === 'fail' ? '✗ Issues found' : verify.status}
              </span>
            )}
            <form action="/api/verify/run" method="post">
              <button disabled={verifyRunning} title={verifyRunning ? 'Verification is already running' : 'Run Readiness, Six Gates, and Pre-deployment in sequence'} className="min-h-10 rounded-md bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50">
                {verifyRunning ? 'Verifying…' : 'Run Full Verification'}
              </button>
            </form>
          </div>
        </div>
        {(verify.stages?.length ?? 0) > 0 && (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {verify.stages!.map((stage) => {
              const href = stage.key === 'ready' ? '/ready' : stage.key === 'gates' ? '/gates' : stage.key === 'predeploy' ? '/predeployment' : '/workflow'
              return (
                <Link key={stage.key} href={href} className="rounded border border-slate-800 bg-slate-950/40 p-2.5 hover:border-slate-600" title={`Open ${stage.label} details`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-200">{stage.label}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[11px] ${verifyStageTone(stage.status)}`}>{stage.status}</span>
                  </div>
                  {stage.message && <p className="mt-1 truncate text-[11px] text-slate-500" title={stage.message}>{stage.message}</p>}
                </Link>
              )
            })}
          </div>
        )}
        {verifyState.stale && <p className="mt-2 text-xs text-amber-300">⚠ Verification process looks stale (no recent heartbeat). You can start a new run.</p>}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Link href="/ready" className="rounded-md border border-slate-800 bg-slate-900 p-4 hover:border-slate-600">
          <div className="flex items-center justify-between"><span className="font-semibold text-slate-100">Ready</span><StatusDot tone={readyCritical > 0 ? 'red' : 'green'} label={readyCritical > 0 ? `${readyCritical} blockers` : 'Ready'} /></div>
          <p className="mt-2 text-xs text-slate-400">Launch readiness blockers</p>
        </Link>
        <Link href="/gates" className="rounded-md border border-slate-800 bg-slate-900 p-4 hover:border-slate-600"><span className="font-semibold text-slate-100">Six Gates</span><p className="mt-2 text-xs text-slate-400">Quality gates check</p></Link>
        <Link href="/predeployment" className="rounded-md border border-slate-800 bg-slate-900 p-4 hover:border-slate-600"><span className="font-semibold text-slate-100">Pre-deployment</span><p className="mt-2 text-xs text-slate-400">Pre-deploy verification</p></Link>
        <Link href="/post-deployment" className="rounded-md border border-slate-800 bg-slate-900 p-4 hover:border-slate-600">
          <div className="flex items-center justify-between"><span className="font-semibold text-slate-100">Post-deployment</span>{lastDeployCheck && <StatusDot tone={(lastDeployCheck.summary?.fail ?? 0) > 0 ? 'red' : 'green'} label={(lastDeployCheck.summary?.fail ?? 0) > 0 ? 'Issues' : 'Pass'} />}</div>
          <p className="mt-2 text-xs text-slate-400">Functionality checks</p>
        </Link>
      </div>

      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-slate-400">3 · Deploy</h2>
      <p className="mt-1 text-xs text-slate-500">The final step ships everything together. Push local commits to the VPS and run the production deploy.</p>

      <div className="mt-3">
        <DeployEverythingPanel />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Link href="/docmee-deployment" className="rounded-md border border-slate-800 bg-slate-900 p-4 hover:border-slate-600"><span className="font-semibold text-slate-100">Deployment Center</span><p className="mt-2 text-xs text-slate-400">Backend · Frontend · UI lanes</p></Link>
        <Link href="/deploy" className="rounded-md border border-violet-800 bg-violet-950/20 p-4 hover:border-violet-600"><span className="font-semibold text-violet-100">Deploy to VPS</span><p className="mt-2 text-xs text-violet-100/70">git push → build → migrate → PM2 → health</p></Link>
        <Link href="/docmee-update" className="rounded-md border border-slate-800 bg-slate-900 p-4 hover:border-slate-600"><span className="font-semibold text-slate-100">Docmee Update</span><p className="mt-2 text-xs text-slate-400">Update an existing deployment</p></Link>
      </div>

      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-slate-400">4 · Monitor</h2>
      <p className="mt-1 text-xs text-slate-500">Watch the running system and track cost.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Link href="/install-monitor" className="rounded-md border border-slate-800 bg-slate-900 p-4 hover:border-slate-600"><span className="font-semibold text-slate-100">Install Monitor</span><p className="mt-2 text-xs text-slate-400">Build heartbeat & install</p></Link>
        <Link href="/cost" className="rounded-md border border-slate-800 bg-slate-900 p-4 hover:border-slate-600"><span className="font-semibold text-slate-100">Development Cost</span><p className="mt-2 text-xs text-slate-400">Claude + Codex spend</p></Link>
        <Link href="/logs" className="rounded-md border border-slate-800 bg-slate-900 p-4 hover:border-slate-600"><span className="font-semibold text-slate-100">Logs</span><p className="mt-2 text-xs text-slate-400">Event log</p></Link>
        <Link href="/sentinel" className="rounded-md border border-slate-800 bg-slate-900 p-4 hover:border-slate-600"><span className="font-semibold text-slate-100">Sentinel</span><p className="mt-2 text-xs text-slate-400">Autonomous monitoring</p></Link>
      </div>
    </section>
  )
}
