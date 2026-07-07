import fs from 'node:fs'
import path from 'node:path'
import { AutoRefresh } from '../auto-refresh'
import { VerifyFlowStrip } from '../verify-flow-strip'
import { LaneItemGauge } from '../lane-item-gauge'
import { BuildProgressGauge } from '../build-progress-gauge'
import { StatusSymbol } from '../status-symbol'

const gates = ['Typecheck', 'Lint', 'Unit tests', 'RLS cross-clinic', 'Env', 'DAL']
const gatesFile = path.resolve(process.cwd(), '..', 'logs', 'six-gates.json')

type GateResult = { gate: number; name: string; ok: boolean; detail: string }
type GateStore = { generatedAt?: string; ok?: boolean; results?: GateResult[] }
type PageProps = {
  searchParams?: { message?: string; error?: string }
}

function readGates(): GateStore {
  if (!fs.existsSync(gatesFile)) return {}
  return JSON.parse(fs.readFileSync(gatesFile, 'utf8')) as GateStore
}

export default function GatesPage({ searchParams }: PageProps) {
  const store = readGates()
  const byGate = new Map((store.results ?? []).map((result) => [result.gate, result]))
  const anyRun = (store.results ?? []).length > 0
  const passed = (store.results ?? []).filter((result) => result.ok).length
  const overallState = !anyRun ? 'stopped' : passed === gates.length ? 'complete' : 'halted'
  const overallPercent = Math.round((passed / gates.length) * 100)

  return (
    <section className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Six Gates</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            These checks now run automatically before an automated build starts and after phase work completes. Use this page to review or manually re-check.
          </p>
        </div>
      </div>

      <AutoRefresh seconds={15} />
      <div className="mt-3">
        <VerifyFlowStrip active="gates" />
      </div>

      {store.generatedAt && <p className="mt-3 text-xs text-slate-500">Last checked: {new Date(store.generatedAt).toLocaleString()}</p>}
      {searchParams?.message && <p className="mt-3 text-sm text-emerald-300">{searchParams.message}</p>}
      {searchParams?.error && <p className="mt-3 text-sm text-red-300">{searchParams.error}</p>}

      <div className={`mt-4 rounded-md border p-4 ${store.generatedAt ? store.ok ? 'border-emerald-700/60 bg-emerald-950/20' : 'border-red-700/60 bg-red-950/20' : 'border-slate-800 bg-slate-900'}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium">{store.generatedAt ? store.ok ? 'All gates passed' : 'One or more gates need attention' : 'No gate result yet'}</div>
            <p className="mt-1 text-sm text-slate-400">{passed}/6 gates passing. DevTools blocks automated progress when a required gate fails.</p>
          </div>
          <div className="flex items-center gap-4">
            <BuildProgressGauge size="sm" percent={overallPercent} state={overallState} label="Six Gates" message={`${passed}/6 gates`} />
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="gates-run" />
              <button className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950">Re-run Gates</button>
            </form>
          </div>
        </div>
      </div>

      <details className="mt-6 rounded-md border border-slate-800 bg-slate-900">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-200 hover:text-white">Gate details <span className="ml-1 text-xs font-normal text-slate-500">({passed}/6 passing)</span></summary>
        <div className="grid gap-4 p-4 md:grid-cols-3 xl:grid-cols-6">
          {gates.map((gate, index) => {
            const result = byGate.get(index + 1)
            const stateClass = result
              ? result.ok
                ? 'border-emerald-800/70 bg-emerald-950/20'
                : 'border-red-800/70 bg-red-950/20'
              : 'border-slate-800 bg-slate-900'
            const status = result ? result.ok ? 'Passed' : 'Blocked' : 'Not checked'
            const gaugeTone = result ? result.ok ? 'emerald' : 'red' : 'slate'
            const gaugePercent = result?.ok ? 100 : 0
            return (
              <div key={gate} className={`rounded-md border p-5 ${stateClass}`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-400">Gate {index + 1}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs"><StatusSymbol status={status} label={status} /></span>
                    <LaneItemGauge percent={gaugePercent} tone={gaugeTone} title={`${gate} — ${status}`} />
                  </div>
                </div>
                <h2 className="mt-1 font-semibold">{gate}</h2>
                <p className="mt-3 line-clamp-4 text-sm text-slate-400">{result?.detail?.trim() || 'This gate will be checked automatically.'}</p>
              </div>
            )
          })}
        </div>
      </details>
    </section>
  )
}
