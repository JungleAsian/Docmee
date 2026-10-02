'use client'

export type WorkflowDiagnosticStatus = 'ready' | 'needs_attention' | 'not_ready'

export interface WorkflowDiagnosticFinding {
  code: string
  severity: 'error' | 'warning'
  title: string
  where?: string
  whatHappened?: string
  howToFix?: string
  nodeId?: string
  edgeId?: string
  technicalDetails?: string
}

export interface WorkflowDiagnosticView {
  status: WorkflowDiagnosticStatus
  source: 'saved_graph' | 'unsaved_graph'
  startedAt: string
  completedAt: string
  workflowChecks: WorkflowDiagnosticFinding[]
  simulations: Array<{ name: string; required: boolean; status: 'completed' | 'waiting' | 'paused' | 'failed' | 'skipped'; reason?: string }>
  integrations: Array<{ key: string; label: string; required: boolean; status: 'ready' | 'warning' | 'failed' | 'unknown'; checkedAt: string; detail?: string }>
  recentRuns: Array<Record<string, unknown>>
}

export function buildWorkflowDiagnosticsRequest(
  nodes: unknown[],
  edges: unknown[],
): {
  graph: { nodes: unknown[]; edges: unknown[] }
  simulation: { enabled: true }
  readiness: { enabled: true; refresh: false }
  recentRunsLimit: 10
} {
  return {
    graph: { nodes, edges },
    simulation: { enabled: true },
    readiness: { enabled: true, refresh: false },
    recentRunsLimit: 10,
  }
}

export function canUseWorkflowDiagnostics(role: string | undefined): boolean {
  return role === 'ia_studio_admin'
}

export function WorkflowDiagnosticsTrigger({
  role,
  busy,
  onOpen,
}: {
  role: string | undefined
  busy: boolean
  onOpen: () => void
}) {
  if (!canUseWorkflowDiagnostics(role)) return null
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={busy}
      title="Check this workflow without contacting patients or external services"
      className="rounded-md border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-800 disabled:opacity-40 dark:border-amber-800 dark:text-amber-200"
    >
      ◇ Diagnose
    </button>
  )
}

const statusCopy: Record<WorkflowDiagnosticStatus, { label: string; style: string }> = {
  ready: { label: 'Ready', style: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' },
  needs_attention: { label: 'Needs attention', style: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200' },
  not_ready: { label: 'Not ready', style: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200' },
}

function readable(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : 'Unknown'
}

export function WorkflowDiagnosticsPanel({
  open,
  busy,
  needsInitialSave,
  result,
  error,
  onClose,
  onRun,
  onFocusIssue,
}: {
  open: boolean
  busy: boolean
  needsInitialSave: boolean
  result: WorkflowDiagnosticView | null
  error: string | null
  onClose: () => void
  onRun: () => void
  onFocusIssue: (finding: WorkflowDiagnosticFinding) => void
}) {
  if (!open) return null
  const status = result ? statusCopy[result.status] : null

  return (
    <aside
      aria-label="Workflow diagnostics"
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-950"
    >
      <header className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Workflow diagnostics</h2>
          <p className="mt-1 text-xs text-gray-500">Superuser tool · safe checks only · no patient messages, bookings, jobs, or provider changes</p>
        </div>
        <button type="button" aria-label="Close workflow diagnostics" onClick={onClose} className="px-2 py-1 text-gray-500 hover:text-gray-900 dark:hover:text-white">✕</button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm">
        {needsInitialSave && (
          <div className="border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            <p className="font-semibold">Save this workflow once</p>
            <p className="mt-1 text-xs">Diagnostics need a workflow identity. After the first save, you can test later unsaved edits without saving them.</p>
          </div>
        )}
        {error && <div role="alert" className="border border-red-300 bg-red-50 p-3 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">{error}</div>}
        {status && (
          <div className={`border p-3 ${status.style}`}>
            <p className="font-semibold">{status.label}</p>
            <p className="mt-1 text-xs">Checked the {result?.source === 'unsaved_graph' ? 'current unsaved editor version' : 'saved workflow'}.</p>
          </div>
        )}

        {result && (
          <>
            <section aria-labelledby="diagnostic-workflow-checks">
              <h3 id="diagnostic-workflow-checks" className="font-semibold text-gray-900 dark:text-gray-100">Workflow checks</h3>
              {result.workflowChecks.length === 0 ? <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">No structural problems found.</p> : (
                <div className="mt-2 space-y-2">
                  {result.workflowChecks.map((finding, index) => (
                    <article key={`${finding.code}-${finding.nodeId ?? finding.edgeId ?? index}`} className="border border-gray-200 p-3 dark:border-gray-800">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-gray-900 dark:text-gray-100">{finding.title}</p>
                          {finding.where && <p className="text-xs text-gray-500">{finding.where}</p>}
                        </div>
                        {(finding.nodeId || finding.edgeId) && (
                          <button type="button" onClick={() => onFocusIssue(finding)} className="border border-cyan-300 px-2 py-1 text-xs font-medium text-cyan-700 dark:border-cyan-800 dark:text-cyan-200">Go to step</button>
                        )}
                      </div>
                      {finding.whatHappened && <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">{finding.whatHappened}</p>}
                      {finding.howToFix && <p className="mt-1 text-xs font-medium text-gray-700 dark:text-gray-200">Fix: {finding.howToFix}</p>}
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="diagnostic-safe-test">
              <h3 id="diagnostic-safe-test" className="font-semibold text-gray-900 dark:text-gray-100">Safe test</h3>
              <div className="mt-2 space-y-2">
                {result.simulations.length === 0 ? <p className="text-xs text-gray-500">Not requested.</p> : result.simulations.map((simulation) => (
                  <div key={simulation.name} className="flex items-start justify-between gap-3 border border-gray-200 p-3 dark:border-gray-800">
                    <div><p className="font-medium">{simulation.name}</p>{simulation.reason && <p className="mt-1 text-xs text-gray-500">{simulation.reason}</p>}</div>
                    <span className="text-xs font-semibold uppercase text-gray-500">{simulation.status}</span>
                  </div>
                ))}
              </div>
            </section>

            <section aria-labelledby="diagnostic-integrations">
              <h3 id="diagnostic-integrations" className="font-semibold text-gray-900 dark:text-gray-100">Integration readiness</h3>
              {result.integrations.length === 0 ? <p className="mt-2 text-xs text-gray-500">This path does not reference a managed integration.</p> : (
                <div className="mt-2 space-y-2">
                  {result.integrations.map((integration) => (
                    <div key={integration.key} className="border border-gray-200 p-3 dark:border-gray-800">
                      <div className="flex justify-between gap-3"><p className="font-medium">{integration.label}</p><span className="text-xs font-semibold uppercase text-gray-500">{integration.status}</span></div>
                      {integration.detail && <p className="mt-1 text-xs text-gray-500">{integration.detail}</p>}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="diagnostic-recent-runs">
              <h3 id="diagnostic-recent-runs" className="font-semibold text-gray-900 dark:text-gray-100">Recent runs</h3>
              {result.recentRuns.length === 0 ? <p className="mt-2 text-xs text-gray-500">No recent runs.</p> : (
                <div className="mt-2 space-y-2">
                  {result.recentRuns.map((run, index) => (
                    <div key={readable(run.id) + index} className="flex justify-between gap-3 border border-gray-200 p-3 text-xs dark:border-gray-800">
                      <span>{readable(run.id)}</span><span className="font-semibold uppercase text-gray-500">{readable(run.status)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      <footer className="border-t border-gray-200 p-4 dark:border-gray-800">
        <button
          type="button"
          onClick={onRun}
          disabled={busy || needsInitialSave}
          className="w-full bg-cyan-600 px-3 py-2 font-semibold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Running safe diagnostics…' : 'Run diagnostics'}
        </button>
      </footer>
    </aside>
  )
}
