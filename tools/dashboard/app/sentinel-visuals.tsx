import {
  activeIssues,
  heartbeatAgeSeconds,
  heartbeatLiveness,
  readHeartbeat,
  readIssues,
  readProvider,
  readTunnel,
  summarize,
  type AuditEntry,
  type CheckRow,
  type Heartbeat,
  type IssueSource,
  type PlatformIssue
} from './lib/sentinel-platform'

type Tone = 'emerald' | 'amber' | 'red' | 'cyan' | 'slate'

export function SystemStatusBanner({ title, question, state, detail, tone }: { title: string; question: string; state: string; detail: string; tone?: Tone }) {
  const resolvedTone = tone ?? toneForState(state)
  return (
    <div className={`rounded-md border p-4 ${toneClass(resolvedTone)}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide opacity-70">{question}</div>
          <h2 className="mt-1 text-xl font-semibold text-slate-100">{title}</h2>
          <p className="mt-2 max-w-3xl text-sm opacity-80">{detail}</p>
        </div>
        <div className="rounded-md border border-white/10 bg-slate-950/30 px-3 py-2 text-right">
          <div className="text-xs opacity-70">Live status</div>
          <div className="mt-1 text-lg font-semibold capitalize">{state.replace(/-/g, ' ')}</div>
        </div>
      </div>
    </div>
  )
}

export function HeartbeatVisual({ label, heartbeat }: { label: string; heartbeat: Heartbeat }) {
  const liveness = heartbeatLiveness(heartbeat)
  const age = heartbeatAgeSeconds(heartbeat)
  const points =
    liveness === 'running'
      ? [8, 18, 18, 4, 31, 18, 18, 8, 18, 18, 5, 29, 18, 18]
    : liveness === 'stale'
      ? [15, 18, 18, 12, 22, 18, 18, 16, 18, 18, 14, 20, 18, 18]
      : liveness === 'not-configured'
        ? [18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18]
        : [18, 18, 18, 18, 18, 18, 18, 18, 18, 18]
  const path = points.map((y, i) => `${i === 0 ? 'M' : 'L'} ${8 + i * 18} ${y}`).join(' ')
  const gradientId = `${label.replace(/\W/g, '')}-pulse`
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{label} Heartbeat</h3>
          <p className="mt-1 text-xs text-slate-500">{liveness === 'not-configured' ? 'Subsystem is disabled in Sentinel config.' : age === null ? 'No heartbeat received yet.' : `Last update ${age}s ago.`}</p>
        </div>
        <span className={`rounded border px-2 py-1 text-xs capitalize ${toneClass(toneForState(liveness))}`}>{liveness}</span>
      </div>
      <svg className="mt-4 h-20 w-full rounded bg-slate-950" viewBox="0 0 260 42" role="img" aria-label={`${label} heartbeat graph`}>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="1">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor={liveness === 'running' ? '#34d399' : liveness === 'stale' ? '#f59e0b' : liveness === 'not-configured' ? '#64748b' : '#ef4444'} />
          </linearGradient>
        </defs>
        <path d="M0 18 H260" stroke="#1e293b" strokeWidth="1" />
        <path d={path} fill="none" stroke={`url(#${gradientId})`} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

export function EventTimeline({ title, audit, emptyLabel = 'No events recorded yet.' }: { title: string; audit: AuditEntry[]; emptyLabel?: string }) {
  const rows = audit.slice(-8).reverse()
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-4 space-y-3">
        {rows.map((entry, index) => (
          <div key={`${entry.createdAt ?? entry.ts ?? index}-${entry.action ?? index}`} className="grid grid-cols-[0.75rem_1fr] gap-3">
            <span className={`mt-1 h-3 w-3 rounded-full ${entry.outcome === 'fail' || entry.outcome === 'error' ? 'bg-red-400' : entry.outcome === 'warn' ? 'bg-amber-400' : 'bg-cyan-300'}`} />
            <div className="min-w-0 border-b border-slate-800 pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>
                  {entry.subsystem ?? 'sentinel'} · {entry.action ?? 'event'}
                </span>
                <span>{formatTime(entry.createdAt ?? entry.ts)}</span>
              </div>
              <p className="mt-1 break-words text-sm text-slate-300">{entry.message ?? entry.outcome ?? 'No details provided.'}</p>
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="rounded-md border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-500">{emptyLabel}</div>}
      </div>
    </div>
  )
}

export function BlockerPanel({ issues, title = 'Current Blockers' }: { issues: PlatformIssue[]; title?: string }) {
  const current = activeIssues(issues)
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-4 space-y-2">
        {current.slice(0, 5).map((issue) => (
          <a key={issue.id} href={`/sentinel?filter=${encodeURIComponent(issue.id)}`} className="block rounded-md border border-slate-800 bg-slate-950/40 p-3 hover:border-cyan-500/60">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded border px-2 py-0.5 text-xs ${issue.severity === 'critical' ? 'border-red-800 text-red-200' : issue.severity === 'warning' ? 'border-amber-800 text-amber-200' : 'border-cyan-800 text-cyan-200'}`}>{issue.severity}</span>
              <span className="text-xs text-slate-500">{issue.source}</span>
            </div>
            <div className="mt-2 text-sm text-slate-200">{issue.diagnosis}</div>
          </a>
        ))}
        {current.length === 0 && <div className="rounded-md border border-emerald-800 bg-emerald-950/20 p-3 text-sm text-emerald-200">No active blockers.</div>}
      </div>
    </div>
  )
}

export function NextActionPanel({ title, actions }: { title?: string; actions: string[] }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-semibold">{title ?? 'Recovery / Next Action'}</h3>
      <ol className="mt-4 space-y-2 text-sm text-slate-300">
        {actions.map((action, index) => (
          <li key={action} className="flex gap-3 rounded-md border border-slate-800 bg-slate-950/30 p-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-cyan-500/15 text-xs text-cyan-200">{index + 1}</span>
            <span>{action}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function EndpointStatusTable() {
  const tunnel = readTunnel()
  const endpoints = [
    { name: 'Local DevTool', url: 'http://127.0.0.1:4000', status: 'configured' },
    { name: 'Local Docmee', url: 'http://127.0.0.1:3000', status: 'configured' },
    { name: 'App URL', url: tunnel.appUrl || 'Not set', status: tunnel.appUrl ? 'configured' : 'missing' },
    { name: 'API URL', url: tunnel.apiUrl || 'Not set', status: tunnel.apiUrl ? 'configured' : 'missing' },
    { name: 'Webhook URL', url: tunnel.webhookUrl || 'Not set', status: tunnel.webhookUrl ? 'configured' : 'missing' }
  ]
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-semibold">Service Availability Map</h3>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="border-b border-slate-800 px-3 py-2">Service</th>
              <th className="border-b border-slate-800 px-3 py-2">Access path</th>
              <th className="border-b border-slate-800 px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((endpoint) => (
              <tr key={endpoint.name} className="border-b border-slate-800/70">
                <td className="px-3 py-2 text-slate-200">{endpoint.name}</td>
                <td className="break-all px-3 py-2 text-slate-400">{endpoint.url}</td>
                <td className={endpoint.status === 'configured' ? 'px-3 py-2 text-emerald-300' : 'px-3 py-2 text-amber-300'}>{endpoint.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function BuildPipelineView() {
  const issues = issuesBySourceSafe('forge')
  const summary = summarize(issues)
  const steps = [
    { label: 'Queued', value: Math.max(summary.active, 0), tone: 'slate' as Tone },
    { label: 'Running', value: readHeartbeat('forge').status === 'normal' ? 1 : 0, tone: 'cyan' as Tone },
    { label: 'Completed', value: 0, tone: 'emerald' as Tone },
    { label: 'Failed', value: summary.critical, tone: 'red' as Tone }
  ]
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-semibold">Build Pipeline Flow</h3>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        {steps.map((step) => (
          <div key={step.label} className={`rounded-md border p-3 ${toneClass(step.tone)}`}>
            <div className="text-xs opacity-70">{step.label}</div>
            <div className="mt-2 text-2xl font-semibold">{step.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function GateReadinessMatrix({ checks }: { checks: CheckRow[] }) {
  const groups = groupCounts(checks)
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-semibold">Gate Readiness Matrix</h3>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {groups.map((group) => (
          <div key={group.label} className="rounded-md border border-slate-800 bg-slate-950/40 p-3">
            <div className="text-sm font-medium text-slate-200">{group.label}</div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded bg-emerald-950/30 p-2 text-emerald-200">{group.pass} pass</div>
              <div className="rounded bg-amber-950/30 p-2 text-amber-200">{group.warn} warn</div>
              <div className="rounded bg-red-950/30 p-2 text-red-200">{group.fail} fail</div>
            </div>
          </div>
        ))}
        {groups.length === 0 && <div className="rounded-md border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-500">No readiness checks recorded yet.</div>}
      </div>
    </div>
  )
}

export function IncidentRecoveryView({ audit }: { audit: AuditEntry[] }) {
  const recovery = audit.filter((entry) => /recover|restart|resume|rollback|pause/i.test(`${entry.action ?? ''} ${entry.message ?? ''}`)).slice(-8).reverse()
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-semibold">Recovery Attempts</h3>
      <div className="mt-4 space-y-2">
        {recovery.map((entry, index) => (
          <div key={`${entry.createdAt ?? entry.ts ?? index}`} className="flex items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-950/40 p-3 text-sm">
            <div className="min-w-0">
              <div className="text-slate-200">{entry.action ?? 'Recovery event'}</div>
              <div className="mt-1 truncate text-xs text-slate-500">{entry.message ?? entry.outcome ?? 'No details'}</div>
            </div>
            <span className="shrink-0 text-xs text-slate-500">{formatTime(entry.createdAt ?? entry.ts)}</span>
          </div>
        ))}
        {recovery.length === 0 && <div className="rounded-md border border-emerald-800 bg-emerald-950/20 p-3 text-sm text-emerald-200">No recovery attempts recorded.</div>}
      </div>
    </div>
  )
}

export function DecisionBoard() {
  const provider = readProvider()
  const issues = activeIssues(readIssues())
  const recommendations = [
    issues.length > 0 ? 'Open the highest severity blocker and resolve it before continuing deployment.' : 'No blockers are active; continue with the next development or deployment stage.',
    `Current AI provider is ${provider}. Use Codex Switch or Claude Switch before starting long work if the wrong account is active.`,
    'Keep Notion and GitHub updated after every completed feature or deployment change.'
  ]
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-semibold">Recommendation Panel</h3>
      <div className="mt-4 space-y-2">
        {recommendations.map((item) => (
          <div key={item} className="rounded-md border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-300">
            {item}
          </div>
        ))}
      </div>
    </div>
  )
}

export function WorkQueuePriorityBoard() {
  const issues = activeIssues(readIssues()).slice(0, 8)
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-semibold">Work Queue Priority Board</h3>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {['critical', 'warning', 'info'].map((severity) => (
          <div key={severity} className="rounded-md border border-slate-800 bg-slate-950/40 p-3">
            <div className="text-xs font-semibold uppercase text-slate-500">{severity}</div>
            <div className="mt-3 space-y-2">
              {issues
                .filter((issue) => issue.severity === severity)
                .map((issue) => (
                  <div key={issue.id} className="rounded border border-slate-800 bg-slate-900 p-2 text-xs text-slate-300">
                    {issue.diagnosis}
                  </div>
                ))}
              {issues.filter((issue) => issue.severity === severity).length === 0 && <div className="text-xs text-slate-600">No items</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function issuesBySourceSafe(source: IssueSource) {
  return readIssues().filter((issue) => issue.source === source)
}

function groupCounts(checks: CheckRow[]) {
  const names = Array.from(new Set(checks.map((check) => check.category)))
  return names.map((name) => {
    const rows = checks.filter((check) => check.category === name)
    return {
      label: name.replace(/-/g, ' '),
      pass: rows.filter((row) => row.status === 'pass').length,
      warn: rows.filter((row) => row.status === 'warn').length,
      fail: rows.filter((row) => row.status === 'fail').length
    }
  })
}

function toneForState(state: string): Tone {
  if (state === 'running' || state === 'configured' || state === 'ready') return 'emerald'
  if (state === 'stale' || state === 'checking' || state === 'not-configured') return 'amber'
  if (state === 'offline' || state === 'failed' || state === 'dead') return 'red'
  if (state === 'active') return 'cyan'
  return 'slate'
}

function toneClass(tone: Tone) {
  if (tone === 'emerald') return 'border-emerald-800 bg-emerald-950/20 text-emerald-200'
  if (tone === 'amber') return 'border-amber-800 bg-amber-950/20 text-amber-200'
  if (tone === 'red') return 'border-red-800 bg-red-950/20 text-red-200'
  if (tone === 'cyan') return 'border-cyan-800 bg-cyan-950/20 text-cyan-200'
  return 'border-slate-800 bg-slate-900 text-slate-200'
}

function formatTime(value?: string) {
  if (!value) return 'no time'
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return value
  return new Date(parsed).toLocaleString()
}
