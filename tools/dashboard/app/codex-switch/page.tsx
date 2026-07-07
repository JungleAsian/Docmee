import fs from 'node:fs'
import path from 'node:path'
import Link from 'next/link'
import { readJson } from '../lib/read-json'
import { isProcessAlive } from '../lib/run-live'

type PageProps = { searchParams?: { message?: string; error?: string } }
type FeatureStatus = 'complete' | 'partial' | 'missing'
type Feature = {
  id: number
  phase: string
  area: string
  feature: string
  status: FeatureStatus
  priority: 'critical' | 'high' | 'medium' | 'low'
  evidence: string
  nextStep: string
}
type BuildRun = { pid?: number; phase?: string; status?: string; message?: string; heartbeatAt?: string }
type CodexAccount = { status?: string; message?: string; updatedAt?: string }

const toolsRoot = path.resolve(process.cwd(), '..')
const coverageFile = path.join(toolsRoot, 'logs', 'rev1-feature-coverage.json')
const buildRunFile = path.join(toolsRoot, 'logs', 'build-run.json')
const codexAccountFile = path.join(toolsRoot, 'logs', 'codex-account.json')

function codexAuthStatus() {
  const home = path.join(process.env.USERPROFILE || process.env.HOME || '', '.codex')
  const authFile = path.join(home, 'auth.json')
  const globalState = path.join(home, '.codex-global-state.json')
  const localStatus = readJson<CodexAccount>(codexAccountFile, {})
  const authPresent = fs.existsSync(authFile)
  return {
    status: authPresent ? 'Signed in file present' : 'Signed out locally',
    detail: authPresent
      ? 'Codex auth is present on this machine. DevTools does not display tokens or account secrets.'
      : 'Codex auth is not present. Open Codex and sign in before starting work.',
    updatedAt: localStatus.updatedAt || (fs.existsSync(globalState) ? fs.statSync(globalState).mtime.toISOString() : ''),
    lastAction: localStatus.message
  }
}

function priorityRank(priority: Feature['priority']) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[priority]
}

function tone(status: string) {
  if (status.includes('Signed in') || status === 'running' || status === 'pass') return 'border-emerald-700 bg-emerald-950/30 text-emerald-200'
  if (status === 'missing' || status === 'critical' || status === 'fail') return 'border-red-700 bg-red-950/30 text-red-200'
  return 'border-amber-700 bg-amber-950/30 text-amber-200'
}

function buildPrompt(item?: Feature) {
  if (!item) return 'No feature item is available. Refresh Features Development first.'
  return [
    `Continue Docmee feature development for requirement ${item.id}.`,
    '',
    `Phase: ${item.phase}`,
    `Area: ${item.area}`,
    `Feature: ${item.feature}`,
    `Current status: ${item.status}`,
    `Priority: ${item.priority}`,
    '',
    `Evidence: ${item.evidence}`,
    '',
    `Next step: ${item.nextStep}`,
    '',
    'Rules:',
    '- Build locally first.',
    '- Do not deploy to VPS until local validation passes.',
    '- Update DevTools logs, Notion, and GitHub when the work is verified.',
    '- Do not expose secrets or edit .env files unless explicitly requested.'
  ].join('\n')
}

export default function CodexControlPage({ searchParams }: PageProps) {
  const features = readJson<Feature[]>(coverageFile, [])
  const run = readJson<BuildRun>(buildRunFile, { status: 'idle' })
  const account = codexAuthStatus()
  const live = isProcessAlive(run.pid) && ['starting', 'running', 'paused'].includes(run.status ?? '')
  const queue = features
    .filter((feature) => feature.status !== 'complete')
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.phase.localeCompare(b.phase) || a.id - b.id)
    .slice(0, 8)
  const prompt = buildPrompt(queue[0])

  return (
    <section className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Codex</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            A safe sequence for changing the Codex account while keeping Docmee feature work, prompts, and handoff context visible in DevTools.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action="/api/actions" method="post">
            <input type="hidden" name="action" value="codex-open" />
            <button className="min-h-11 rounded-md bg-cyan-600 px-3 py-2 text-sm font-medium text-white">Connect Codex</button>
          </form>
          <Link href="/rev1-coverage" className="min-h-11 rounded-md border border-slate-700 px-3 py-2 text-sm text-sky-300 hover:bg-slate-800">Feature Queue</Link>
        </div>
      </div>

      {searchParams?.message && <p className="mt-3 rounded-md border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-200">{searchParams.message}</p>}
      {searchParams?.error && <p className="mt-3 rounded-md border border-red-800 bg-red-950/30 p-3 text-sm text-red-200">{searchParams.error}</p>}

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <div className={`rounded-md border p-4 ${tone(account.status)}`}>
          <p className="text-xs opacity-80">Codex account</p>
          <p className="mt-2 text-lg font-semibold">{account.status}</p>
          <p className="mt-2 text-xs opacity-80">{account.updatedAt ? `Updated ${new Date(account.updatedAt).toLocaleString()}` : 'No timestamp yet'}</p>
        </div>
        <div className={`rounded-md border p-4 ${live ? tone('running') : 'border-slate-800 bg-slate-900 text-slate-200'}`}>
          <p className="text-xs text-slate-500">Development watcher</p>
          <p className="mt-2 text-lg font-semibold">{live ? run.status : 'not running'}</p>
          <p className="mt-2 text-xs text-slate-400">{run.phase ?? 'No active phase'}</p>
        </div>
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <p className="text-xs text-slate-500">Feature queue</p>
          <p className="mt-2 text-3xl font-semibold">{queue.length}</p>
          <p className="mt-2 text-xs text-slate-400">Top open items shown</p>
        </div>
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <p className="text-xs text-slate-500">Next item</p>
          <p className="mt-2 text-lg font-semibold">{queue[0] ? `Req ${queue[0].id}` : 'None'}</p>
          <p className="mt-2 text-xs text-slate-400">{queue[0]?.phase ?? 'No open feature loaded'}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_420px]">
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
          <h2 className="text-sm font-semibold">Codex Handoff Prompt</h2>
          <p className="mt-1 text-xs text-slate-400">Use this after switching accounts so Codex can continue the next feature.</p>
            </div>
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="codex-open" />
              <button className="rounded-md border border-cyan-700 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-950/40">Connect Codex</button>
            </form>
          </div>
          <textarea
            readOnly
            value={prompt}
            className="mt-4 h-[360px] w-full resize-none rounded-md border border-slate-700 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100"
          />
        </div>

        <div className="space-y-5">
          <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
            <h2 className="text-sm font-semibold">Switching Sequence</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">{account.detail}</p>
            {account.lastAction && <p className="mt-2 rounded border border-slate-800 bg-slate-950/50 p-2 text-xs text-slate-300">{account.lastAction}</p>}
            <div className="mt-4 grid gap-2">
              <form action="/api/actions" method="post">
                <input type="hidden" name="action" value="codex-open" />
                <button className="w-full rounded-md bg-cyan-600 px-3 py-2 text-sm font-medium text-white">1. Connect Codex</button>
              </form>
              <form action="/api/actions" method="post">
                <input type="hidden" name="action" value="codex-logout" />
                <button className="w-full rounded-md border border-red-800 px-3 py-3 text-sm text-red-200 hover:bg-red-950/40">2. Logout Codex on this machine</button>
              </form>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              Logout backs up the local Codex auth file first, then opens Codex so you can sign in again. It does not display account secrets.
            </p>
          </div>

          <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
            <h2 className="text-sm font-semibold">Next Work Queue</h2>
            <div className="mt-3 space-y-2">
              {queue.map((item) => (
                <div key={item.id} className="rounded border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-xs text-slate-500">Req {item.id} · {item.phase} · {item.priority}</p>
                  <p className="mt-1 text-sm font-medium text-slate-100">{item.feature}</p>
                  <p className="mt-2 text-xs text-slate-400">{item.nextStep}</p>
                </div>
              ))}
              {queue.length === 0 && <p className="text-sm text-emerald-300">No open feature item loaded.</p>}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
