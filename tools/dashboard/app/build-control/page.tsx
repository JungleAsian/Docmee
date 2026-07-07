import fs from 'node:fs'
import path from 'node:path'
import { BuildProgressGauge } from '../build-progress-gauge'
import { CompactSection, SimpleStatusCard } from '../compact-ui'
import { AutoRefresh } from '../auto-refresh'
import { LaneFlowStrip } from '../lane-flow-strip'
import { LaneItemGauge } from '../lane-item-gauge'
import { runLiveness, isProcessAlive } from '../lib/run-live'
import { readJson } from '../lib/read-json'

const toolsRoot = path.resolve(process.cwd(), '..')
const phasesFile = path.join(toolsRoot, 'logs', 'phases.json')
const buildControlFile = path.join(toolsRoot, 'logs', 'build-control.json')
const readyFile = path.join(toolsRoot, 'logs', 'ready.json')
const startReadinessFile = path.join(toolsRoot, 'logs', 'start-readiness.json')
const buildRunFile = path.join(toolsRoot, 'logs', 'build-run.json')
const promptsDir = path.join(toolsRoot, 'prompts')
const buildControlUrl = 'https://app.notion.com/p/38241c470daf8146a1f6d9b28cc498f3'

const definitions = [
  ['P01', 'Repository Foundation', 'claude-code', '1'],
  ['P02', 'Database', 'claude-code', '1'],
  ['P03', 'Core Infrastructure + AI', 'claude-code', '1'],
  ['P04', 'WhatsApp Channel', 'claude-code', '1'],
  ['P05', 'Clinic Bot', 'claude-code', '1'],
  ['P06', 'Appointment Scheduler', 'claude-code', '1'],
  ['P07', 'Secretary Alerts', 'claude-code', '1'],
  ['P08', 'Auth & API', 'claude-code', '1'],
  ['P09', 'Clinic Inbox + Admin Studio', 'claude-code', '1'],
  ['P10', 'License Manager', 'claude-code', '1'],
  ['P11', 'Admin Studio Admin Panel', 'claude-code', '1'],
  ['P12', 'Voice Transcription Service', 'claude-code', '1'],
  ['P13', 'Installer (DeployKit)', 'claude-code', '2'],
  ['P14', 'Facebook Messenger', 'claude-code', '2'],
  ['P15', 'Instagram Direct', 'claude-code', '2'],
  ['P16', 'Phase 2 Features', 'claude-code', '2'],
  ['P17', 'Testing & CI/CD', 'claude-code', '2'],
  ['P18', 'Phase 3 Features', 'claude-code', '3'],
  ['P19', 'Compliance & Launch', 'claude-code', '1']
] as const

type PageProps = { searchParams?: { message?: string; error?: string } }
type Phase = { id: string; status: 'not-started' | 'in-progress' | 'done'; completedAt?: string; commitHash?: string }
type Control = { phaseId: string; status: string; updatedAt: string; notes?: string; commitHash?: string }
type ReadyCheck = { name: string; status: 'pass' | 'warning' | 'critical'; message: string; fix?: string }
type ReadyResult = { ready?: boolean; summary?: { critical?: number; warning?: number; pass?: number }; createdAt?: string; categories?: Array<{ id: string; label: string; checks: ReadyCheck[] }> }
type StartReadiness = { ready?: boolean; phase?: string; createdAt?: string; steps?: Array<{ name: string; status: 'pass' | 'fail'; message: string }> }
type BuildRun = { pid?: number; phase?: string; status?: string; startedAt?: string; heartbeatAt?: string; resumeAt?: string; message?: string }

function phaseState() {
  const fallback: Phase[] = definitions.map(([id]) => ({ id, status: 'not-started' as const }))
  const current = readJson<Phase[]>(phasesFile, fallback)
  const byId = new Map(current.map((phase) => [phase.id, phase]))
  return fallback.map((phase) => byId.get(phase.id) ?? phase)
}

function controlState() {
  const fallback: Control[] = definitions.map(([id]) => ({ phaseId: id, status: 'pending', updatedAt: new Date(0).toISOString() }))
  const current = readJson<Control[]>(buildControlFile, fallback)
  const byId = new Map(current.map((record) => [record.phaseId, record]))
  return fallback.map((record) => byId.get(record.phaseId) ?? record)
}

function readyState() {
  return readJson<ReadyResult>(readyFile, { ready: false, summary: { critical: 1, warning: 0, pass: 0 } })
}

function startReadinessState() {
  return readJson<StartReadiness>(startReadinessFile, { ready: false, steps: [] })
}

function buildRunState() {
  const run = readJson<BuildRun>(buildRunFile, { status: 'idle' })
  const { live, stale } = runLiveness(run, isProcessAlive(run.pid))
  return { ...run, live, stale }
}

function promptInfo(id: string) {
  const promptFile = path.join(promptsDir, `${id}-CODEX-PROMPT.md`)
  const contextFile = path.join(promptsDir, `${id}-CONTEXT.md`)
  const promptChars = fs.existsSync(promptFile) ? fs.readFileSync(promptFile, 'utf8').length : 0
  const contextChars = fs.existsSync(contextFile) ? fs.readFileSync(contextFile, 'utf8').length : 0
  return { promptChars, contextChars, hasContext: contextChars > 0 }
}

function statusClass(status: string) {
  if (status === 'complete' || status === 'done') return 'bg-emerald-900 text-emerald-100'
  if (status === 'failed') return 'bg-red-900 text-red-100'
  if (status === 'paused') return 'bg-amber-900 text-amber-100'
  if (status === 'output-copied' || status === 'gates-running' || status === 'pushing') return 'bg-cyan-900 text-cyan-100'
  if (status === 'awaiting-output' || status === 'in-progress') return 'bg-amber-900 text-amber-100'
  return 'bg-slate-800 text-slate-300'
}

function phaseGauge(status?: string): { percent: number; tone: 'emerald' | 'amber' | 'slate' } {
  if (status === 'done') return { percent: 100, tone: 'emerald' }
  if (status === 'in-progress') return { percent: 50, tone: 'amber' }
  return { percent: 6, tone: 'slate' }
}

function githubCommitUrl(hash?: string) {
  return hash ? `https://github.com/JungleAsian/Creascent-Development/commit/${hash}` : ''
}

function builderLabel(builder: string) {
  return builder === 'claude-code' ? 'Claude Code' : 'Codex Pro'
}

export default function BuildControlPage({ searchParams }: PageProps) {
  const phases = phaseState()
  const controls = controlState()
  const phaseById = new Map(phases.map((phase) => [phase.id, phase]))
  const controlById = new Map(controls.map((record) => [record.phaseId, record]))
  const currentDefinition = definitions.find(([id]) => phaseById.get(id)?.status !== 'done') ?? definitions[definitions.length - 1]
  const [currentId, currentName, currentBuilder] = currentDefinition
  const currentControl = controlById.get(currentId) ?? { phaseId: currentId, status: 'pending', updatedAt: new Date(0).toISOString() }
  const done = phases.filter((phase) => phase.status === 'done').length
  const allComplete = done === definitions.length
  const currentPrompt = promptInfo(currentId)
  const ready = readyState()
  const readyCritical = ready.summary?.critical ?? 1
  const startReadiness = startReadinessState()
  const startCheckCurrent = startReadiness.phase === currentId
  const startCheckPassed = Boolean(startReadiness.ready && startCheckCurrent)
  const buildRun = buildRunState()
  const startLocked = readyCritical > 0 || !startCheckPassed || buildRun.live
  const claudeCheck = ready.categories?.flatMap((category) => category.checks).find((check) => check.name === 'Claude Code build smoke test')
  const claudeAccount = ready.categories?.flatMap((category) => category.checks).find((check) => check.name === 'Claude Code account')
  const claudeInstalled = ready.categories?.flatMap((category) => category.checks).find((check) => check.name === 'Claude Code installed')
  const notionCheck = ready.categories?.flatMap((category) => category.checks).find((check) => check.name === 'Notion reachable')
  const githubCheck = ready.categories?.flatMap((category) => category.checks).find((check) => check.name === 'GitHub push access')

  return (
    <section className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Build Control{allComplete && <span className="ml-2 rounded bg-emerald-900 px-2 py-0.5 align-middle text-xs font-medium text-emerald-100">complete</span>}</h1>
          <p className="mt-2 text-sm text-slate-400">{allComplete ? 'The 19-phase build is finished — this page is now a historical record.' : 'Full automation for all 19 phases through Claude Code.'}</p>
        </div>
        <a href={buildControlUrl} target="_blank" rel="noreferrer" className="rounded-md border border-slate-700 px-3 py-2 text-sm text-sky-300 hover:bg-slate-800">Open Notion spec</a>
      </div>

      <AutoRefresh seconds={15} />
      <div className="mt-3">
        <LaneFlowStrip
          label="Workflow"
          stages={[
            { label: 'Setup ready', tone: 'slate' },
            { label: 'Start check', tone: 'cyan' },
            { label: 'Build · Claude', tone: 'amber' },
            { label: 'Gates', tone: 'sky' },
            { label: 'Commit & push', tone: 'violet' },
            { label: 'Launch', tone: 'emerald' }
          ]}
        />
      </div>
      {searchParams?.message && <p className="mt-3 text-sm text-emerald-300">{searchParams.message}</p>}
      {searchParams?.error && <p className="mt-3 text-sm text-red-300">{searchParams.error}</p>}
      {!allComplete && buildRun.stale && <p className="mt-3 rounded-md border border-amber-800 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">⚠ The build watcher process is alive but has not sent a heartbeat recently — it may be hung. You can start a new run.</p>}

      {allComplete && (
        <div className="mt-4 rounded-md border border-emerald-800 bg-emerald-950/30 p-4">
          <h2 className="text-sm font-semibold text-emerald-100">Build complete — 19/19 phases</h2>
          <p className="mt-1 text-sm text-slate-300">The phased build pipeline is finished, so there is nothing to start here. Day-to-day work now runs through <a href="/backlog" className="text-cyan-300 underline">Backlog</a> / <a href="/overview" className="text-cyan-300 underline">Mission Control</a>; any future phased builds are driven from <a href="/rev1-coverage" className="text-cyan-300 underline">Features Development</a>. The full phase record and local-launch / deploy actions remain below.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href="/rev1-coverage" className="min-h-10 rounded-md border border-slate-700 px-3 py-2 text-sm text-sky-300 hover:bg-slate-800">Features Development →</a>
            <a href="/deploy" className="min-h-10 rounded-md border border-slate-700 px-3 py-2 text-sm text-sky-300 hover:bg-slate-800">Deploy →</a>
            <a href="/overview" className="min-h-10 rounded-md border border-slate-700 px-3 py-2 text-sm text-sky-300 hover:bg-slate-800">Mission Control →</a>
          </div>
        </div>
      )}

      {!allComplete && (
      <div className={startLocked ? 'mt-4 rounded-md border border-amber-800 bg-amber-950/30 p-4' : 'mt-4 rounded-md border border-emerald-800 bg-emerald-950/30 p-4'}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className={startLocked ? 'text-sm font-semibold text-amber-100' : 'text-sm font-semibold text-emerald-100'}>{startLocked ? 'Start Readiness needs a check' : 'Start Readiness passed'}</h2>
            <p className="mt-1 text-sm text-slate-300">
              {readyCritical > 0
                ? `${readyCritical} critical setup issue${readyCritical === 1 ? '' : 's'} must be fixed first.`
                : startCheckPassed
                  ? `Safe Start Check passed for ${currentId}.`
                  : `Run Start Check for ${currentId} before starting automation.`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="start-readiness" />
              <input type="hidden" name="phase" value={currentId} />
              <button className="min-h-11 rounded-md bg-slate-100 px-3 py-2 text-sm font-medium text-slate-950">Run Start Check</button>
            </form>
            <a href="/ready" className="min-h-11 rounded-md border border-slate-700 px-3 py-2 text-sm text-sky-300 hover:bg-slate-800">Open Ready Details</a>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <SimpleStatusCard label="Claude Pro" value={claudeCheck?.status === 'pass' && claudeAccount?.status === 'pass' ? 'Connected' : 'Needs attention'} detail={claudeAccount?.message ?? claudeInstalled?.message ?? 'Run Ready Check'} tone={claudeCheck?.status === 'pass' && claudeAccount?.status === 'pass' ? 'emerald' : 'red'} />
          <SimpleStatusCard label="Notion" value={notionCheck?.status === 'pass' ? 'Connected' : 'Needs attention'} detail={notionCheck?.message ?? 'Run Ready Check'} tone={notionCheck?.status === 'pass' ? 'emerald' : 'red'} />
          <SimpleStatusCard label="GitHub" value={githubCheck?.status === 'pass' ? 'Reachable' : 'Needs attention'} detail={githubCheck?.message ?? 'Run Ready Check'} tone={githubCheck?.status === 'pass' ? 'emerald' : 'red'} />
          <SimpleStatusCard label="Safe Build Test" value={startCheckPassed ? 'Passed' : 'Not checked'} detail={startReadiness.createdAt && startCheckCurrent ? new Date(startReadiness.createdAt).toLocaleString() : `Waiting for ${currentId}`} tone={startCheckPassed ? 'emerald' : 'amber'} />
        </div>

        <div className="mt-4 rounded border border-slate-800 bg-slate-950/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <BuildProgressGauge size="md" />
            <div className="text-right text-xs text-slate-500">
              <div>{buildRun.pid ? `PID ${buildRun.pid}` : 'No PID'}</div>
              <div>{buildRun.heartbeatAt ? `Heartbeat ${new Date(buildRun.heartbeatAt).toLocaleTimeString()}` : 'No heartbeat yet'}</div>
              <div>{buildRun.resumeAt ? `Resume ${new Date(buildRun.resumeAt).toLocaleTimeString()}` : ''}</div>
            </div>
          </div>
          {buildRun.live && (
            <form action="/api/actions" method="post" className="mt-3">
              <input type="hidden" name="action" value="phase-build-stop" />
              <button className="min-h-11 rounded-md border border-red-800 px-3 py-2 text-sm text-red-200 hover:bg-red-950/50">Stop Build</button>
            </form>
          )}
        </div>

        {(startReadiness.steps ?? []).length > 0 && startCheckCurrent && (
          <div className="mt-4">
          <CompactSection title="Start Check Details" subtitle="Technical checks from the latest safe-start validation.">
          <div className="grid gap-2">
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
          </CompactSection>
          </div>
        )}
      </div>
      )}

      {!allComplete && (
      <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm text-slate-400">Current phase</div>
              <h2 className="mt-1 text-xl font-semibold">{currentId} — {currentName}</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className={currentBuilder === 'claude-code' ? 'rounded bg-purple-900 px-2 py-1 text-xs text-purple-100' : 'rounded bg-blue-900 px-2 py-1 text-xs text-blue-100'}>{builderLabel(currentBuilder)}</span>
                <span className={`rounded px-2 py-1 text-xs ${statusClass(currentControl.status)}`}>{currentControl.status}</span>
              </div>
            </div>
            <div className="text-right text-sm text-slate-400">{done}/19 complete</div>
          </div>

          <div className="mt-4 h-3 rounded bg-slate-800"><div className="h-3 rounded bg-cyan-500" style={{ width: `${Math.round((done / 19) * 100)}%` }} /></div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded border border-slate-800 p-3">
              <div className="text-xs text-slate-500">Prompt</div>
              <div className={currentPrompt.promptChars > 0 ? 'mt-1 text-sm text-emerald-300' : 'mt-1 text-sm text-amber-300'}>{currentPrompt.promptChars > 0 ? `${currentPrompt.promptChars} chars` : 'not synced'}</div>
            </div>
            <div className="rounded border border-slate-800 p-3">
              <div className="text-xs text-slate-500">Context</div>
              <div className={currentPrompt.hasContext ? 'mt-1 text-sm text-emerald-300' : 'mt-1 text-sm text-amber-300'}>{currentPrompt.hasContext ? `${currentPrompt.contextChars} chars` : 'not prepared'}</div>
            </div>
            <div className="rounded border border-slate-800 p-3">
              <div className="text-xs text-slate-500">Updated</div>
              <div className="mt-1 text-sm text-slate-300">{new Date(currentControl.updatedAt).getTime() ? new Date(currentControl.updatedAt).toLocaleString() : 'not yet'}</div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="phase-build-watch" />
              <input type="hidden" name="from" value={currentId} />
              <button disabled={startLocked} title={readyCritical > 0 ? `${readyCritical} critical setup issue(s) must be fixed first` : !startCheckPassed ? `Run the start check for ${currentId} first` : buildRun.live ? 'A build is already running' : `Start the automated build from ${currentId}`} className="min-h-11 rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">Start Automated Build</button>
            </form>
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="phase-context" />
              <input type="hidden" name="phase" value={currentId} />
              <button className="min-h-11 rounded-md border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800">Prepare Context</button>
            </form>
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="gates-run" />
              <button className="min-h-11 rounded-md border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800">Re-run Gates</button>
            </form>
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="phase-build-control-init" />
              <button className="min-h-11 rounded-md border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800">Set Up Build Control</button>
            </form>
          </div>

          {currentControl.notes && <p className="mt-4 text-sm text-slate-400">{currentControl.notes}</p>}
        </div>

        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <details className="group">
            <summary className="cursor-pointer text-sm font-semibold text-slate-200 hover:text-white">How to continue <span className="ml-1 text-xs font-normal text-slate-500">(show guide)</span></summary>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <p>1. Click Set Up Build Control once if the Notion database is not ready.</p>
              <p>2. Click Start Automated Build.</p>
              <p>3. DevTools sends each prepared context file to Claude Code automatically.</p>
              <p>4. After each phase, DevTools runs gates, commits, pushes, notifies Discord, and advances.</p>
              <p>5. After all phases complete, launch locally for checking, then request VPS deployment.</p>
            </div>
          </details>
          <div className="mt-5 rounded border border-slate-800 p-3">
            <div className="text-xs text-slate-500">Polling check</div>
            <form action="/api/actions" method="post" className="mt-3 flex flex-wrap gap-2">
              <input type="hidden" name="action" value="phase-poll" />
              <input type="hidden" name="phase" value={currentId} />
              <input type="hidden" name="status" value="in-progress" />
              <button className="rounded-md border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800">Check Build Running</button>
            </form>
          </div>
        </div>
      </div>
      )}

      <div className="mt-6">
      <CompactSection title="Build Progress" subtitle="Full 19-phase progress list and final local/deploy actions." badge={<span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">{done}/19 complete</span>}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Build Progress</h2>
          <BuildProgressGauge size="md" />
        </div>
        <div className="mt-4 grid gap-3">
          {definitions.map(([id, name, builder, business]) => {
            const phase = phaseById.get(id)
            const control = controlById.get(id)
            const hash = phase?.commitHash ?? control?.commitHash
            const gauge = phaseGauge(phase?.status)
            return (
              <div key={id} className="flex flex-wrap items-center gap-3 rounded border border-slate-800 px-3 py-2">
                <LaneItemGauge percent={gauge.percent} tone={gauge.tone} title={phase?.status ?? 'not-started'} />
                <strong className="w-12">{id}</strong>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-200">{name}</div>
                  <div className="text-xs text-slate-500">Business phase {business} · {builderLabel(builder)}</div>
                </div>
                <span className={`rounded px-2 py-1 text-xs ${statusClass(control?.status ?? 'pending')}`}>{control?.status ?? 'pending'}</span>
                {hash &&<a href={githubCommitUrl(hash)} target="_blank" rel="noreferrer" className="rounded border border-slate-700 px-2 py-1 text-xs text-sky-300 hover:bg-slate-800">commit {hash}</a>}
              </div>
            )
          })}
          <div className={done === 19 ? 'rounded border border-emerald-800 bg-emerald-950/30 px-3 py-3' : 'rounded border border-slate-800 bg-slate-950/40 px-3 py-3'}>
            <div className="flex flex-wrap items-center gap-3">
              <BuildProgressGauge size="sm" showLabel={false} />
              <strong className="w-16">Check</strong>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-slate-200">Launch application for checking</div>
                <div className="text-xs text-slate-500">
                  {done === 19
                    ? 'Starts the local app, opens the Inbox UI, and uses the demo login.'
                    : 'Available after all 19 build phases are complete.'}
                </div>
              </div>
              <form action="/api/actions" method="post">
                <input type="hidden" name="action" value="app-launch" />
                <button
                  disabled={done !== 19}
                  className="min-h-11 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                >
                  Launch App Locally
                </button>
              </form>
            </div>
            {done === 19 && (
              <div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-3">
                <div className="rounded border border-slate-800 bg-slate-950/40 p-2">App: http://127.0.0.1:3000</div>
                <div className="rounded border border-slate-800 bg-slate-950/40 p-2">Email: admin@demo-a.test</div>
                <div className="rounded border border-slate-800 bg-slate-950/40 p-2">Password: demo1234</div>
              </div>
            )}
          </div>
          <div className={done === 19 ? 'rounded border border-sky-800 bg-sky-950/30 px-3 py-3' : 'rounded border border-slate-800 bg-slate-950/40 px-3 py-3'}>
            <div className="flex flex-wrap items-center gap-3">
              <BuildProgressGauge size="sm" showLabel={false} />
              <strong className="w-16">Deploy</strong>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-slate-200">Open deployment guide</div>
                <div className="text-xs text-slate-500">
                  {done === 19
                    ? 'Continue in the guided Deploy page for checks, VPS verification, and final deployment request.'
                    : 'Available after all 19 build phases are complete.'}
                </div>
              </div>
              {done === 19 ? (
                <a href="/deploy" className="min-h-11 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500">
                  Continue to Deploy →
                </a>
              ) : (
                <button disabled className="min-h-11 rounded-md bg-slate-700 px-4 py-2 text-sm font-medium text-slate-400">
                  Open Guide
                </button>
              )}
            </div>
            {done === 19 && (
              <div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-3">
                <div className="rounded border border-slate-800 bg-slate-950/40 p-2">Target: VPS/domain from Settings</div>
                <div className="rounded border border-slate-800 bg-slate-950/40 p-2">Type: production deployment request</div>
                <a href="/deploy" className="rounded border border-slate-800 bg-slate-950/40 p-2 text-sky-300 hover:bg-slate-900">Continue to Deploy →</a>
              </div>
            )}
          </div>
        </div>
      </CompactSection>
      </div>
    </section>
  )
}
