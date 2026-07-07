import path from 'node:path'
import Link from 'next/link'
import { readJson } from '../lib/read-json'
import { isProcessAlive } from '../lib/run-live'

const toolsRoot = path.resolve(process.cwd(), '..')
const buildRunFile = path.join(toolsRoot, 'logs', 'build-run.json')
const readyFile = path.join(toolsRoot, 'logs', 'ready.json')
const phasesFile = path.join(toolsRoot, 'logs', 'phases.json')
const guardFile = path.join(toolsRoot, 'logs', 'claude-usage-guard.json')

type PageProps = { searchParams?: { message?: string; error?: string } }
type BuildRun = { pid?: number; phase?: string; status?: string; resumeAt?: string; message?: string; heartbeatAt?: string }
type ReadyCheck = { name: string; status: string; message: string; fix?: string }
type Ready = { ready?: boolean; createdAt?: string; categories?: Array<{ checks: ReadyCheck[] }> }
type Phase = { id: string; status: string }
type Guard = { thresholdPercent?: number; learnedSessionTokenLimit?: number; resetAt?: string; notes?: string; updatedAt?: string }

function allChecks(ready: Ready) {
  return ready.categories?.flatMap((category) => category.checks) ?? []
}

function currentPhase(phases: Phase[], run: BuildRun) {
  return run.phase || phases.find((phase) => phase.status !== 'done')?.id || 'P01'
}

function checkByName(ready: Ready, name: string) {
  return allChecks(ready).find((check) => check.name === name)
}

function tone(status?: string) {
  if (status === 'pass' || status === 'verified' || status === 'stopped') return 'border-emerald-700 bg-emerald-950/30 text-emerald-200'
  if (status === 'critical' || status === 'fail' || status === 'missing') return 'border-red-700 bg-red-950/30 text-red-200'
  if (status === 'running' || status === 'starting' || status === 'paused') return 'border-amber-700 bg-amber-950/30 text-amber-200'
  return 'border-slate-800 bg-slate-900 text-slate-200'
}

function buildHandoffPrompt(phase: string, account?: ReadyCheck, guard?: Guard) {
  return [
    `Resume Docmee development with Claude Code from ${phase}.`,
    '',
    'Current DevTools state:',
    `- Claude account check: ${account?.status ?? 'not checked'}`,
    `- Claude account message: ${account?.message ?? 'Run Ready Check after switching accounts.'}`,
    `- Usage guard threshold: ${guard?.thresholdPercent ?? 95}%`,
    `- Learned session limit: ${guard?.learnedSessionTokenLimit ? guard.learnedSessionTokenLimit.toLocaleString() : 'not learned yet'}`,
    '',
    'Rules:',
    '- Continue only after Ready Check passes.',
    '- Resume from the phase shown in DevTools.',
    '- Keep completed phases completed.',
    '- Pause before the usage guard reaches the limit.',
    '- Build locally first, then verify before VPS deployment.',
    '- Do not expose secrets or edit .env files unless explicitly requested.'
  ].join('\n')
}

export default function ClaudeSwitchPage({ searchParams }: PageProps) {
  const run = readJson<BuildRun>(buildRunFile, { status: 'idle' })
  const ready = readJson<Ready>(readyFile, { ready: false, categories: [] })
  const phases = readJson<Phase[]>(phasesFile, [])
  const guard = readJson<Guard>(guardFile, { thresholdPercent: 95 })
  const live = isProcessAlive(run.pid) && ['starting', 'running', 'paused'].includes(run.status ?? '')
  const phase = currentPhase(phases, run)
  const account = checkByName(ready, 'Claude Code account')
  const installed = checkByName(ready, 'Claude Code installed')
  const smoke = checkByName(ready, 'Claude Code build smoke test')
  const readyPassed = account?.status === 'pass' && smoke?.status === 'pass'
  const handoffPrompt = buildHandoffPrompt(phase, account, guard)
  const completed = phases.filter((item) => item.status === 'done').length

  const switchSteps = [
    {
      title: '1. Pause automation safely',
      body: live ? 'Stop the active watcher before changing Claude accounts.' : 'No active watcher is running.',
      status: live ? 'Needs action' : 'Safe'
    },
    {
      title: '2. Change Claude account',
      body: 'Open Claude Code outside DevTools, sign out if needed, then sign in with the correct Claude plan.',
      status: 'Manual'
    },
    {
      title: '3. Reset usage guard',
      body: 'Clear the learned limit so DevTools can learn the new account limit.',
      status: guard.updatedAt ? 'Recorded' : 'Ready'
    },
    {
      title: '4. Verify Claude',
      body: readyPassed ? 'Ready Check confirms Claude Code can run.' : 'Run Ready Check after the account change.',
      status: readyPassed ? 'Verified' : 'Waiting'
    },
    {
      title: `5. Resume from ${phase}`,
      body: 'Continue development from the current phase after verification passes.',
      status: readyPassed && !live ? 'Ready' : 'Locked'
    }
  ]

  return (
    <section className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Claude</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            A safe sequence for changing the Claude Code account while keeping Docmee build progress, usage guard, and resume phase visible in DevTools.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action="/api/actions" method="post">
            <input type="hidden" name="action" value="claude-switch-finalize" />
            <button className="min-h-11 rounded-md bg-cyan-600 px-3 py-2 text-sm font-medium text-white">Connect to Claude</button>
          </form>
          <Link href="/build-control" className="min-h-11 rounded-md border border-slate-700 px-3 py-2 text-sm text-sky-300 hover:bg-slate-800">Build Control</Link>
        </div>
      </div>

      {searchParams?.message && <p className="mt-3 rounded-md border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-200">{searchParams.message}</p>}
      {searchParams?.error && <p className="mt-3 rounded-md border border-red-800 bg-red-950/30 p-3 text-sm text-red-200">{searchParams.error}</p>}

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <div className={`rounded-md border p-4 ${tone(account?.status)}`}>
          <p className="text-xs opacity-80">Claude account</p>
          <p className="mt-2 text-lg font-semibold">{account?.status === 'pass' ? 'Verified' : 'Needs check'}</p>
          <p className="mt-2 text-xs opacity-80">{account?.message ?? installed?.message ?? 'Run Ready Check after switching.'}</p>
        </div>
        <div className={`rounded-md border p-4 ${tone(live ? run.status : 'stopped')}`}>
          <p className="text-xs opacity-80">Development watcher</p>
          <p className="mt-2 text-lg font-semibold">{live ? run.status ?? 'running' : 'not running'}</p>
          <p className="mt-2 text-xs opacity-80">{run.message ?? 'No active build process.'}</p>
        </div>
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <p className="text-xs text-slate-500">Resume phase</p>
          <p className="mt-2 text-3xl font-semibold">{phase}</p>
          <p className="mt-2 text-xs text-slate-400">{completed}/19 phases complete</p>
        </div>
        <div className={`rounded-md border p-4 ${guard.updatedAt ? 'border-emerald-700 bg-emerald-950/30 text-emerald-200' : 'border-amber-700 bg-amber-950/30 text-amber-200'}`}>
          <p className="text-xs opacity-80">Usage guard</p>
          <p className="mt-2 text-lg font-semibold">{guard.thresholdPercent ?? 95}% pause</p>
          <p className="mt-2 text-xs opacity-80">{guard.learnedSessionTokenLimit ? `${guard.learnedSessionTokenLimit.toLocaleString()} learned limit` : 'Limit not learned yet'}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_420px]">
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Claude Resume Prompt</h2>
              <p className="mt-1 text-xs text-slate-400">Use this when Claude Code needs context after switching accounts.</p>
            </div>
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="ready-run" />
              <button className="rounded-md border border-cyan-700 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-950/40">Run Ready Check</button>
            </form>
          </div>
          <textarea
            readOnly
            value={handoffPrompt}
            className="mt-4 h-[360px] w-full resize-none rounded-md border border-slate-700 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100"
          />
        </div>

        <div className="space-y-5">
          <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
            <h2 className="text-sm font-semibold">Switching Sequence</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              This sequence prevents account changes from leaving the build watcher in an unknown state.
            </p>
            <div className="mt-4 space-y-2">
              {switchSteps.map((step) => (
                <div key={step.title} className="rounded border border-slate-800 bg-slate-950/40 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-slate-100">{step.title}</p>
                    <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">{step.status}</span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-400">{step.body}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-2">
              <form action="/api/actions" method="post">
                <input type="hidden" name="action" value="phase-build-stop" />
                <button disabled={!live} className="w-full rounded-md border border-red-800 px-3 py-3 text-sm text-red-200 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500">Stop Build Watcher</button>
              </form>
              <form action="/api/actions" method="post">
                <input type="hidden" name="action" value="claude-switch-reset-guard" />
                <button className="w-full rounded-md border border-slate-700 px-3 py-3 text-sm text-slate-100 hover:bg-slate-800">Reset Usage Guard</button>
              </form>
              <form action="/api/actions" method="post">
                <input type="hidden" name="action" value="claude-switch-finalize" />
                <button className="w-full rounded-md bg-cyan-600 px-3 py-3 text-sm font-medium text-white">Verify New Claude Account</button>
              </form>
            </div>
          </div>

          <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
            <h2 className="text-sm font-semibold">Resume Development</h2>
            <p className="mt-2 text-sm text-slate-400">Completed phases stay completed. Resume only after Claude verifies successfully.</p>
            <div className="mt-4 grid gap-2">
              <form action="/api/actions" method="post">
                <input type="hidden" name="action" value="phase-build-watch" />
                <input type="hidden" name="from" value={phase} />
                <button disabled={live || !readyPassed} className="w-full rounded-md bg-cyan-600 px-3 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">Resume from {phase}</button>
              </form>
              <Link href="/phases" className="rounded-md border border-slate-700 px-3 py-3 text-center text-sm text-sky-300 hover:bg-slate-800">Review Phase Progress</Link>
            </div>
            {guard.notes && <p className="mt-3 rounded border border-slate-800 bg-slate-950/50 p-2 text-xs text-slate-400">{guard.notes}</p>}
          </div>
        </div>
      </div>
    </section>
  )
}
