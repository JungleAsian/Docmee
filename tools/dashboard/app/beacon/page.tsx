import { activeIssues, heartbeatLiveness, readAudit, readHeartbeat, readIssues, readTunnel } from '../lib/sentinel-platform'
import { CompactSection } from '../compact-ui'
import { BlockerPanel, EndpointStatusTable, EventTimeline, HeartbeatVisual, NextActionPanel, SystemStatusBanner } from '../sentinel-visuals'
import { AutoRefresh } from '../auto-refresh'
import { BuildProgressGauge } from '../build-progress-gauge'

export const dynamic = 'force-dynamic'

export default function BeaconPage() {
  const forge = readHeartbeat('forge')
  const guardian = readHeartbeat('guardian')
  const aegis = readHeartbeat('aegis')
  const tunnel = readTunnel()
  const issues = readIssues()
  const audit = readAudit().filter((entry) => /beacon|tunnel|heartbeat|sentinel/i.test(`${entry.subsystem ?? ''} ${entry.action ?? ''} ${entry.message ?? ''}`))
  const configuredLiveness = [forge, guardian, aegis].map((hb) => heartbeatLiveness(hb)).filter((state) => state !== 'not-configured')
  const state = configuredLiveness.length === 0
    ? 'not-configured'
    : configuredLiveness.every((item) => item === 'running')
      ? 'running'
      : configuredLiveness.some((item) => item === 'stale')
        ? 'stale'
        : 'offline'

  const freshCount = configuredLiveness.filter((item) => item === 'running').length
  const heartbeatPercent = configuredLiveness.length === 0 ? 0 : Math.round((freshCount / configuredLiveness.length) * 100)
  const heartbeatGaugeState = configuredLiveness.length === 0 ? 'stopped' : freshCount === configuredLiveness.length ? 'complete' : 'halted'

  return (
    <section className="w-full space-y-6">
      <AutoRefresh seconds={15} />
      <SystemStatusBanner
        title="Beacon"
        question="Can the system be seen and reached?"
        state={state}
        detail={`Beacon watches access paths, heartbeats, public URLs, and service visibility. Active tunnel mode: ${tunnel.activeMode}.`}
      />

      {configuredLiveness.length > 0 && (
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <BuildProgressGauge
            size="sm"
            percent={heartbeatPercent}
            state={heartbeatGaugeState}
            label="Heartbeat Freshness"
            message={`${freshCount} of ${configuredLiveness.length} configured heartbeats are fresh.`}
          />
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <HeartbeatVisual label="Forge" heartbeat={forge} />
        <HeartbeatVisual label="Guardian" heartbeat={guardian} />
        <HeartbeatVisual label="Aegis" heartbeat={aegis} />
      </div>

      <CompactSection title="Reachability Details" subtitle="Endpoint map and Beacon next actions.">
        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <EndpointStatusTable />
          <NextActionPanel
            actions={[
              'Confirm the local DevTool and Docmee URLs are reachable before testing remote access.',
              'If the VPS or tunnel URL is missing, update the deployment access settings first.',
              'Use Beacon before deployment to confirm the user can reach the same app path.'
            ]}
          />
        </div>
      </CompactSection>

      <CompactSection title="Availability Events and Blockers" subtitle="Recent Beacon events and active reachability blockers.">
        <div className="grid gap-4 xl:grid-cols-2">
          <EventTimeline title="Recent Availability Events" audit={audit} />
          <BlockerPanel issues={activeIssues(issues)} title="Reachability Blockers" />
        </div>
      </CompactSection>
    </section>
  )
}
