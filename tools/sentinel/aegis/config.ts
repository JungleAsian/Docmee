import fs from 'node:fs'
import { aegisConfigFile } from '../lib/paths.js'
import { readJsonFile, writeJsonFile } from '../lib/json-store.js'

export interface AegisConfig {
  version: string
  mode: 'active' | 'observe-only' | 'paused'
  schedules: {
    safetyRulesIntervalSeconds: number
    clinicOpsIntervalSeconds: number
    aiQualityIntervalSeconds: number
    integrationsIntervalSeconds: number
    licensingIntervalSeconds: number
  }
  thresholds: {
    unassignedConversationWarningMinutes: number
    unassignedConversationCriticalMinutes: number
    stuckConversationHours: number
    alertEscalationFailureMinutes: number
    alertQueueOverflowCount: number
    secretaryResponseTimeWarningMinutes: number
    botConfidenceThreshold: number
    kbGapMinCount: number
    transcriptionFailureWindow: number
    transcriptionFailureCount: number
    queueDepthThreshold: number
    aiCostAnomalyMultiplier: number
    whatsappFailureWindow: number
    whatsappFailureCount: number
    licenseExpiryWarningDays: number
    licenseExpiryCriticalDays: number
    seatLimitWarningPercent: number
    calendarTokenExpiryWarningDays: number
    metaTokenExpiryWarningDays: number
  }
  canary: { enabled: boolean; testClinicId: string; cleanupAfterSeconds: number }
  medicalSafetyKeywords: string[]
  neverAutoRecover: string[]
}

export const DEFAULT_AEGIS_CONFIG: AegisConfig = {
  version: '1.0.0',
  mode: 'observe-only',
  schedules: {
    safetyRulesIntervalSeconds: 60,
    clinicOpsIntervalSeconds: 300,
    aiQualityIntervalSeconds: 300,
    integrationsIntervalSeconds: 300,
    licensingIntervalSeconds: 600
  },
  thresholds: {
    unassignedConversationWarningMinutes: 30,
    unassignedConversationCriticalMinutes: 60,
    stuckConversationHours: 24,
    alertEscalationFailureMinutes: 70,
    alertQueueOverflowCount: 50,
    secretaryResponseTimeWarningMinutes: 30,
    botConfidenceThreshold: 0.6,
    kbGapMinCount: 5,
    transcriptionFailureWindow: 30,
    transcriptionFailureCount: 3,
    queueDepthThreshold: 500,
    aiCostAnomalyMultiplier: 3,
    whatsappFailureWindow: 10,
    whatsappFailureCount: 5,
    licenseExpiryWarningDays: 14,
    licenseExpiryCriticalDays: 3,
    seatLimitWarningPercent: 85,
    calendarTokenExpiryWarningDays: 7,
    metaTokenExpiryWarningDays: 7
  },
  canary: { enabled: false, testClinicId: 'aegis_test', cleanupAfterSeconds: 120 },
  medicalSafetyKeywords: [
    '\\bdiagnos(is|e|tic)\\b',
    '\\bprescrib(e|ing|ption)\\b',
    '\\btreatment plan\\b',
    '\\byou (have|likely have)\\b',
    '\\bdosage\\b'
  ],
  neverAutoRecover: ['rls-violation', 'medical-safety', 'stop-opt-out', '24h-window']
}

export function loadAegisConfig(): AegisConfig {
  if (!fs.existsSync(aegisConfigFile)) {
    writeJsonFile(aegisConfigFile, DEFAULT_AEGIS_CONFIG)
    return DEFAULT_AEGIS_CONFIG
  }
  const raw = readJsonFile<Partial<AegisConfig>>(aegisConfigFile, DEFAULT_AEGIS_CONFIG)
  return { ...DEFAULT_AEGIS_CONFIG, ...raw, thresholds: { ...DEFAULT_AEGIS_CONFIG.thresholds, ...raw.thresholds }, schedules: { ...DEFAULT_AEGIS_CONFIG.schedules, ...raw.schedules } }
}
