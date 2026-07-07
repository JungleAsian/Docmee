import fs from 'node:fs'
import path from 'node:path'
import { BacklogRowControls } from './backlog-row-controls'
import { BacklogResolvePanel } from './backlog-resolve-panel'
import { BacklogReviewPanel } from './backlog-review-panel'
import { resolveAutoAi } from '../lib/auto-ai'
import { BacklogItemGauge } from './backlog-item-gauge'
import { BacklogFlowStrip } from '../backlog-flow-strip'
import { ElapsedTimer } from '../elapsed-timer'
import { BuildProgressGauge } from '../build-progress-gauge'
import { maybeAutoSyncBacklog, lastBacklogSyncAt } from '../lib/backlog-autosync'
import { AutoRefresh } from '../auto-refresh'
import { isHeartbeatFresh } from '../lib/run-live'

const toolsRoot = path.resolve(process.cwd(), '..')
const backlogFile = path.join(toolsRoot, 'logs', 'backlog.json')
const backlogRunFile = path.join(toolsRoot, 'logs', 'backlog-run.json')

type BacklogRun = { status?: string; message?: string; autoResolve?: boolean; verifyAll?: boolean; total?: number; processed?: number; resolved?: number; queued?: number; failed?: number; pid?: number; currentId?: number; heartbeatAt?: string; startedAt?: string }

function backlogRun(): BacklogRun {
  if (!fs.existsSync(backlogRunFile)) return {}
  try {
    return JSON.parse(fs.readFileSync(backlogRunFile, 'utf8')) as BacklogRun
  } catch {
    return {}
  }
}

function pidAlive(pid?: number) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

type Task = {
  id: number
  phase: string
  priority: string
  title: string
  status: string
  lane?: string
  auto?: string
  source?: string
  flag?: string
  assignee?: string
  plan?: string
  confidence?: number
  commit?: string
  pr?: string
  verifyConfidence?: number
  verifyReason?: string
  result?: string
  resultProvider?: string
}

function tasks() {
  if (!fs.existsSync(backlogFile)) return []
  return JSON.parse(fs.readFileSync(backlogFile, 'utf8')) as Task[]
}

type PageProps = {
  searchParams?: { message?: string; error?: string; status?: string; priority?: string; lane?: string }
}

function countBy(rows: Task[], key: keyof Pick<Task, 'status' | 'priority' | 'phase'>) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const value = row[key] || 'none'
    acc[value] = (acc[value] ?? 0) + 1
    return acc
  }, {})
}

function statusTone(status: string) {
  if (status === 'done') return 'bg-emerald-900 text-emerald-100'
  if (status === 'blocked') return 'bg-red-900 text-red-100'
  if (status === 'in-progress') return 'bg-amber-900 text-amber-100'
  if (status === 'plan-review') return 'bg-cyan-900 text-cyan-100'
  if (status === 'review') return 'bg-sky-900 text-sky-100'
  return 'bg-slate-800 text-slate-300'
}

export default function BacklogPage({ searchParams }: PageProps) {
  // Auto-collects TODO/FIXME from code; staleness guard flags possibly-shipped items.
  maybeAutoSyncBacklog()
  const syncMs = lastBacklogSyncAt()
  const syncAgo = syncMs ? (() => { const m = Math.round((Date.now() - syncMs) / 60000); return m <= 0 ? 'just now' : m === 1 ? '1 min ago' : `${m} min ago` })() : 'pending'
  const rows = tasks()
  const fStatus = searchParams?.status
  const fPriority = searchParams?.priority
  const fLane = searchParams?.lane
  const filtered = rows.filter((row) =>
    (!fStatus || row.status === fStatus) &&
    (!fPriority || row.priority === fPriority) &&
    (!fLane || (row.lane ?? 'none') === fLane)
  )
  const hasFilter = Boolean(fStatus || fPriority || fLane)
  const weight: Record<string, number> = { critical: 0, high: 1, medium: 2, infrastructure: 3, low: 4 }
  const openRows = rows.filter((row) => row.status !== 'done')
  const doneRows = rows.filter((row) => row.status === 'done')
  const priorityCounts = countBy(rows, 'priority')
  const criticalHigh = (priorityCounts.critical ?? 0) + (priorityCounts.high ?? 0)
  const total = rows.length
  const donePercent = total ? Math.round((doneRows.length / total) * 100) : 0
  const inFlight = rows.some((row) => row.status === 'in-progress' || row.status === 'plan-review')
  const gaugeState = total === 0 ? 'stopped' : doneRows.length === total ? 'complete' : inFlight ? 'progressing' : 'halted'
  const run = backlogRun()
  const runLive = run.status === 'running' && pidAlive(run.pid) && isHeartbeatFresh(run.heartbeatAt)
  const activeId = runLive ? run.currentId : undefined
  const autoActive = Boolean(run.autoResolve) && runLive
  const verifyActive = Boolean(run.verifyAll) && runLive
  const autoTotal = run.total ?? 0
  const autoResolved = run.resolved ?? 0
  const autoDonePercent = autoTotal ? Math.round((autoResolved / autoTotal) * 100) : 0
  const autoAllResolved = autoTotal > 0 && autoResolved >= autoTotal
  // The run-state's batch flags persist (touchBacklogRun merges), so gate the
  // summary on freshness — show it only while running or recently finished,
  // never as a stale "complete" banner after the backlog has moved on.
  const autoRecent = Boolean(run.heartbeatAt) && Date.now() - new Date(run.heartbeatAt ?? 0).getTime() < 10 * 60 * 1000
  const batchKind: 'auto' | 'verify' | null = run.verifyAll ? 'verify' : run.autoResolve ? 'auto' : null
  const showBatchBanner = Boolean(batchKind) && autoTotal > 0 && (runLive || autoRecent)
  const batchVerb = batchKind === 'verify' ? 'Verify-all' : 'Auto-resolve'
  const batchDoneWord = batchKind === 'verify' ? 'verified' : 'resolved'
  const batchPendWord = batchKind === 'verify' ? 'need review' : 'need approval'
  const todoCount = rows.filter((row) => row.status === 'todo').length
  const reviewCount = rows.filter((row) => row.status === 'review').length
  // Show the list open-first, then by priority — calmest reading order.
  const visible = [...filtered].sort((a, b) =>
    Number(a.status === 'done') - Number(b.status === 'done') ||
    (weight[a.priority] ?? 5) - (weight[b.priority] ?? 5) ||
    a.phase.localeCompare(b.phase) || a.id - b.id
  )
  // Resolved (done) items live in their own collapsed "Resolved list" so the
  // main list stays focused on what still needs work.
  const visibleOpen = visible.filter((row) => row.status !== 'done')
  const visibleDone = visible.filter((row) => row.status === 'done')

  const autoAi = resolveAutoAi(toolsRoot)

  const renderRow = (row: Task) => (
    <li key={row.id} className={`flex items-center gap-3 px-4 py-3 ${activeId === row.id ? 'bg-cyan-950/20' : 'bg-slate-900/40'}`}>
      <span className={activeId === row.id ? 'animate-pulse' : undefined}>
        <BacklogItemGauge status={row.status} priority={row.priority} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${row.status === 'done' ? 'text-slate-400 line-through' : 'font-medium text-slate-100'}`}>{row.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
          {activeId === row.id && (
            <span className="inline-flex items-center gap-1 font-medium text-cyan-300" title={run.message ?? 'Working…'}>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" aria-hidden="true" />working<ElapsedTimer startedAt={run.startedAt} prefix=" · ⏱ " className="font-normal text-cyan-300/70" />
            </span>
          )}
          <span className="font-mono">{row.phase}</span>
          {row.lane && <span>· {row.lane}</span>}
          {row.flag === 'possibly-shipped' && <span className="rounded bg-amber-900/70 px-1.5 text-amber-100" title="Matches a completed feature/screen">possibly shipped?</span>}
          {typeof row.confidence === 'number' && <span className={row.confidence >= 8 ? 'text-emerald-300' : 'text-amber-300'}>conf {row.confidence}/10</span>}
          {typeof row.verifyConfidence === 'number' && <span className={row.verifyConfidence >= 8 ? 'text-emerald-300' : 'text-amber-300'}>verify {row.verifyConfidence}/10</span>}
          {row.assignee && <span>@{row.assignee}</span>}
          {row.result && <span className="rounded bg-violet-900/70 px-1.5 text-violet-100" title="AI proposed a resolution — open Resolve to view">AI result</span>}
          {row.commit && <span className="font-mono text-slate-600" title="Resolved in commit">{row.commit}</span>}
          {row.pr && <a href={row.pr} target="_blank" rel="noreferrer" className="text-cyan-300 underline">PR ↗</a>}
        </p>
      </div>
      <span className={`hidden shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium sm:inline ${statusTone(row.status)}`}>{row.status}</span>
      <div className="flex shrink-0 items-center gap-1.5">
        <BacklogResolvePanel id={row.id} title={row.title} lane={row.lane} phase={row.phase} priority={row.priority} plan={row.plan} confidence={row.confidence} assignee={row.assignee} commit={row.commit} pr={row.pr} result={row.result} resultProvider={row.resultProvider} autoResolvesTo={autoAi.choiceLabel} />
        <BacklogReviewPanel id={row.id} title={row.title} status={row.status} assignee={row.assignee} plan={row.plan} commit={row.commit} pr={row.pr} result={row.result} resultProvider={row.resultProvider} confidence={row.confidence} verifyConfidence={row.verifyConfidence} verifyReason={row.verifyReason} />
        <BacklogRowControls id={row.id} status={row.status} />
      </div>
    </li>
  )

  return (
    <section className="mx-auto max-w-4xl">
      <AutoRefresh seconds={5} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Backlog</h1>
          <p className="mt-1 text-sm text-slate-400">
            <span className="text-slate-200">{openRows.length}</span> open · {doneRows.length} done{criticalHigh > 0 && <> · <span className="text-red-300">{criticalHigh} critical/high</span></>} · <span className="text-slate-500">auto-synced {syncAgo}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <BuildProgressGauge size="sm" percent={donePercent} state={gaugeState} label="Backlog progress" message={`${doneRows.length}/${total} resolved`} />
          <form action="/api/actions" method="post">
            <input type="hidden" name="action" value="backlog-sync" />
            <button className="min-h-10 rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800" title="Scan code for TODO/FIXME + flag shipped items now">Sync</button>
          </form>
          <form action="/api/actions" method="post">
            <input type="hidden" name="action" value="backlog-auto-resolve" />
            <button
              disabled={runLive || todoCount === 0}
              title={runLive ? 'A backlog run is in progress' : todoCount === 0 ? (reviewCount > 0 ? `No todo items — ${reviewCount} item(s) await verification (use Verify all)` : 'No open todo items to resolve') : `Plan + confidence-gate all ${todoCount} todo item(s)`}
              className="min-h-10 rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {autoActive ? 'Auto-resolving…' : 'Auto-resolve all'}
            </button>
          </form>
          <form action="/api/actions" method="post">
            <input type="hidden" name="action" value="backlog-verify-all" />
            <button
              disabled={runLive || reviewCount === 0}
              title={runLive ? 'A backlog run is in progress' : reviewCount === 0 ? 'No items awaiting verification' : `Verify all ${reviewCount} item(s) in review — ≥8 marks done, below flags for review`}
              className="min-h-10 rounded-md border border-sky-700 bg-sky-950/30 px-3 py-2 text-sm font-medium text-sky-100 hover:bg-sky-950/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {verifyActive ? 'Verifying…' : `Verify all${reviewCount > 0 ? ` (${reviewCount})` : ''}`}
            </button>
          </form>
          {runLive && (
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="backlog-stop" />
              <button
                title="Stop the current backlog run and clear the state (use this if a run looks stuck)"
                className="min-h-10 rounded-md border border-red-700 bg-red-950/30 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-950/50"
              >
                Stop run
              </button>
            </form>
          )}
        </div>
      </div>

      {showBatchBanner && (
        <div className="mt-3 rounded-lg border border-cyan-900 bg-cyan-950/20 p-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-cyan-100">{runLive ? `${batchVerb} running` : autoAllResolved ? `${batchVerb} finished — all done` : `${batchVerb} finished — needs follow-up`}{runLive && <ElapsedTimer startedAt={run.startedAt} processed={run.processed} total={autoTotal} prefix=" · ⏱ " className="font-normal text-cyan-300/80" />}</span>
            <span className="text-xs text-slate-400">{run.processed ?? 0}/{autoTotal} processed · {autoResolved} {batchDoneWord} · {run.queued ?? 0} {batchPendWord} · {run.failed ?? 0} failed</span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-slate-800" title={`${autoResolved}/${autoTotal} ${batchDoneWord}`}>
            <div className={`h-full rounded ${runLive ? 'bg-cyan-500' : autoAllResolved ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${autoDonePercent}%` }} />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {runLive
              ? run.message
              : autoAllResolved
                ? (run.message ?? 'All items done.')
                : `${autoResolved}/${autoTotal} ${batchDoneWord} · ${run.queued ?? 0} ${batchPendWord} · ${run.failed ?? 0} failed — review the flagged items below.`}
          </p>
        </div>
      )}

      {searchParams?.message && <p className="mt-3 rounded-md border border-emerald-800 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">{searchParams.message}</p>}
      {searchParams?.error && <p className="mt-3 rounded-md border border-red-800 bg-red-950/30 px-3 py-2 text-sm text-red-200">{searchParams.error}</p>}

      <details className="mt-4 rounded-lg border border-slate-800 bg-slate-900/50">
        <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-medium text-slate-200">+ Add a task</summary>
        <form id="add-task" action="/api/actions" method="post" className="grid gap-2 border-t border-slate-800 p-4 sm:grid-cols-[1fr_100px_120px_120px_auto]">
          <input type="hidden" name="action" value="backlog-add" />
          <input name="title" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm" placeholder="Task title" />
          <input name="phase" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm" defaultValue="P01" aria-label="Phase" />
          <select name="priority" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm" defaultValue="medium" aria-label="Priority">
            {['critical', 'high', 'medium', 'low', 'infrastructure'].map((priority) => <option key={priority}>{priority}</option>)}
          </select>
          <select name="lane" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm" defaultValue="none" aria-label="Lane">
            <option value="none">No lane</option>
            {['backend', 'frontend', 'ui', 'infra'].map((lane) => <option key={lane} value={lane}>{lane}</option>)}
          </select>
          <button className="min-h-10 rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950">Add</button>
        </form>
      </details>

      <div className="mt-4 flex flex-wrap items-center gap-1.5 text-xs">
        <a href="/backlog" className={`rounded-md border px-2.5 py-1 ${!hasFilter ? 'border-cyan-600 bg-cyan-950/40 text-cyan-100' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}>All</a>
        {['todo', 'in-progress', 'plan-review', 'review', 'blocked', 'done'].map((s) => (
          <a key={s} href={`/backlog?status=${s}`} className={`rounded-md border px-2.5 py-1 ${fStatus === s ? 'border-cyan-600 bg-cyan-950/40 text-cyan-100' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}>{s}</a>
        ))}
        <span className="mx-1 text-slate-700">|</span>
        {['backend', 'frontend', 'ui', 'infra'].map((l) => (
          <a key={l} href={`/backlog?lane=${l}`} className={`rounded-md border px-2.5 py-1 ${fLane === l ? 'border-cyan-600 bg-cyan-950/40 text-cyan-100' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}>{l}</a>
        ))}
      </div>

      <div className="mt-3">
        <BacklogFlowStrip />
      </div>

      <ul className="mt-3 divide-y divide-slate-800 overflow-hidden rounded-lg border border-slate-800">
        {visibleOpen.map(renderRow)}
        {visibleOpen.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-slate-400">{visibleDone.length > 0 ? 'No open tasks — see the Resolved list below.' : 'No tasks match this filter.'}</li>
        )}
      </ul>

      {visibleDone.length > 0 && (
        <details className="mt-4 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
          <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-medium text-slate-200">
            Resolved list <span className="ml-1 text-xs font-normal text-slate-500">({visibleDone.length})</span>
          </summary>
          <ul className="divide-y divide-slate-800 border-t border-slate-800">
            {visibleDone.map(renderRow)}
          </ul>
        </details>
      )}
    </section>
  )
}
