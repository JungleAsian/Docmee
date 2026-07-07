import path from 'node:path'
import { fileURLToPath } from 'node:url'

// tools/sentinel
export const sentinelRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// tools
export const toolsRoot = path.resolve(sentinelRoot, '..')
// tools/logs — shared with DevTools. Both processes read/write here.
export const logsDir = path.join(toolsRoot, 'logs')
// tools/.env.tools — Sentinel writes derived tunnel vars here.
export const envToolsFile = path.join(toolsRoot, '.env.tools')

// Config — defaults committed to git, local overrides gitignored.
export const configDefaultsFile = path.join(sentinelRoot, 'config', 'sentinel-config.json')
export const configLocalFile = path.join(logsDir, 'sentinel-config.local.json')

// Operational files (all under tools/logs).
export const daemonLogFile = path.join(logsDir, 'sentinel-daemon.json')
export const daemonPidFile = path.join(logsDir, 'sentinel-daemon.pid')
export const issuesFile = path.join(logsDir, 'sentinel-issues.json')
export const auditFile = path.join(logsDir, 'sentinel-audit.json')
export const tasksDir = path.join(logsDir, 'sentinel-tasks')
export const featureCoverageFile = path.join(logsDir, 'rev1-feature-coverage.json')
export const featureRunFile = path.join(logsDir, 'feature-run.json')
export const deploymentRecordsFile = path.join(logsDir, 'docmee-deployment-records.json')
export const startReadinessFile = path.join(logsDir, 'start-readiness.json')

// Sub-system heartbeats.
export const forgeHeartbeatFile = path.join(logsDir, 'forge-heartbeat.json')
export const guardianHeartbeatFile = path.join(logsDir, 'guardian-heartbeat.json')
export const aegisHeartbeatFile = path.join(logsDir, 'aegis-heartbeat.json')

// Sub-system check + config files.
export const guardianConfigFile = path.join(logsDir, 'guardian-config.json')
export const guardianChecksFile = path.join(logsDir, 'guardian-checks.json')
export const guardianAuditFile = path.join(logsDir, 'guardian-audit.json')
export const aegisConfigFile = path.join(logsDir, 'aegis-config.json')
export const aegisChecksFile = path.join(logsDir, 'aegis-checks.json')
export const aegisAuditFile = path.join(logsDir, 'aegis-audit.json')

// Signals consumed from DevTools.
export const buildRunFile = path.join(logsDir, 'build-run.json')
export const claudeUsageGuardFile = path.join(logsDir, 'claude-usage-guard.json')

export function logFileFor(name: string) {
  return path.join(logsDir, name)
}
