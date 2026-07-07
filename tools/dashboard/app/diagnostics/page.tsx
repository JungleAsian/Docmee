import fs from 'node:fs'
import path from 'node:path'
import { BuildProgressGauge } from '../build-progress-gauge'
import { LaneItemGauge } from '../lane-item-gauge'

const logsDir = path.resolve(process.cwd(), '..', 'logs')
const diagnosticsFile = path.join(logsDir, 'diagnostics.json')
const historyFile = path.join(logsDir, 'diagnostics-history.json')

type Status = 'pass' | 'info' | 'warning' | 'critical'
type Check = { name: string; status: Status; message: string; fix?: string; fixable?: boolean }
type Category = { id: string; label: string; checks: Check[] }
type Run = { createdAt: string; quick: boolean; categories: Category[]; summary: Record<Status, number> }
type PageProps = { searchParams?: { message?: string; error?: string } }

function readJson<T>(file: string, fallback: T) {
  if (!fs.existsSync(file)) return fallback
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T
}

function tone(status: Status) {
  if (status === 'critical') return 'text-red-300'
  if (status === 'warning') return 'text-amber-300'
  if (status === 'info') return 'text-sky-300'
  return 'text-emerald-300'
}

export default function DiagnosticsPage({ searchParams }: PageProps) {
  const run = readJson<Run | null>(diagnosticsFile, null)
  const history = readJson<Run[]>(historyFile, [])
  const categories = run?.categories ?? []
  const issues = categories.flatMap((category) => category.checks.filter((check) => check.status === 'critical' || check.status === 'warning').map((check) => ({ ...check, category: category.label })))

  const allChecks = categories.flatMap((category) => category.checks)
  const totalChecks = allChecks.length
  const passedChecks = allChecks.filter((check) => check.status === 'pass').length
  const overallPercent = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 0
  const hasFailures = allChecks.some((check) => check.status === 'critical' || check.status === 'warning')
  const overallState: 'complete' | 'progressing' | 'halted' | 'stopped' =
    totalChecks === 0 ? 'stopped' : hasFailures ? 'halted' : passedChecks === totalChecks ? 'complete' : 'progressing'

  return (
    <section className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Diagnostics</h1>
          <p className="mt-2 text-sm text-slate-400">Targeted checks for Windows, DevTools, services, Notion, Discord, VPS, and build readiness.</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <BuildProgressGauge
            size="sm"
            percent={overallPercent}
            state={overallState}
            label={`${passedChecks}/${totalChecks} passed`}
            message={totalChecks === 0 ? 'No checks run yet' : `${issues.length} issue${issues.length === 1 ? '' : 's'} to review`}
          />
          <div className="flex gap-2">
            <form action="/api/actions" method="post"><input type="hidden" name="action" value="diagnose-run" /><button className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white">Run All</button></form>
            <form action="/api/actions" method="post"><input type="hidden" name="action" value="diagnose-quick" /><button className="rounded-md border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800">Quick Check</button></form>
          </div>
        </div>
      </div>
      {searchParams?.message && <p className="mt-2 text-sm text-emerald-300">{searchParams.message}</p>}
      {searchParams?.error && <p className="mt-2 text-sm text-red-300">{searchParams.error}</p>}

      <div className="mt-6 grid gap-3 md:grid-cols-4">
        {(['critical', 'warning', 'pass', 'info'] as Status[]).map((status) => (
          <div key={status} className="rounded-md border border-slate-800 bg-slate-900 p-4">
            <h2 className="text-sm font-semibold capitalize">{status}</h2>
            <p className={`mt-2 text-2xl ${tone(status)}`}>{run?.summary?.[status] ?? 0}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-md border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-sm font-semibold">Issues</h2><p className="mt-1 text-sm text-slate-400">Critical and warning checks with direct fix guidance.</p></div>
          <form action="/api/actions" method="post"><input type="hidden" name="action" value="diagnose-fix" /><button className="rounded-md border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800">Fix Guidance</button></form>
        </div>
        <div className="mt-4 space-y-2">
          {issues.length === 0 && <p className="text-sm text-slate-400">No issues recorded. Run diagnostics to refresh results.</p>}
          {issues.map((issue) => (
            <div key={`${issue.category}-${issue.name}`} className="rounded border border-slate-800 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{issue.category} / {issue.name}</span>
                <span className={`text-sm ${tone(issue.status)}`}>{issue.status}</span>
              </div>
              <p className="mt-1 text-sm text-slate-400">{issue.message}</p>
              {issue.fix && <p className="mt-1 text-xs text-slate-300">{issue.fix}</p>}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {categories.map((category) => {
          const passed = category.checks.filter((check) => check.status === 'pass').length
          const worst = category.checks.some((check) => check.status === 'critical') ? 'critical' : category.checks.some((check) => check.status === 'warning') ? 'warning' : 'pass'
          const categoryPercent = category.checks.length > 0 ? (passed / category.checks.length) * 100 : 0
          const categoryTone: 'red' | 'amber' | 'emerald' = worst === 'critical' ? 'red' : worst === 'warning' ? 'amber' : 'emerald'
          return (
            <details key={category.id} className="rounded-md border border-slate-800 bg-slate-950">
              <summary className="flex cursor-pointer select-none items-center gap-3 px-4 py-3">
                <LaneItemGauge percent={categoryPercent} tone={categoryTone} title={`${category.label} — ${worst}`} />
                <span className="font-semibold">{category.label}</span>
                <span className={`ml-auto text-sm ${tone(worst)}`}>{passed}/{category.checks.length}</span>
              </summary>
              <div className="space-y-2 border-t border-slate-800 p-4">
                <form action="/api/actions" method="post">
                  <input type="hidden" name="action" value="diagnose-run" />
                  <input type="hidden" name="category" value={category.id} />
                  <button className="mb-2 rounded-md border border-slate-700 px-3 py-2 text-xs hover:bg-slate-800">Run Category</button>
                </form>
                {category.checks.map((check) => (
                  <div key={check.name} className="rounded border border-slate-800 px-3 py-2">
                    <div className="flex items-center justify-between gap-3"><span className="text-sm">{check.name}</span><span className={`text-sm ${tone(check.status)}`}>{check.status}</span></div>
                    <p className="mt-1 text-xs text-slate-400">{check.message}</p>
                  </div>
                ))}
              </div>
            </details>
          )
        })}
      </div>

      <div className="mt-6 rounded-md border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-semibold">Run History</h2>
        <div className="mt-3 space-y-2">
          {history.map((item) => (
            <div key={item.createdAt} className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-800 px-3 py-2 text-sm">
              <span>{new Date(item.createdAt).toLocaleString()}</span>
              <span className="text-slate-400">{item.summary.critical} critical, {item.summary.warning} warnings, {item.summary.pass} passed</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
