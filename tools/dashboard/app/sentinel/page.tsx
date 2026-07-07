import fs from 'node:fs'
import path from 'node:path'
import Link from 'next/link'
import {
  readIssues,
  activeIssues,
  summarize,
  readHeartbeat,
  heartbeatLiveness,
  readTray,
  readAudit,
  readTunnel,
  readProvider,
  livenessClass,
  type PlatformIssue,
  type AuditEntry
} from '../lib/sentinel-platform'
import { CompactSection } from '../compact-ui'
import { IssueList } from '../sentinel-shared'
import { AutoRefresh } from '../auto-refresh'
import { BuildProgressGauge } from '../build-progress-gauge'
import { LaneItemGauge } from '../lane-item-gauge'

type LaneTone = 'slate' | 'cyan' | 'amber' | 'sky' | 'emerald' | 'red' | 'violet'

// Map a subsystem liveness string to a 0-100 health percent + matching gauge tone.
function subsystemHealth(state: string): { percent: number; tone: LaneTone } {
  if (state === 'running' || state === 'normal') return { percent: 100, tone: 'emerald' }
  if (state === 'not-configured') return { percent: 0, tone: 'slate' }
  if (state === 'stale' || state === 'delayed') return { percent: 50, tone: 'amber' }
  return { percent: 0, tone: 'red' }
}

export const dynamic = 'force-dynamic'

type Filter = 'all' | 'production' | 'build' | 'approval' | 'devtools'
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'production', label: 'Production' },
  { id: 'build', label: 'Build' },
  { id: 'approval', label: 'Approval' },
  { id: 'devtools', label: 'DevTools' }
]

const daemonPidFile = path.join(process.cwd(), '..', 'logs', 'sentinel-daemon.pid')

function daemonStatus(): { running: boolean; pid: number | null } {
  try {
    const pid = Number(fs.readFileSync(daemonPidFile, 'utf8').trim())
    if (!Number.isInteger(pid)) return { running: false, pid: null }
    try {
      process.kill(pid, 0)
      return { running: true, pid }
    } catch {
      return { running: false, pid }
    }
  } catch {
    return { running: false, pid: null }
  }
}

function applyFilter(issues: PlatformIssue[], filter: Filter): PlatformIssue[] {
  if (filter === 'production') return issues.filter((i) => i.environment === 'production')
  if (filter === 'build') return issues.filter((i) => i.source === 'forge' || i.environment === 'development')
  if (filter === 'approval') return issues.filter((i) => i.requiresApproval || i.status === 'waiting-approval')
  if (filter === 'devtools') return issues.filter((i) => i.source === 'devtools-healer' || i.checkName === 'devtools-dashboard')
  return issues
}

export default function SentinelPage({ searchParams }: { searchParams?: { filter?: string; message?: string; error?: string } }) {
  const filter = (FILTERS.find((f) => f.id === searchParams?.filter)?.id ?? 'all') as Filter
  const daemon = daemonStatus()
  const all = readIssues()
  const active = activeIssues(all)
  const summary = summarize(all)
  const tray = readTray()
  const audit = readAudit()
  const tunnel = readTunnel()
  const provider = readProvider()
  const filtered = applyFilter(active, filter)

  const subsystems = [
    { name: 'Beacon', emoji: '🔆', state: tray.state ? 'running' : 'offline', href: '/sentinel', detail: tray.statusLine ?? tray.state ?? 'tray status' },
    { name: 'Forge', emoji: '🔥', state: heartbeatLiveness(readHeartbeat('forge')), href: '/forge', detail: readHeartbeat('forge').timestamp ?? 'no heartbeat' },
    { name: 'Guardian', emoji: '🛡', state: heartbeatLiveness(readHeartbeat('guardian')), href: '/guardian', detail: readHeartbeat('guardian').timestamp ?? 'no heartbeat' },
    { name: 'Aegis', emoji: '⚔️', state: heartbeatLiveness(readHeartbeat('aegis')), href: '/aegis', detail: readHeartbeat('aegis').timestamp ?? 'no heartbeat' },
    { name: 'Cortex', emoji: '🧠', state: 'running', href: '/cortex', detail: provider }
  ]
  const dependencies = dependencyNodes(subsystems, tunnel, summary)

  // Overall platform health, derived only from values the page already computes:
  // share of healthy subsystems, gated down by open critical/active issues.
  const healthySubsystems = subsystems.filter((s) => s.state === 'running' || s.state === 'normal').length
  const subsystemPercent = subsystems.length > 0 ? Math.round((healthySubsystems / subsystems.length) * 100) : 0
  const overallPercent = summary.critical > 0 ? 0 : summary.active > 0 ? Math.min(subsystemPercent, 60) : subsystemPercent
  const runActive = audit.some((entry) => (entry.outcome ?? '').toLowerCase() === 'running' || (entry.action ?? '').toLowerCase().includes('running'))
  const overallState: 'complete' | 'progressing' | 'halted' | 'stopped' =
    summary.critical > 0 || summary.active > 0
      ? 'halted'
      : runActive
        ? 'progressing'
        : healthySubsystems === subsystems.length && daemon.running
          ? 'complete'
          : 'stopped'
  const overallMessage = summary.critical > 0
    ? `${summary.critical} critical · ${summary.active} active`
    : summary.active > 0
      ? `${summary.active} active issue${summary.active === 1 ? '' : 's'}`
      : `${healthySubsystems}/${subsystems.length} subsystems healthy`

  return (
    <section className="w-full space-y-6">
      <AutoRefresh seconds={15} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">🛡️ Sentinel</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            The intelligence platform for Docmee. Beacon watches it all. Forge builds it. Guardian runs it. Aegis protects it. Cortex directs it. Runs as an independent daemon — this dashboard is a read-only client of its log files.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <BuildProgressGauge
            size="sm"
            percent={overallPercent}
            state={overallState}
            label="Platform health"
            message={overallMessage}
          />
          <a href="/sentinel-pwa/index.html" className="min-h-11 rounded-md border border-cyan-700 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-950/40">
            Open Mobile PWA
          </a>
        </div>
      </div>

      {searchParams?.message && <p className="rounded-md border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-200">{searchParams.message}</p>}
      {searchParams?.error && <p className="rounded-md border border-red-800 bg-red-950/30 p-3 text-sm text-red-200">{searchParams.error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-900 p-4">
        <div className="flex items-center gap-3">
          <span className={`h-2.5 w-2.5 rounded-full ${daemon.running ? 'bg-emerald-400' : 'bg-red-400'}`} aria-hidden="true" />
          <div>
            <div className="text-sm font-semibold">Sentinel daemon: <span className={daemon.running ? 'text-emerald-300' : 'text-red-300'}>{daemon.running ? 'Running' : 'Stopped'}</span></div>
            <div className="text-xs text-slate-500">{daemon.pid ? `pid ${daemon.pid}` : 'no pid recorded'} · independent supervision process</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action="/api/sentinel/control" method="post">
            <input type="hidden" name="action" value="start" />
            <button disabled={daemon.running} className="min-h-11 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">Start</button>
          </form>
          <form action="/api/sentinel/control" method="post">
            <input type="hidden" name="action" value="restart" />
            <button className="min-h-11 rounded-md border border-cyan-700 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-950/40">Restart</button>
          </form>
          <form action="/api/sentinel/control" method="post">
            <input type="hidden" name="action" value="stop" />
            <button disabled={!daemon.running} className="min-h-11 rounded-md border border-red-700 px-4 py-2 text-sm text-red-200 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500">Stop</button>
          </form>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        {subsystems.map((s) => {
          const health = subsystemHealth(s.state)
          return (
            <Link key={s.name} href={s.href} className={`rounded-md border p-4 ${livenessClass(s.state)}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">
                  {s.emoji} {s.name}
                </div>
                <LaneItemGauge percent={health.percent} tone={health.tone} title={`${s.name} · ${s.state}`} />
              </div>
              <div className="mt-1 text-xs capitalize opacity-80">{s.state}</div>
            </Link>
          )
        })}
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Active" value={summary.active} />
        <Stat label="Critical" value={summary.critical} tone="red" />
        <Stat label="Warnings" value={summary.warning} tone="amber" />
        <Stat label="Needs approval" value={summary.approval} />
      </div>

      <CompactSection title="Sentinel Visualizations" subtitle="Health timeline, heartbeat ECG, issue funnel, risk heatmap, agent activity, recovery attempts, and dependency graph." badge={<span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">7 graphs</span>}>
        <div className="grid gap-4 xl:grid-cols-2">
          <HealthTimeline audit={audit} subsystems={subsystems} />
          <HeartbeatPanel subsystems={subsystems} />
          <IssueFunnel issues={active} />
          <RiskHeatmap issues={active} />
          <AgentActivityMap audit={audit} subsystems={subsystems} />
          <RecoveryAttempts audit={audit} />
        </div>
        <div className="mt-4">
          <DependencyGraph nodes={dependencies} />
        </div>
      </CompactSection>

      <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <Link
              key={f.id}
              href={`/sentinel?filter=${f.id}`}
              className={`rounded-md border px-3 py-1.5 text-sm ${f.id === filter ? 'border-cyan-500/60 bg-cyan-950/30 text-cyan-100' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <IssueList issues={filtered} emptyLabel="No issues in this view." />
      </div>

      <CompactSection title="Tunnel & Access" subtitle="Public URL mode, app URL, webhook URL, and current provider.">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Tunnel & Access</h2>
          <Link href="/settings" className="text-xs text-cyan-300 hover:underline">
            Tunnel Settings →
          </Link>
        </div>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <div>
            <span className="text-slate-500">Mode:</span> <span className="text-slate-200">{tunnel.activeMode}</span>
          </div>
          <div>
            <span className="text-slate-500">Provider:</span> <span className="text-slate-200">{provider}</span>
          </div>
          <div className="truncate">
            <span className="text-slate-500">App:</span> <span className="text-slate-300">{tunnel.appUrl || '—'}</span>
          </div>
          <div className="truncate">
            <span className="text-slate-500">Webhook:</span> <span className="text-slate-300">{tunnel.webhookUrl || '—'}</span>
          </div>
        </div>
        {tunnel.webhookReminderPending && <p className="mt-3 text-xs text-amber-300">⚠️ WhatsApp webhook changed — update it in the Meta dashboard.</p>}
      </CompactSection>
    </section>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'red' | 'amber' }) {
  const cls = tone === 'red' ? 'border-red-800 bg-red-950/20 text-red-200' : tone === 'amber' ? 'border-amber-800 bg-amber-950/20 text-amber-200' : 'border-slate-800 bg-slate-900 text-slate-100'
  return (
    <div className={`rounded-md border p-4 ${cls}`}>
      <div className="text-xs opacity-70">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  )
}

type SubsystemView = { name: string; emoji: string; state: string; href: string; detail: string }
type DependencyNode = { id: string; label: string; state: string; group: string }

function stateTone(state: string) {
  if (state === 'running' || state === 'normal') return 'bg-emerald-400'
  if (state === 'not-configured') return 'bg-slate-500'
  if (state === 'stale' || state === 'delayed') return 'bg-amber-400'
  return 'bg-red-400'
}

function textTone(state: string) {
  if (state === 'running' || state === 'normal') return 'text-emerald-300'
  if (state === 'not-configured') return 'text-slate-500'
  if (state === 'stale' || state === 'delayed') return 'text-amber-300'
  return 'text-red-300'
}

function auditTime(entry: AuditEntry) {
  return entry.createdAt ?? entry.ts ?? ''
}

function HealthTimeline({ audit, subsystems }: { audit: AuditEntry[]; subsystems: SubsystemView[] }) {
  const recent = audit.slice(0, 18).reverse()
  const points = recent.length > 0
    ? recent.map((entry) => ({ label: auditTime(entry), issues: entry.issueCount ?? 0, outcome: entry.outcome ?? 'info' }))
    : subsystems.map((s) => ({ label: s.name, issues: s.state === 'running' ? 0 : 1, outcome: s.state }))
  const max = Math.max(1, ...points.map((p) => p.issues))

  return (
    <section className="rounded-md border border-slate-800 bg-slate-900 p-4">
      <h2 className="text-sm font-semibold">System Health Timeline</h2>
      <p className="mt-1 text-xs text-slate-500">Recent Sentinel scans and issue counts.</p>
      <div className="mt-4 flex h-36 items-end gap-1">
        {points.map((point, index) => (
          <div key={`${point.label}-${index}`} className="flex min-w-0 flex-1 flex-col items-center gap-2">
            <div
              className={`w-full rounded-t ${point.issues === 0 ? 'bg-emerald-500/70' : point.issues > 1 ? 'bg-red-500/80' : 'bg-amber-500/80'}`}
              style={{ height: `${Math.max(8, (point.issues / max) * 110)}px` }}
              title={`${point.issues} issue(s)`}
            />
            <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
        <span>Older</span>
        <span>Now</span>
      </div>
    </section>
  )
}

function ecgPath(state: string, index: number) {
  const offset = (index % 3) * 4
  return state === 'running'
    ? 'M0 28 L16 28 L22 10 L28 44 L36 28 L56 28 L62 17 L68 36 L76 28 L100 28'
    : state === 'stale'
      ? `M0 ${32 + offset} L18 ${32 + offset} L24 ${22 + offset} L30 ${40 + offset} L38 ${32 + offset} L60 ${32 + offset} L70 ${32 + offset} L100 ${32 + offset}`
      : state === 'not-configured'
        ? `M0 ${34 + offset} L22 ${34 + offset} L44 ${34 + offset} L66 ${34 + offset} L88 ${34 + offset} L100 ${34 + offset}`
      : `M0 ${36 + offset} L28 ${36 + offset} L56 ${36 + offset} L84 ${36 + offset} L100 ${36 + offset}`
}

function HeartbeatPanel({ subsystems }: { subsystems: SubsystemView[] }) {
  return (
    <section className="rounded-md border border-slate-800 bg-slate-900 p-4">
      <h2 className="text-sm font-semibold">Heartbeat ECG</h2>
      <p className="mt-1 text-xs text-slate-500">Per-subsystem liveness strip.</p>
      <div className="mt-4 space-y-3">
        {subsystems.map((s, index) => (
          <div key={s.name} className="grid grid-cols-[88px_1fr_72px] items-center gap-3">
            <div className="truncate text-sm text-slate-300">{s.emoji} {s.name}</div>
            <svg viewBox="0 0 100 56" className="h-10 w-full rounded border border-slate-800 bg-slate-950">
              <path d="M0 28 H100" stroke="currentColor" className="text-slate-800" strokeWidth="1" />
              <path d={ecgPath(s.state, index)} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`${textTone(s.state)} ${s.state === 'running' ? 'ecg-trace-live' : ''}`} />
            </svg>
            <div className={`text-right text-xs capitalize ${textTone(s.state)}`}>{s.state === 'not-configured' ? 'standby' : s.state}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function IssueFunnel({ issues }: { issues: PlatformIssue[] }) {
  const stages = [
    ['Detected', issues.filter((i) => i.status === 'detected').length],
    ['Assigned', issues.filter((i) => i.status === 'assigned').length],
    ['Fixing', issues.filter((i) => i.status === 'fixing').length],
    ['Approval', issues.filter((i) => i.status === 'waiting-approval' || i.requiresApproval).length],
    ['Failed', issues.filter((i) => i.status === 'failed').length]
  ] as const
  const max = Math.max(1, ...stages.map(([, count]) => count))
  return (
    <section className="rounded-md border border-slate-800 bg-slate-900 p-4">
      <h2 className="text-sm font-semibold">Issue Funnel</h2>
      <p className="mt-1 text-xs text-slate-500">Detected to action state.</p>
      <div className="mt-4 space-y-3">
        {stages.map(([label, count]) => (
          <div key={label}>
            <div className="mb-1 flex justify-between text-xs"><span>{label}</span><span className="text-slate-400">{count}</span></div>
            <div className="h-3 rounded bg-slate-950">
              <div className="h-3 rounded bg-cyan-500" style={{ width: `${Math.max(4, (count / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function RiskHeatmap({ issues }: { issues: PlatformIssue[] }) {
  const rows = ['deployment', 'heartbeat', 'dashboard', 'discord', 'notion', 'ready', 'gate', 'git', 'tunnel']
  const severities = ['info', 'warning', 'critical'] as const
  function count(row: string, severity: string) {
    return issues.filter((issue) => `${issue.category} ${issue.checkName ?? ''} ${issue.source}`.toLowerCase().includes(row) && issue.severity === severity).length
  }
  return (
    <section className="rounded-md border border-slate-800 bg-slate-900 p-4">
      <h2 className="text-sm font-semibold">Risk Heatmap</h2>
      <p className="mt-1 text-xs text-slate-500">Issue concentration by area and severity.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead><tr><th className="p-2 text-slate-500">Area</th>{severities.map((s) => <th key={s} className="p-2 capitalize text-slate-500">{s}</th>)}</tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row} className="border-t border-slate-800">
                <td className="p-2 capitalize text-slate-300">{row}</td>
                {severities.map((severity) => {
                  const value = count(row, severity)
                  const color = value === 0 ? 'bg-slate-950 text-slate-600' : severity === 'critical' ? 'bg-red-500/30 text-red-100' : severity === 'warning' ? 'bg-amber-500/30 text-amber-100' : 'bg-cyan-500/30 text-cyan-100'
                  return <td key={severity} className="p-2"><span className={`grid h-8 min-w-8 place-items-center rounded ${color}`}>{value}</span></td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function AgentActivityMap({ audit, subsystems }: { audit: AuditEntry[]; subsystems: SubsystemView[] }) {
  const lanes = ['beacon', 'forge', 'guardian', 'aegis', 'cortex', 'executor', 'healer']
  return (
    <section className="rounded-md border border-slate-800 bg-slate-900 p-4">
      <h2 className="text-sm font-semibold">Agent Activity Map</h2>
      <p className="mt-1 text-xs text-slate-500">Recent actions by Sentinel component.</p>
      <div className="mt-4 space-y-3">
        {lanes.map((lane) => {
          const events = audit.filter((entry) => (entry.subsystem ?? '').toLowerCase() === lane).slice(0, 5)
          const fallback = subsystems.find((s) => s.name.toLowerCase() === lane)
          return (
            <div key={lane} className="grid gap-2 md:grid-cols-[96px_1fr]">
              <div className="text-sm capitalize text-slate-300">{lane}</div>
              <div className="flex flex-wrap gap-2">
                {events.length > 0 ? events.map((event, index) => (
                  <span key={`${lane}-${index}`} className={`rounded border px-2 py-1 text-xs ${event.outcome === 'failed' ? 'border-red-800 bg-red-950/30 text-red-200' : event.outcome === 'success' ? 'border-emerald-800 bg-emerald-950/30 text-emerald-200' : 'border-slate-700 bg-slate-950 text-slate-300'}`}>
                    {event.action ?? 'activity'}
                  </span>
                )) : (
                  <span className={`rounded border px-2 py-1 text-xs ${fallback ? textTone(fallback.state) : 'text-slate-500'} border-slate-800 bg-slate-950`}>
                    {fallback?.state ?? 'no recent activity'}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function RecoveryAttempts({ audit }: { audit: AuditEntry[] }) {
  const events = audit.filter((entry) => /healer|recovery|restore|restart|attempt/i.test(`${entry.subsystem ?? ''} ${entry.action ?? ''} ${entry.message ?? ''}`)).slice(0, 10)
  const success = events.filter((e) => e.outcome === 'success').length
  const failed = events.filter((e) => e.outcome === 'failed' || e.outcome === 'escalated').length
  const total = Math.max(1, events.length)
  return (
    <section className="rounded-md border border-slate-800 bg-slate-900 p-4">
      <h2 className="text-sm font-semibold">Recovery Attempts</h2>
      <p className="mt-1 text-xs text-slate-500">Auto-heal and recovery history.</p>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="Attempts" value={events.length} />
        <Stat label="Recovered" value={success} />
        <Stat label="Failed" value={failed} tone={failed > 0 ? 'red' : undefined} />
      </div>
      <div className="mt-4 flex h-3 overflow-hidden rounded bg-slate-950">
        <div className="bg-emerald-500" style={{ width: `${(success / total) * 100}%` }} />
        <div className="bg-red-500" style={{ width: `${(failed / total) * 100}%` }} />
      </div>
      <div className="mt-3 space-y-2">
        {events.slice(0, 4).map((event, index) => (
          <div key={`${event.message}-${index}`} className="truncate rounded border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
            {event.action ?? 'recovery'} · {event.message ?? 'No message'}
          </div>
        ))}
        {events.length === 0 && <p className="text-xs text-slate-500">No recovery attempts recorded.</p>}
      </div>
    </section>
  )
}

function dependencyNodes(subsystems: SubsystemView[], tunnel: { activeMode: string; appUrl: string; apiUrl: string; devtoolsUrl: string; webhookUrl: string }, summary: { active: number }): DependencyNode[] {
  const subsystemNodes = subsystems.map((s) => ({ id: s.name.toLowerCase(), label: s.name, state: s.state, group: 'Sentinel' }))
  return [
    { id: 'devtools', label: 'DevTools', state: 'running', group: 'Console' },
    ...subsystemNodes,
    { id: 'docmee', label: 'Docmee App', state: tunnel.appUrl ? 'running' : 'not-configured', group: 'Product' },
    { id: 'vps', label: 'VPS/Public URL', state: tunnel.activeMode === 'none' ? 'not-configured' : 'running', group: 'Deploy' },
    { id: 'discord', label: 'Discord', state: summary.active > 0 ? 'stale' : 'running', group: 'Notify' },
    { id: 'notion', label: 'Notion', state: 'running', group: 'Record' }
  ]
}

function DependencyGraph({ nodes }: { nodes: DependencyNode[] }) {
  const links = [
    ['devtools', 'beacon'], ['beacon', 'forge'], ['beacon', 'guardian'], ['beacon', 'aegis'], ['beacon', 'cortex'],
    ['forge', 'docmee'], ['guardian', 'vps'], ['aegis', 'docmee'], ['cortex', 'discord'], ['cortex', 'notion']
  ]
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return (
    <section className="rounded-md border border-slate-800 bg-slate-900 p-4">
      <h2 className="text-sm font-semibold">Dependency Graph</h2>
      <p className="mt-1 text-xs text-slate-500">How Sentinel supervision connects to DevTools, Docmee, and external services.</p>
      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-5 gap-3">
            {nodes.map((node) => (
              <div key={node.id} className="rounded-md border border-slate-800 bg-slate-950/50 p-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${stateTone(node.state)}`} />
                  <span className="text-sm font-medium text-slate-100">{node.label}</span>
                </div>
                <div className="mt-1 text-xs text-slate-500">{node.group} · <span className={textTone(node.state)}>{node.state}</span></div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
            {links.map(([from, to]) => (
              <span key={`${from}-${to}`} className="rounded border border-slate-800 bg-slate-950 px-2 py-1">
                {byId.get(from)?.label ?? from} → {byId.get(to)?.label ?? to}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
