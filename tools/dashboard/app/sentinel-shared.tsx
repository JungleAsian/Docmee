import { severityClass, type PlatformIssue } from './lib/sentinel-platform'
import { DetailButton } from './detail-button'

export function IssueList({ issues, emptyLabel }: { issues: PlatformIssue[]; emptyLabel: string }) {
  if (issues.length === 0) {
    return <div className="rounded-md border border-emerald-800 bg-emerald-950/20 p-4 text-sm text-emerald-200">{emptyLabel}</div>
  }
  return (
    <div className="space-y-3">
      {issues.map((issue) => (
        <article key={issue.id} className="rounded-md border border-slate-800 bg-slate-950/30 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded border px-2 py-1 text-xs ${severityClass(issue.severity)}`}>{issue.severity}</span>
                <span className="rounded bg-slate-900 px-2 py-1 text-xs text-slate-400">{issue.status.replace(/-/g, ' ')}</span>
                <span className="rounded bg-slate-900 px-2 py-1 text-xs text-slate-400">{issue.source}</span>
                {issue.checkName && <span className="rounded bg-slate-900 px-2 py-1 text-xs text-slate-500">{issue.checkName}</span>}
              </div>
              <h3 className="mt-3 text-base font-semibold text-slate-100">{issue.diagnosis}</h3>
              <p className="mt-2 text-sm text-slate-400">{issue.suggestedFix}</p>
            </div>
            <div className="min-w-[180px] rounded-md border border-slate-800 bg-slate-900 p-3 text-sm">
              <div className="text-xs text-slate-500">Route</div>
              <div className="mt-1 text-slate-200">{issue.assignedAgent}</div>
              <div className="mt-1 text-xs text-slate-500">{issue.assignedProvider}</div>
              <div className="mt-2 text-xs text-slate-500">Risk: {issue.riskLevel}</div>
            </div>
          </div>
          {issue.evidence.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-slate-400">
              {issue.evidence.slice(0, 4).map((e) => (
                <li key={e}>• {e}</li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span>Env: {issue.environment}</span>
            <span>Updated: {new Date(issue.updatedAt).toLocaleString()}</span>
            <span>{issue.requiresApproval ? 'Approval required' : 'Safe-fix eligible'}</span>
            <DetailButton
              buttonLabel="Full details"
              title={issue.diagnosis}
              body={`Suggested fix:\n${issue.suggestedFix}\n\nEvidence:\n${issue.evidence.length ? issue.evidence.map((e) => `• ${e}`).join('\n') : '(none)'}`}
            />
          </div>
        </article>
      ))}
    </div>
  )
}

export function SubsystemHeader({ title, emoji, scope, liveness, detail }: { title: string; emoji: string; scope: string; liveness: string; detail: string }) {
  const tone = liveness === 'running' ? 'text-emerald-300' : liveness === 'stale' ? 'text-amber-300' : liveness === 'not-configured' ? 'text-slate-400' : 'text-red-300'
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">
          {emoji} {title}
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">{scope}</p>
      </div>
      <div className="rounded-md border border-slate-800 bg-slate-900 px-4 py-2 text-sm">
        <div className="text-xs text-slate-500">Status</div>
        <div className={`mt-1 font-medium ${tone}`}>{liveness}</div>
        <div className="mt-1 text-xs text-slate-500">{detail}</div>
      </div>
    </div>
  )
}
