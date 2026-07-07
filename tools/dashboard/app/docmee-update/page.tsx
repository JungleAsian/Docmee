import path from 'node:path'
import Link from 'next/link'
import { readJson } from '../lib/read-json'
import { WorkflowStages } from '../workflow-stages'
import { AutoRefresh } from '../auto-refresh'
import { BuildProgressGauge } from '../build-progress-gauge'

type PageProps = { searchParams?: { message?: string; error?: string } }

type UpdateStep = {
  name: string
  status: 'pass' | 'warning' | 'fail'
  message: string
}

type UpdateRun = {
  id: string
  createdAt: string
  status: 'planned' | 'local-passed' | 'local-failed'
  summary: string
  steps: UpdateStep[]
}

const toolsRoot = path.resolve(process.cwd(), '..')
const updateFile = path.join(toolsRoot, 'logs', 'docmee-technology-update.json')
const stackFile = path.join(toolsRoot, 'logs', 'stack-intelligence.json')
const postDeploymentFile = path.join(toolsRoot, 'logs', 'post-deployment.json')

function statusTone(status?: string) {
  if (status === 'pass' || status === 'local-passed') return 'border-emerald-700/70 bg-emerald-950/30 text-emerald-200'
  if (status === 'fail' || status === 'local-failed') return 'border-red-700/70 bg-red-950/30 text-red-200'
  return 'border-amber-700/70 bg-amber-950/30 text-amber-100'
}

function lastLocalPostDeployPassed() {
  const runs = readJson<Array<{ target?: string; summary?: { fail?: number } }>>(postDeploymentFile, [])
  return runs.find((run) => (run.target ?? 'local') === 'local')?.summary?.fail === 0
}

export default function DocmeeUpdatePage({ searchParams }: PageProps) {
  const runs = readJson<UpdateRun[]>(updateFile, [])
  const latest = runs[0]
  const stack = readJson<{ generatedAt?: string; packages?: Array<{ updateAvailable?: boolean }> }>(stackFile, {})
  const updatesAvailable = (stack.packages ?? []).filter((item) => item.updateAvailable).length
  const localValidationPassed = latest?.status === 'local-passed'
  const localFunctionalityPassed = lastLocalPostDeployPassed()
  const vpsReady = localValidationPassed && localFunctionalityPassed

  const workflow = [
    {
      name: '1. Refresh technology scan',
      status: stack.generatedAt ? 'pass' : 'warning',
      message: stack.generatedAt
        ? `Last scan ${new Date(stack.generatedAt).toLocaleString()} with ${updatesAvailable} package update${updatesAvailable === 1 ? '' : 's'} available.`
        : 'Run Stack Intelligence before choosing updates.'
    },
    {
      name: '2. Create Docmee update plan',
      status: latest ? 'pass' : 'warning',
      message: latest ? latest.summary : 'Create a local-first plan before changing the product stack.'
    },
    {
      name: '3. Build locally first',
      status: localValidationPassed ? 'pass' : latest?.status === 'local-failed' ? 'fail' : 'warning',
      message: localValidationPassed ? 'Install, typecheck, and build passed locally.' : 'Run local validation before deployment.'
    },
    {
      name: '4. Run local functionality check',
      status: localFunctionalityPassed ? 'pass' : 'warning',
      message: localFunctionalityPassed ? 'Latest local post-deployment check passed.' : 'Run the local functionality check after the local build passes.'
    },
    {
      name: '5. Deploy to VPS',
      status: vpsReady ? 'pass' : 'warning',
      message: vpsReady ? 'VPS deployment can continue from the Deploy page.' : 'Locked until local validation and functionality checks pass.'
    }
  ] as UpdateStep[]

  const passedSteps = workflow.filter((step) => step.status === 'pass').length
  const progressPercent = Math.round((passedSteps / workflow.length) * 100)
  const anyFailed = workflow.some((step) => step.status === 'fail')
  const gaugeState = vpsReady ? 'complete' : anyFailed ? 'halted' : 'progressing'

  return (
    <section className="w-full">
      <WorkflowStages active="deploy" />
      <AutoRefresh seconds={15} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Docmee Technology Update</h1>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <BuildProgressGauge
              size="sm"
              percent={progressPercent}
              state={gaugeState}
              label={`${passedSteps}/${workflow.length} steps`}
              message="Local-first update readiness"
            />
          </div>
          <details className="mt-3 max-w-3xl text-sm text-slate-400">
            <summary className="cursor-pointer text-slate-300">How updates flow</summary>
            <p className="mt-2">
              Product updates are handled locally first, then verified, then deployed to the VPS. This protects completed work and keeps future updates traceable.
            </p>
          </details>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action="/api/actions" method="post">
            <input type="hidden" name="action" value="stack-refresh" />
            <button className="min-h-11 rounded-md border border-slate-700 px-3 py-2 text-sm">Refresh Scan</button>
          </form>
          <form action="/api/actions" method="post">
            <input type="hidden" name="action" value="docmee-update-plan" />
            <button className="min-h-11 rounded-md bg-cyan-600 px-3 py-2 text-sm text-white">Create Update Plan</button>
          </form>
        </div>
      </div>

      {searchParams?.message && <p className="mt-3 rounded-md border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-200">{searchParams.message}</p>}
      {searchParams?.error && <p className="mt-3 rounded-md border border-red-800 bg-red-950/30 p-3 text-sm text-red-200">{searchParams.error}</p>}

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <p className="text-xs text-slate-500">Updates available</p>
          <p className="mt-2 text-3xl font-semibold text-amber-300">{updatesAvailable}</p>
        </div>
        <div className={`rounded-md border p-4 ${statusTone(latest?.status)}`}>
          <p className="text-xs opacity-80">Update plan</p>
          <p className="mt-2 text-lg font-semibold">{latest ? 'Recorded' : 'Needed'}</p>
        </div>
        <div className={`rounded-md border p-4 ${statusTone(localValidationPassed ? 'pass' : latest?.status === 'local-failed' ? 'fail' : 'warning')}`}>
          <p className="text-xs opacity-80">Local build</p>
          <p className="mt-2 text-lg font-semibold">{localValidationPassed ? 'Passed' : latest?.status === 'local-failed' ? 'Failed' : 'Waiting'}</p>
        </div>
        <div className={`rounded-md border p-4 ${statusTone(vpsReady ? 'pass' : 'warning')}`}>
          <p className="text-xs opacity-80">VPS deploy</p>
          <p className="mt-2 text-lg font-semibold">{vpsReady ? 'Unlocked' : 'Locked'}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-semibold">Guided Workflow</h2>
          <div className="mt-3 space-y-3">
            {workflow.map((step) => (
              <div key={step.name} className={`rounded-md border p-3 ${statusTone(step.status)}`}>
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">{step.name}</p>
                  <span className="rounded bg-slate-950/40 px-2 py-1 text-xs uppercase">{step.status}</span>
                </div>
                <p className="mt-2 text-sm opacity-90">{step.message}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Actions</h2>
              <details className="mt-1 text-xs text-slate-400">
                <summary className="cursor-pointer text-slate-300">Why this order</summary>
                <p className="mt-1">These are ordered so the VPS deploy step cannot be treated as ready until local checks pass.</p>
              </details>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Link href="/stack" className="rounded-md border border-slate-700 p-4 text-sm hover:bg-slate-800">
              <span className="block font-medium">Review stack details</span>
              <span className="mt-1 block text-xs text-slate-400">Check package updates, advisories, pricing, and stack news.</span>
            </Link>
            <form action="/api/actions" method="post" className="rounded-md border border-slate-700 p-4">
              <input type="hidden" name="action" value="docmee-update-local-check" />
              <button className="w-full rounded-md bg-cyan-600 px-3 py-2 text-sm font-medium text-white">Run Local Validation</button>
              <p className="mt-2 text-xs text-slate-400">Runs install lockfile check, typecheck, and build on the Docmee product.</p>
            </form>
            <Link href="/post-deployment" className="rounded-md border border-slate-700 p-4 text-sm hover:bg-slate-800">
              <span className="block font-medium">Open local functionality checks</span>
              <span className="mt-1 block text-xs text-slate-400">Use Post-Deployment Log for runtime, login, API health, and core route checks.</span>
            </Link>
            <Link
              href="/deploy"
              className={`rounded-md border p-4 text-sm ${vpsReady ? 'border-emerald-700 bg-emerald-950/20 text-emerald-100 hover:bg-emerald-950/40' : 'pointer-events-none border-slate-800 text-slate-500'}`}
              aria-disabled={!vpsReady}
            >
              <span className="block font-medium">Continue to VPS deploy</span>
              <span className="mt-1 block text-xs opacity-80">{vpsReady ? 'Local gates passed. Continue with VPS deployment.' : 'Locked until local checks pass.'}</span>
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-md border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-semibold">Recent Update Runs</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-950">
              <tr><th className="p-3">Time</th><th className="p-3">Status</th><th className="p-3">Summary</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {runs.map((run) => (
                <tr key={run.id}>
                  <td className="p-3">{new Date(run.createdAt).toLocaleString()}</td>
                  <td className="p-3">{run.status}</td>
                  <td className="p-3 text-slate-300">{run.summary}</td>
                </tr>
              ))}
              {runs.length === 0 && <tr><td colSpan={3} className="p-3 text-slate-400">No Docmee technology update run has been recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
