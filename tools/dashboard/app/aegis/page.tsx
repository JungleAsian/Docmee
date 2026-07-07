import { issuesBySource, activeIssues, readHeartbeat, heartbeatLiveness, heartbeatAgeSeconds, readChecks, readAudit } from '../lib/sentinel-platform'
import { CompactSection } from '../compact-ui'
import { IssueList, SubsystemHeader } from '../sentinel-shared'
import { BlockerPanel, EventTimeline, HeartbeatVisual, IncidentRecoveryView, NextActionPanel, SystemStatusBanner } from '../sentinel-visuals'
import { AutoRefresh } from '../auto-refresh'
import { BuildProgressGauge } from '../build-progress-gauge'
import { LaneItemGauge } from '../lane-item-gauge'

export const dynamic = 'force-dynamic'

const CATEGORIES = [
  { id: 'safety', label: 'Critical Safety Rules' },
  { id: 'clinic-ops', label: 'Clinic Operations' },
  { id: 'ai-quality', label: 'AI Quality' },
  { id: 'integrations', label: 'External Integrations' },
  { id: 'licensing', label: 'Licensing Integrity' }
]

export default function AegisPage() {
  const hb = readHeartbeat('aegis')
  const liveness = heartbeatLiveness(hb)
  const age = heartbeatAgeSeconds(hb)
  const checks = readChecks('aegis')
  const active = activeIssues(issuesBySource('aegis'))
  const safetyFailing = active.filter((i) => i.checkCategory === 'safety')

  const totalChecks = checks.length
  const passedChecks = checks.filter((c) => c.status === 'pass').length
  const overallPercent = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 0
  const anyFailing = checks.some((c) => c.status === 'fail')
  const anyWarning = checks.some((c) => c.status === 'warn')
  const overallState: 'complete' | 'progressing' | 'halted' | 'stopped' =
    totalChecks === 0 ? 'stopped' : anyFailing ? 'halted' : anyWarning ? 'progressing' : 'complete'

  return (
    <section className="w-full space-y-6">
      <AutoRefresh seconds={15} />
      <SubsystemHeader
        title="Aegis"
        emoji="⚔️"
        scope="Product integrity — bot behaviour, clinic compliance, patient-facing features, AI quality. Aegis protects it. PHI never enters an issue record."
        liveness={liveness}
        detail={liveness === 'not-configured' ? 'Configure DB connection to activate' : age === null ? 'no heartbeat' : `heartbeat ${age}s ago`}
      />

      <div className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900 p-4">
        <div>
          <div className="text-sm font-semibold">Product Integrity Health</div>
          <div className="text-xs text-slate-500">{passedChecks}/{totalChecks} checks passing</div>
        </div>
        <BuildProgressGauge
          size="sm"
          percent={overallPercent}
          state={overallState}
          label={`${overallPercent}% passing`}
          message={anyFailing ? 'Failing safety/integrity checks' : anyWarning ? 'Warnings present' : 'All checks healthy'}
        />
      </div>

      <SystemStatusBanner
        title="Aegis Product Protection"
        question="Did it recover?"
        state={liveness}
        detail="Aegis watches product integrity, safety rules, clinic workflows, integration behavior, and recovery attempts."
      />

      {safetyFailing.length > 0 && (
        <div className="rounded-md border border-red-700 bg-red-950/40 p-4 text-sm font-medium text-red-200">
          ⚠️ {safetyFailing.length} critical safety rule(s) currently failing. Patient safety is the highest priority.
        </div>
      )}

      {liveness === 'not-configured' && (
        <div className="rounded-md border border-slate-700 bg-slate-900 p-4 text-sm text-slate-300">
          Aegis is not configured. Set AEGIS_DB_URL and enable Aegis in Sentinel Settings to begin product-integrity monitoring.
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-5">
        {CATEGORIES.map((cat) => {
          const rows = checks.filter((c) => c.category === cat.id)
          const failing = rows.filter((r) => r.status === 'fail' || r.status === 'warn').length
          const passed = rows.filter((r) => r.status === 'pass').length
          const pct = rows.length > 0 ? Math.round((passed / rows.length) * 100) : 0
          const worst = rows.some((r) => r.status === 'fail') ? 'fail' : rows.some((r) => r.status === 'warn') ? 'warn' : 'pass'
          const tone = worst === 'fail' ? 'red' : worst === 'warn' ? 'amber' : 'emerald'
          return (
            <div key={cat.id} className={`rounded-md border p-4 ${cat.id === 'safety' ? 'border-red-900/60 bg-red-950/10' : 'border-slate-800 bg-slate-900'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="text-xs font-semibold">{cat.label}</div>
                <LaneItemGauge percent={pct} tone={tone} title={`${cat.label} — ${worst}`} />
              </div>
              <div className="mt-2 text-2xl font-semibold">{failing}</div>
              <div className="text-xs text-slate-500">active</div>
            </div>
          )
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <HeartbeatVisual label="Aegis" heartbeat={hb} />
        <IncidentRecoveryView audit={readAudit()} />
      </div>

      <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-4 text-sm font-semibold">Active Issues (anonymised by clinic)</h2>
        <IssueList issues={active} emptyLabel="No active Aegis issues." />
      </div>

      <CompactSection title="Integrity Events, Blockers, and Next Actions" subtitle="Detailed Aegis integrity history and recovery guidance.">
        <div className="grid gap-4 xl:grid-cols-2">
          <EventTimeline title="Recent Product Integrity Events" audit={readAudit().filter((entry) => /aegis|safety|clinic|ai|license|recover/i.test(`${entry.subsystem ?? ''} ${entry.action ?? ''} ${entry.message ?? ''}`))} />
          <BlockerPanel issues={active} title="Product Integrity Blockers" />
        </div>
        <div className="mt-4">
          <NextActionPanel
            actions={[
              'Review failed safety and clinic operation checks before allowing any production release.',
              'If a recovery attempt failed, pause deployment until the last known good state is confirmed.',
              'Keep product-integrity records anonymised and do not store patient data in issue logs.'
            ]}
          />
        </div>
      </CompactSection>
    </section>
  )
}
