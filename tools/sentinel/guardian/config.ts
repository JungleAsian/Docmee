import fs from 'node:fs'
import { guardianConfigFile } from '../lib/paths.js'
import { readJsonFile, writeJsonFile } from '../lib/json-store.js'

export interface RecoveryRule {
  trigger: string
  action: string
  maxAttemptsPerHour: number
  cooldownSeconds: number
  escalateAfterAttempts: number
  enabled: boolean
}

export interface GuardianConfig {
  version: string
  mode: 'active' | 'observe-only' | 'paused'
  schedules: {
    infrastructureIntervalSeconds: number
    externalDepsIntervalSeconds: number
    businessLogicIntervalSeconds: number
    heartbeatIntervalSeconds: number
  }
  recoveryRules: RecoveryRule[]
  thresholds: {
    diskWarningPercent: number
    diskCriticalPercent: number
    queueDepthWarning: number
    queueDepthCritical: number
    memoryAvailableMBWarning: number
    externalApiUnreachableMinutes: number
    sslExpiryWarningDays: number
    metaTokenExpiryWarningDays: number
    endToEndFlowMaxAgeMinutes: number
  }
  canary: { enabled: boolean; testClinicId: string; cleanupAfterSeconds: number }
  neverTouch: string[]
  quietHours: { enabled: boolean; startHour: number; endHour: number }
}

export const DEFAULT_GUARDIAN_CONFIG: GuardianConfig = {
  version: '1.0.0',
  mode: 'observe-only',
  schedules: {
    infrastructureIntervalSeconds: 60,
    externalDepsIntervalSeconds: 300,
    businessLogicIntervalSeconds: 300,
    heartbeatIntervalSeconds: 60
  },
  recoveryRules: [
    { trigger: 'api-container-down', action: 'restart-api', maxAttemptsPerHour: 3, cooldownSeconds: 300, escalateAfterAttempts: 3, enabled: true },
    { trigger: 'worker-container-down', action: 'restart-worker', maxAttemptsPerHour: 3, cooldownSeconds: 300, escalateAfterAttempts: 3, enabled: true },
    { trigger: 'web-container-down', action: 'restart-web', maxAttemptsPerHour: 3, cooldownSeconds: 300, escalateAfterAttempts: 3, enabled: true },
    { trigger: 'caddy-container-down', action: 'restart-caddy', maxAttemptsPerHour: 2, cooldownSeconds: 600, escalateAfterAttempts: 2, enabled: true },
    { trigger: 'caddy-routing-error', action: 'reload-caddy-config', maxAttemptsPerHour: 2, cooldownSeconds: 300, escalateAfterAttempts: 2, enabled: true },
    { trigger: 'queue-stuck', action: 'flush-queue', maxAttemptsPerHour: 1, cooldownSeconds: 1800, escalateAfterAttempts: 1, enabled: true }
  ],
  thresholds: {
    diskWarningPercent: 85,
    diskCriticalPercent: 95,
    queueDepthWarning: 500,
    queueDepthCritical: 2000,
    memoryAvailableMBWarning: 256,
    externalApiUnreachableMinutes: 10,
    sslExpiryWarningDays: 14,
    metaTokenExpiryWarningDays: 7,
    endToEndFlowMaxAgeMinutes: 15
  },
  canary: { enabled: false, testClinicId: 'guardian_test_clinic', cleanupAfterSeconds: 120 },
  neverTouch: ['docmee-postgres', 'docmee-redis'],
  quietHours: { enabled: false, startHour: 2, endHour: 6 }
}

export function loadGuardianConfig(): GuardianConfig {
  if (!fs.existsSync(guardianConfigFile)) {
    writeJsonFile(guardianConfigFile, DEFAULT_GUARDIAN_CONFIG)
    return DEFAULT_GUARDIAN_CONFIG
  }
  const raw = readJsonFile<Partial<GuardianConfig>>(guardianConfigFile, DEFAULT_GUARDIAN_CONFIG)
  return { ...DEFAULT_GUARDIAN_CONFIG, ...raw, thresholds: { ...DEFAULT_GUARDIAN_CONFIG.thresholds, ...raw.thresholds }, schedules: { ...DEFAULT_GUARDIAN_CONFIG.schedules, ...raw.schedules } }
}
