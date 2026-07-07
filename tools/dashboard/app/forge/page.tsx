import { issuesBySource, activeIssues, summarize, readHeartbeat, heartbeatLiveness, heartbeatAgeSeconds, readAudit, readFeatureRun, featureRunProcessState, frontendCoverageSummary, livenessClass } from '../lib/sentinel-platform'
import { CompactSection } from '../compact-ui'
import { IssueList, SubsystemHeader } from '../sentinel-shared'
import { BlockerPanel, BuildPipelineView, EventTimeline, HeartbeatVisual, NextActionPanel, SystemStatusBanner } from '../sentinel-visuals'
import { AutoRefresh } from '../auto-refresh'
import { BuildProgressGauge } from '../build-progress-gauge'
import { LaneItemGauge } from '../lane-item-gauge'

export const dynamic = 'force-dynamic'

export default function ForgePage() {
  const issues = issuesBySource('forge')
  const active = activeIssues(issues)
  const summary = summarize(issues)
  const hb = readHeartbeat('forge')
  const liveness = heartbeatLiveness(hb)
  const age = heartbeatAgeSeconds(hb)
  const featureRun = readFeatureRun()
  const featureProcess = featureRunProcessState(featureRun)
  const frontendCoverage = frontendCoverageSummary()

  const coveragePercent = frontendCoverage.total > 0 ? Math.round((frontendCoverage.complete / frontendCoverage.total) * 100) : 0
  const forgeState: 'complete' | 'progressing' | 'halted' | 'stopped' =
    featureRun.status === 'failed'
      ? 'halted'
      : frontendCoverage.total > 0 && frontendCoverage.open === 0
        ? 'complete'
        : ['starting', 'running', 'paused'].includes(featureRun.status ?? '')
          ? 'progressing'
          : 'stopped'

  return (
    <section className="w-full space-y-6">
      <AutoRefresh seconds={15} />
      <SubsystemHeader
        title="Forge"
        emoji="🔥"
        scope="Build-time intelligence — phases, gates, Claude sessions, DevTool signals, prompts, GitHub. Forge builds it."
        liveness={liveness}
        detail={age === null ? 'no heartbeat' : `heartbeat ${age}s ago`}
      />

      <SystemStatusBanner
        title="Forge Build Intelligence"
        question="Is work progressing?"
        state={liveness}
        detail="Forge watches build phases, development execution, GitHub handoff, provider sessions, and development cost signals."
      />

      <div className="flex flex-wrap items-center gap-4 rounded-md border border-slate-800 bg-slate-900 p-4">
        <BuildProgressGauge
          size="sm"
          percent={coveragePercent}
          state={forgeState}
          label="Frontend coverage"
          message={`${frontendCoverage.complete}/${frontendCoverage.total} screens complete`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <HeartbeatVisual label="Forge" heartbeat={hb} />
        <BuildPipelineView />
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Active" value={summary.active} tone="slate" />
        <Stat label="Critical" value={summary.critical} tone="red" />
        <Stat label="Warnings" value={summary.warning} tone="amber" />
        <Stat label="Needs approval" value={summary.approval} tone="slate" />
      </div>

      <FeatureRunInsight run={featureRun} processState={featureProcess} coverage={frontendCoverage} />

      <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-4 text-sm font-semibold">Forge Issue Queue</h2>
        <IssueList issues={active} emptyLabel="No active Forge issues. Run pnpm tool forge scan to refresh." />
      </div>

      <CompactSection title="Build Events, Blockers, and Next Actions" subtitle="Detailed Forge event history and build guidance.">
        <div className="grid gap-4 xl:grid-cols-2">
          <EventTimeline title="Recent Build Events" audit={readAudit().filter((entry) => /forge|build|phase|github|commit/i.test(`${entry.subsystem ?? ''} ${entry.action ?? ''} ${entry.message ?? ''}`))} />
          <BlockerPanel issues={issues} title="Build Blockers" />
        </div>
        <div className="mt-4">
          <NextActionPanel
            actions={[
              'Start with Ready Check before any automated build or feature development run.',
              'If Forge is stale, open Build Control and refresh the active development process.',
              'After completion, commit and push the finished feature before moving to deployment.'
            ]}
          />
        </div>
      </CompactSection>
    </section>
  )
}

function FeatureRunInsight({ run, processState, coverage }: { run: ReturnType<typeof readFeatureRun>; processState: ReturnType<typeof featureRunProcessState>; coverage: ReturnType<typeof frontendCoverageSummary> }) {
  const active = ['starting', 'running', 'paused'].includes(run.status ?? '')
  const heartbeatAge = run.heartbeatAt ? Math.max(0, Math.round((Date.now() - Date.parse(run.heartbeatAt)) / 1000)) : null
  const state =
    run.status === 'failed' || (run.status === 'stopped' && coverage.open > 0) || (active && processState !== 'alive')
      ? 'offline'
      : heartbeatAge !== null && active && heartbeatAge > 180
        ? 'stale'
        : run.status === 'complete' && coverage.open === 0
          ? 'running'
          : 'not-configured'
  const processLabel = processState === 'alive' ? 'process alive' : processState === 'not-running' ? 'process not running' : 'process unknown'
  const detail = run.workflow ? `${run.workflow} · ${run.status ?? 'unknown'} · ${processLabel}` : 'No feature run has been recorded yet.'

  return (
    <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-sm font-semibold">Feature Development Watch</h2>
          <p className="mt-1 text-sm text-slate-400">{detail}</p>
        </div>
        <span className={`rounded-md border px-2.5 py-1 text-xs ${livenessClass(state)}`}>{state}</span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <MiniStat label="Workflow" value={run.workflow ?? 'none'} />
        <MiniStat label="Heartbeat" value={heartbeatAge === null ? 'none' : `${heartbeatAge}s ago`} />
        <MiniStat
          label="Frontend complete"
          value={`${coverage.complete}/${coverage.total}`}
          gauge={coverage.total > 0 ? { percent: Math.round((coverage.complete / coverage.total) * 100), tone: coverage.open === 0 ? 'emerald' : 'cyan' } : undefined}
        />
        <MiniStat label="GitHub" value={run.githubStatus ?? 'none'} />
      </div>
      {run.message ? <p className="mt-4 rounded-md border border-slate-800 bg-slate-950 p-3 text-sm text-slate-300">{run.message}</p> : null}
    </div>
  )
}

function MiniStat({ label, value, gauge }: { label: string; value: string; gauge?: { percent: number; tone: 'slate' | 'cyan' | 'amber' | 'sky' | 'emerald' | 'red' | 'violet' } }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-950 p-3">
      {gauge ? <LaneItemGauge percent={gauge.percent} tone={gauge.tone} title={`${label} ${gauge.percent}%`} /> : null}
      <div className="min-w-0">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="mt-1 break-words text-sm font-medium text-slate-100">{value}</div>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'slate' | 'red' | 'amber' }) {
  const cls = tone === 'red' ? 'border-red-800 bg-red-950/20 text-red-200' : tone === 'amber' ? 'border-amber-800 bg-amber-950/20 text-amber-200' : 'border-slate-800 bg-slate-900 text-slate-100'
  return (
    <div className={`rounded-md border p-4 ${cls}`}>
      <div className="text-xs opacity-70">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  )
}
