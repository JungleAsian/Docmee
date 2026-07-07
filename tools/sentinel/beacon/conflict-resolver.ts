import type { BeaconTarget } from './targets.js'
import { heartbeatAgeMs } from '../lib/heartbeat.js'
import { guardianHeartbeatFile } from '../lib/paths.js'

export type ConflictDecision = 'raise' | 'corroborate'

/**
 * Signal conflict resolution (Daemon spec).
 *
 * Guardian runs ON the VPS and is authoritative for VPS services. Beacon runs on
 * the dev machine and provides corroborating external evidence only. When a target
 * is VPS-owned AND Guardian is currently reporting (fresh heartbeat), Beacon's
 * external reading is attached as evidence to the Guardian issue rather than raised
 * as a separate, competing incident.
 */
export function resolveConflict(target: BeaconTarget, guardianFreshThresholdSeconds = 180): ConflictDecision {
  if (!target.vpsOwned) return 'raise'
  const age = heartbeatAgeMs(guardianHeartbeatFile)
  const guardianFresh = age !== null && age < guardianFreshThresholdSeconds * 1000
  return guardianFresh ? 'corroborate' : 'raise'
}
