import fs from 'node:fs'
import path from 'node:path'
import { StatusDot } from '../status-dot'
import { DetailButton } from '../detail-button'
import { VerifyFlowStrip } from '../verify-flow-strip'
import { LaneItemGauge } from '../lane-item-gauge'
import { BuildProgressGauge } from '../build-progress-gauge'
import { AutoRefresh } from '../auto-refresh'

const toolsRoot = path.resolve(process.cwd(), '..')
const postDeploymentFile = path.join(toolsRoot, 'logs', 'post-deployment.json')

type CheckStatus = 'pass' | 'warning' | 'fail'
type PostDeploymentCheck = {
  name: string
  status: CheckStatus
  message: string
  detail?: string
}
type PostDeploymentRun = {
  id: string
  createdAt: string
  summary: { pass: number; warning: number; fail: number }
  checks: PostDeploymentCheck[]
  target?: 'local' | 'vps' | 'env'
}
type PageProps = { searchParams?: { message?: string; error?: string; run?: string; check?: string } }

function readRuns() {
  if (!fs.existsSync(postDeploymentFile)) return [] as PostDeploymentRun[]
  try {
    return JSON.parse(fs.readFileSync(postDeploymentFile, 'utf8')) as PostDeploymentRun[]
  } catch {
    return [] as PostDeploymentRun[]
  }
}

function statusClass(status: CheckStatus) {
  if (status === 'pass') return 'border-emerald-800 bg-emerald-950/30 text-emerald-200'
  if (status === 'warning') return 'border-amber-800 bg-amber-950/30 text-amber-200'
  return 'border-red-800 bg-red-950/30 text-red-200'
}

function statusLabel(status: CheckStatus) {
  if (status === 'pass') return 'Pass'
  if (status === 'warning') return 'Warning'
  return 'Issue'
}

function statusDotTone(status: CheckStatus) {
  if (status === 'pass') return 'green' as const
  if (status === 'warning') return 'amber' as const
  return 'red' as const
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'check'
}

function runKey(run: PostDeploymentRun) {
  return run.id || run.createdAt
}

function checkAnchor(run: PostDeploymentRun, check: PostDeploymentCheck) {
  return `check-${slug(runKey(run))}-${slug(check.name)}`
}

function runTotal(run: PostDeploymentRun) {
  return run.summary.pass + run.summary.warning + run.summary.fail
}

function runPercent(run: PostDeploymentRun) {
  const total = runTotal(run)
  return total > 0 ? (run.summary.pass / total) * 100 : 0
}

function runTone(run: PostDeploymentRun): 'red' | 'amber' | 'emerald' {
  if (run.summary.fail > 0) return 'red'
  if (run.summary.warning > 0) return 'amber'
  return 'emerald'
}

function runTargetLabel(run: PostDeploymentRun) {
  if (run.target === 'vps') return 'Automated VPS verification'
  if (run.target === 'env') return 'Automated .env readiness check'
  return 'Automated local functionality check'
}

export default function PostDeploymentPage({ searchParams }: PageProps) {
  const runs = readRuns()
  const selectedRun = runs.find((run) => runKey(run) === searchParams?.run) ?? runs[0]
  const latest = selectedRun
  const openIssues = latest?.checks.filter((check) => check.status === 'fail') ?? []
  const warnings = latest?.checks.filter((check) => check.status === 'warning') ?? []
  const selectedCheckSlug = searchParams?.check

  const overallPercent = latest ? runPercent(latest) : 0
  const overallState: 'complete' | 'progressing' | 'halted' | 'stopped' = !latest
    ? 'stopped'
    : latest.summary.fail > 0
      ? 'halted'
      : latest.summary.warning === 0
        ? 'complete'
        : 'progressing'
  const overallMessage = latest ? `${latest.summary.pass} pass · ${latest.summary.fail} fail` : 'No runs yet'

  return (
    <section className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Post-Deployment Log</h1>
          <p className="mt-2 text-sm text-slate-400">Issues found after development and before VPS deployment.</p>
        </div>
        <a href="/deploy" className="rounded-md bg-cyan-600 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-500">
          Open Deployment Guide
        </a>
      </div>

      <AutoRefresh seconds={15} />
      <div className="mt-3">
        <VerifyFlowStrip active="postdeploy" />
      </div>

      {searchParams?.message && <p className="mt-3 text-sm text-emerald-300">{searchParams.message}</p>}
      {searchParams?.error && <p className="mt-3 text-sm text-red-300">{searchParams.error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-4 rounded-md border border-slate-800 bg-slate-900 p-4">
        <BuildProgressGauge size="sm" percent={overallPercent} state={overallState} label="Post-deployment" message={overallMessage} />
        <div className="text-sm text-slate-400">Latest functionality check summary.</div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-4">
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <div className="text-xs text-slate-500">Last run</div>
          <div className="mt-2 text-sm text-slate-200">{latest ? new Date(latest.createdAt).toLocaleString() : 'Not run yet'}</div>
        </div>
        <div className="rounded-md border border-emerald-800 bg-emerald-950/20 p-4">
          <div className="text-xs text-emerald-400">Passed</div>
          <div className="mt-2 text-2xl font-semibold text-emerald-200">{latest?.summary.pass ?? 0}</div>
        </div>
        <div className="rounded-md border border-amber-800 bg-amber-950/20 p-4">
          <div className="text-xs text-amber-400">Warnings</div>
          <div className="mt-2 text-2xl font-semibold text-amber-200">{latest?.summary.warning ?? 0}</div>
        </div>
        <div className="rounded-md border border-red-800 bg-red-950/20 p-4">
          <div className="text-xs text-red-400">Issues</div>
          <div className="mt-2 text-2xl font-semibold text-red-200">{latest?.summary.fail ?? 0}</div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-semibold">Current Issues</h2>
          <div className="mt-4 space-y-3">
            {openIssues.length === 0 && warnings.length === 0 ? (
              <p className="text-sm text-slate-400">{latest ? 'No current issues from the latest check.' : 'Run the check to create the first log.'}</p>
            ) : (
              [...openIssues, ...warnings].map((check) => {
                const isSelected = selectedCheckSlug === slug(check.name)
                return (
                <div
                  id={checkAnchor(latest, check)}
                  key={`${check.name}-${check.status}`}
                  className={`scroll-mt-24 rounded-md border p-3 ${statusClass(check.status)} ${isSelected ? 'ring-2 ring-sky-300' : ''}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm">{check.name}</strong>
                    <StatusDot tone={statusDotTone(check.status)} label={statusLabel(check.status)} />
                  </div>
                  <p className="mt-2 text-sm">{check.message}</p>
                  {check.detail && (
                    <div className="mt-3"><DetailButton buttonLabel="Error details" title={check.name} body={check.detail} /></div>
                  )}
                </div>
              )})
            )}
          </div>
        </div>

        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-semibold">Latest Functionality Check</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="border-b border-slate-800 px-3 py-2">Status</th>
                  <th className="border-b border-slate-800 px-3 py-2">Functionality</th>
                  <th className="border-b border-slate-800 px-3 py-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {(latest?.checks ?? []).map((check) => {
                  const isSelected = selectedCheckSlug === slug(check.name)
                  return (
                  <tr key={check.name} className={`border-b border-slate-800/70 ${isSelected ? 'bg-sky-950/30' : ''}`}>
                    <td className="px-3 py-2 align-top">
                      <StatusDot tone={statusDotTone(check.status)} label={statusLabel(check.status)} />
                    </td>
                    <td className="px-3 py-2 align-top font-medium text-slate-200">{check.name}</td>
                    <td className="px-3 py-2 align-top text-slate-400">
                      <div>{check.message}</div>
                      {check.detail && (
                        <div className="mt-2"><DetailButton buttonLabel="Error details" title={check.name} body={check.detail} /></div>
                      )}
                    </td>
                  </tr>
                )})}
                {!latest && (
                  <tr>
                    <td className="px-3 py-6 text-sm text-slate-400" colSpan={3}>No post-deployment checks have been recorded yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <details className="mt-6 rounded-md border border-slate-800 bg-slate-900 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-200 hover:text-white">Run history <span className="ml-1 text-xs font-normal text-slate-500">(show {runs.length} runs)</span></summary>
        <div className="mt-4 grid gap-2">
          {runs.slice(0, 10).map((run) => {
            const runTime = new Date(run.createdAt).toLocaleString()
            const gaugeTitle = `${runTargetLabel(run)} · ${runTime}`
            return (
            <div id={`run-${slug(runKey(run))}`} key={run.id} className="rounded border border-slate-800 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <LaneItemGauge percent={runPercent(run)} tone={runTone(run)} title={gaugeTitle} />
                  <div>
                    <div className="text-slate-200">{runTime}</div>
                    <div className="text-xs text-slate-500">{runTargetLabel(run)}</div>
                  </div>
                </div>
                <div className="flex gap-2 text-xs">
                  <span className="rounded bg-emerald-950 px-2 py-1 text-emerald-200">{run.summary.pass} pass</span>
                  <span className="rounded bg-amber-950 px-2 py-1 text-amber-200">{run.summary.warning} warnings</span>
                  <span className="rounded bg-red-950 px-2 py-1 text-red-200">{run.summary.fail} issues</span>
                </div>
              </div>
              {run.checks.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-200">View {run.checks.length} checks</summary>
                  <div className="mt-2 grid gap-1.5">
                    {run.checks.map((check) => (
                      <div key={check.name} className="flex items-center justify-between gap-2 rounded border border-slate-800/70 px-2 py-1 text-xs">
                        <span className="flex items-center gap-2">
                          <StatusDot tone={statusDotTone(check.status)} label={statusLabel(check.status)} />
                          <span className="text-slate-300">{check.name}</span>
                        </span>
                        <span className="truncate text-slate-500">{check.message}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )})}
          {runs.length === 0 && <p className="text-sm text-slate-400">No history yet.</p>}
        </div>
      </details>
    </section>
  )
}
