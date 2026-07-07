import fs from 'node:fs'
import path from 'node:path'
import { AutoRefresh } from '../auto-refresh'
import { BuildProgressGauge } from '../build-progress-gauge'
import { LaneItemGauge } from '../lane-item-gauge'
import { VerifyFlowStrip } from '../verify-flow-strip'
import { StatusSymbol } from '../status-symbol'

const readyFile = path.resolve(process.cwd(), '..', 'logs', 'ready.json')
const startReadinessFile = path.resolve(process.cwd(), '..', 'logs', 'start-readiness.json')

type ReadyCheck = { name: string; status: 'pass' | 'warning' | 'critical'; message: string; fix?: string }
type ReadyCategory = { id: string; label: string; checks: ReadyCheck[] }
type ReadyResult = {
  createdAt?: string
  ready?: boolean
  summary?: { pass: number; warning: number; critical: number }
  categories?: ReadyCategory[]
}
type PageProps = { searchParams?: { message?: string; error?: string } }
type StartReadiness = { phase?: string; ready?: boolean; createdAt?: string }

function readReady(): ReadyResult {
  if (!fs.existsSync(readyFile)) return { ready: false, summary: { pass: 0, warning: 0, critical: 1 }, categories: [] }
  try {
    return JSON.parse(fs.readFileSync(readyFile, 'utf8')) as ReadyResult
  } catch {
    return { ready: false, summary: { pass: 0, warning: 0, critical: 1 }, categories: [] }
  }
}

function readStartReadiness(): StartReadiness {
  if (!fs.existsSync(startReadinessFile)) return {}
  try {
    return JSON.parse(fs.readFileSync(startReadinessFile, 'utf8')) as StartReadiness
  } catch {
    return {}
  }
}

export default function ReadyPage({ searchParams }: PageProps) {
  const data = readReady()
  const startReadiness = readStartReadiness()
  const ready = Boolean(data.ready)
  const summary = data.summary ?? { pass: 0, warning: 0, critical: 1 }
  const continueHref = startReadiness.phase === 'FRONTEND' ? '/frontend-build-control' : '/build-control'
  const continueLabel = startReadiness.phase === 'FRONTEND' ? 'Continue to Frontend Build Control' : 'Continue to Backend Build Control'

  const categories = data.categories ?? []
  const allChecks = categories.flatMap((category) => category.checks)
  const totalChecks = allChecks.length
  const passedChecks = allChecks.filter((check) => check.status === 'pass').length
  const hasCritical = allChecks.some((check) => check.status === 'critical')
  const overallPercent = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 0
  const overallState: 'complete' | 'progressing' | 'halted' =
    totalChecks > 0 && passedChecks === totalChecks ? 'complete' : hasCritical ? 'halted' : 'progressing'

  return (
    <section className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Readiness Gate</h1>
          <p className="mt-2 text-sm text-slate-400">Final check before starting the Docmee build.</p>
        </div>
      </div>

      <AutoRefresh seconds={15} />
      <div className="mt-3">
        <VerifyFlowStrip active="ready" />
      </div>

      {searchParams?.message && <p className="mt-3 text-sm text-emerald-300">{searchParams.message}</p>}
      {searchParams?.error && <p className="mt-3 text-sm text-red-300">{searchParams.error}</p>}

      <div className={ready ? 'mt-4 rounded-md border border-emerald-700 bg-emerald-950/40 p-5' : 'mt-4 rounded-md border border-red-800 bg-red-950/40 p-5'}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{ready ? 'DEVTOOLS READY' : 'NOT READY'}</h2>
            <p className="mt-2 text-sm text-slate-300">{summary.pass} passed · {summary.warning} warnings · {summary.critical} critical</p>
            {totalChecks > 0 && <p className="mt-1 text-sm text-slate-400">{passedChecks}/{totalChecks} checks passed</p>}
            {data.createdAt && <p className="mt-1 text-xs text-slate-500">Last checked {new Date(data.createdAt).toLocaleString()}</p>}
          </div>
          {totalChecks > 0 && (
            <BuildProgressGauge
              size="sm"
              percent={overallPercent}
              state={overallState}
              label="Readiness"
              message={`${passedChecks}/${totalChecks} checks`}
            />
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <form action="/api/actions" method="post"><input type="hidden" name="action" value="ready-run" /><button className="min-h-11 rounded-md bg-slate-100 px-3 py-2 text-sm font-medium text-slate-950">Run Ready Check</button></form>
          <form action="/api/actions" method="post"><input type="hidden" name="action" value="ready-fix" /><button className="min-h-11 rounded-md border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800">Auto-Fix Local Items</button></form>
          {ready && (
            <a href={continueHref} className="inline-flex min-h-11 items-center rounded-md bg-cyan-600 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-500">
              {continueLabel}
            </a>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-4">
        {categories.map((category) => {
          const total = category.checks.length
          const passed = category.checks.filter((check) => check.status === 'pass').length
          const critical = category.checks.filter((check) => check.status === 'critical').length
          const warnings = category.checks.filter((check) => check.status === 'warning').length
          const percent = total > 0 ? Math.round((passed / total) * 100) : 0
          const tone = critical > 0 ? 'red' : warnings > 0 ? 'amber' : 'emerald'
          const statusText = critical > 0 ? `${critical} critical` : warnings > 0 ? `${warnings} warnings` : 'ready'
          return (
            <details key={category.id} className="rounded-md border border-slate-800 bg-slate-900">
              <summary className="flex cursor-pointer select-none items-center gap-3 px-4 py-3">
                <LaneItemGauge percent={percent} tone={tone} title={`${category.label} — ${statusText}`} />
                <span className="flex-1">
                  <span className="text-sm font-semibold">{category.label}</span>
                  <span className={critical > 0 ? 'ml-3 text-sm text-red-300' : warnings > 0 ? 'ml-3 text-sm text-amber-300' : 'ml-3 text-sm text-emerald-300'}>
                    {statusText}
                  </span>
                </span>
                <span className="text-xs tabular-nums text-slate-500">{passed}/{total} passed</span>
              </summary>
              <div className="grid gap-2 border-t border-slate-800 p-4">
                {category.checks.map((check) => (
                  <div key={check.name} className="rounded border border-slate-800 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm text-slate-200">{check.name}</span>
                      <span className="text-sm"><StatusSymbol status={check.status} label={check.status} /></span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{check.message}</p>
                    {check.fix && <p className="mt-1 text-xs text-sky-300">{check.fix}</p>}
                  </div>
                ))}
              </div>
            </details>
          )
        })}
        {categories.length === 0 && <p className="rounded-md border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">Run the ready check to populate this page.</p>}
      </div>
    </section>
  )
}
