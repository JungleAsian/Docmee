import type { SentinelConfig } from '../config/schema.js'
import type { IssueDraft, SentinelSeverity } from './issues.js'

/**
 * Shared dependency surface the daemon injects into each scanning sub-system
 * (Forge, Guardian, Aegis). Keeps sub-systems decoupled from the daemon, the
 * notification layer, and the tray.
 */
export interface SubsystemDeps {
  getConfig(): SentinelConfig
  /** Replace this source's issue set in the unified queue with these drafts. */
  writeIssues(drafts: IssueDraft[]): void
  notifyAlert(severity: SentinelSeverity, title: string, message: string): void
  notifyActivity(title: string, message: string): void
  push(severity: SentinelSeverity, title: string, message: string): void
  recomputeTray(): void
  /** Report an internal heartbeat to the daemon supervisor (every cycle). */
  reportAlive(): void
  /** Optional safe correction hook for derived log/status files. */
  refreshDerivedDeploymentRecords?(): boolean
}
