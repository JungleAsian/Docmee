import {
  buildRunFile,
  forgeHeartbeatFile,
  guardianHeartbeatFile,
  aegisHeartbeatFile,
  claudeUsageGuardFile
} from '../lib/paths.js'
import type { SentinelConfig } from '../config/schema.js'
import type { SentinelSeverity } from '../lib/issues.js'

export type TargetKind = 'http' | 'file' | 'tcp' | 'self'
export type TargetCategory = 'critical' | 'standard' | 'background'

export interface BeaconTarget {
  id: string
  label: string
  kind: TargetKind
  category: TargetCategory
  intervalSeconds: number
  staleThresholdSeconds: number
  severity: SentinelSeverity
  // http
  url?: string
  expectStatuses?: number[]
  // file (heartbeat freshness)
  file?: string
  fileTimestampField?: string
  // tcp
  host?: string
  port?: number
  // Whether a stale signal triggers the DevTools healer.
  triggersHealer?: boolean
  // VPS-owned services where Guardian is authoritative (Beacon corroborates only).
  vpsOwned?: boolean
  // Only watched while a build is active.
  buildOnly?: boolean
}

/**
 * Derive Beacon's target list from the merged config. Targets whose URL/host is
 * not configured are omitted (Beacon only watches what exists).
 */
export function buildTargets(config: SentinelConfig): BeaconTarget[] {
  const b = config.beacon
  const t = config.targets
  const sentinelHealthUrl = `http://127.0.0.1:${config.api.port}/health`
  const targets: BeaconTarget[] = []

  // --- Critical (15s) ---
  if (t.devtoolsHealthUrl) {
    targets.push({
      id: 'devtools-dashboard',
      label: 'DevTools dashboard',
      kind: 'http',
      category: 'critical',
      intervalSeconds: b.criticalIntervalSeconds,
      staleThresholdSeconds: b.staleThresholds.criticalSeconds,
      severity: 'critical',
      url: t.devtoolsHealthUrl,
      triggersHealer: true
    })
  }
  if (t.docmeeApiHealthUrl) {
    targets.push({
      id: 'docmee-api',
      label: 'Docmee API (VPS)',
      kind: 'http',
      category: 'critical',
      intervalSeconds: b.criticalIntervalSeconds,
      staleThresholdSeconds: b.staleThresholds.criticalSeconds,
      severity: 'critical',
      url: t.docmeeApiHealthUrl,
      vpsOwned: true
    })
  }
  targets.push({
    id: 'devtools-build-watcher',
    label: 'DevTools build watcher',
    kind: 'file',
    category: 'critical',
    intervalSeconds: b.criticalIntervalSeconds,
    staleThresholdSeconds: b.staleThresholds.standardSeconds,
    severity: 'critical',
    file: buildRunFile,
    fileTimestampField: 'heartbeatAt',
    buildOnly: true
  })

  // --- Standard (30s) ---
  targets.push(
    { id: 'forge-scanner', label: 'Forge scanner', kind: 'file', category: 'standard', intervalSeconds: b.standardIntervalSeconds, staleThresholdSeconds: b.staleThresholds.standardSeconds, severity: 'warning', file: forgeHeartbeatFile, fileTimestampField: 'timestamp' },
    { id: 'guardian-scanner', label: 'Guardian (VPS)', kind: 'file', category: 'standard', intervalSeconds: b.standardIntervalSeconds, staleThresholdSeconds: b.staleThresholds.standardSeconds, severity: 'warning', file: guardianHeartbeatFile, fileTimestampField: 'timestamp', vpsOwned: true },
    { id: 'aegis-scanner', label: 'Aegis scanner', kind: 'file', category: 'standard', intervalSeconds: b.standardIntervalSeconds, staleThresholdSeconds: b.staleThresholds.standardSeconds, severity: 'warning', file: aegisHeartbeatFile, fileTimestampField: 'timestamp' },
    { id: 'claude-session', label: 'Claude Code session', kind: 'file', category: 'standard', intervalSeconds: b.standardIntervalSeconds, staleThresholdSeconds: b.staleThresholds.claudeSessionSeconds, severity: 'warning', file: claudeUsageGuardFile, fileTimestampField: 'updatedAt', buildOnly: true },
    { id: 'sentinel-api', label: 'Sentinel API', kind: 'http', category: 'standard', intervalSeconds: b.standardIntervalSeconds, staleThresholdSeconds: b.staleThresholds.criticalSeconds, severity: 'critical', url: sentinelHealthUrl }
  )

  // --- Background (60s) ---
  if (t.vpsHost) {
    targets.push({ id: 'vps-ssh', label: 'VPS SSH reachability', kind: 'tcp', category: 'background', intervalSeconds: b.backgroundIntervalSeconds, staleThresholdSeconds: b.staleThresholds.backgroundSeconds, severity: 'warning', host: t.vpsHost, port: 22, vpsOwned: true })
  }
  if (t.cloudflareTunnelHealthUrl) {
    targets.push({ id: 'cloudflare-tunnel', label: 'Cloudflare Tunnel', kind: 'http', category: 'background', intervalSeconds: b.backgroundIntervalSeconds, staleThresholdSeconds: b.staleThresholds.backgroundSeconds, severity: 'warning', url: t.cloudflareTunnelHealthUrl })
  }

  return targets
}
