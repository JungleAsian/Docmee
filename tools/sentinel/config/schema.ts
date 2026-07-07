/**
 * Platform-wide Sentinel config schema, defaults, validation, and merge.
 *
 * Two files are merged on startup:
 *   - defaults: tools/sentinel/config/sentinel-config.json  (committed, no secrets)
 *   - local:    tools/logs/sentinel-config.local.json       (gitignored, secrets)
 * Local values always win. Invalid config never crashes the daemon — the caller
 * keeps the previous valid config and logs `config.invalid`.
 */

export type SentinelMode = 'observe-only' | 'diagnose-and-assign' | 'auto-fix-safe' | 'full-approval'
export type ProviderId = 'claude-code' | 'codex' | 'local-model' | 'manual'
export type PerAgentProvider = ProviderId | 'global'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type TunnelMode = 'none' | 'ngrok' | 'cloudflare' | 'permanent'

export interface BeaconConfig {
  criticalIntervalSeconds: number
  standardIntervalSeconds: number
  backgroundIntervalSeconds: number
  staleThresholds: {
    criticalSeconds: number
    standardSeconds: number
    backgroundSeconds: number
    claudeSessionSeconds: number
  }
}

export interface HealerConfig {
  enabled: boolean
  maxRestartsPerHour: number
  cooldownSeconds: number
  escalateAfterAttempts: number
}

export interface ApiConfig {
  port: number
  token: string // populated in local config only
}

export interface LoggingConfig {
  level: LogLevel
  rotationSizeMb: number
  rotationsKept: number
}

export interface NotificationsConfig {
  alertsWebhookUrl: string // local
  activityWebhookUrl: string // local
  crossPostCriticalToDevtools: boolean
  devtoolsCriticalWebhookUrl: string // local
  push: { enabled: boolean; minSeverity: 'info' | 'warning' | 'critical' }
  quietHours: { enabled: boolean; startHour: number; endHour: number }
}

export interface ProvidersConfig {
  globalDefault: ProviderId
  perAgentOverrides: Record<string, PerAgentProvider>
  claudeCode: { command: string; maxConcurrent: number; sessionGuardEnabled: boolean; sessionGuardThresholdPct: number }
  codex: { command: string; model: string; maxConcurrent: number }
  localModel: { endpoint: string; model: string; maxConcurrent: number }
  autoFallback: { enabled: boolean; fallbackProvider: 'codex' | 'local-model' | 'manual'; restoreAfterSessionReset: boolean }
}

export interface TunnelConfig {
  activeMode: TunnelMode
  none: { description: string }
  ngrok: { appUrl: string; apiKey?: string }
  cloudflare: { tunnelId: string; appUrl: string; apiUrl: string; devtoolsUrl: string; accessEnabled: boolean }
  permanent: { appUrl: string; apiUrl: string; devtoolsUrl: string }
  lastVerified?: string
  lastSwitched?: string
  previousMode?: TunnelMode
  webhookReminderPending?: boolean
}

export interface SubSystemToggles {
  guardianEnabled: boolean
  aegisEnabled: boolean
}

export interface SentinelConfig {
  version: string
  mode: SentinelMode
  subsystems: SubSystemToggles
  beacon: BeaconConfig
  healer: HealerConfig
  api: ApiConfig
  logging: LoggingConfig
  notifications: NotificationsConfig
  providers: ProvidersConfig
  tunnel: TunnelConfig
  // Targets watched externally by Beacon; populated from tunnel + local config.
  targets: {
    devtoolsHealthUrl: string
    docmeeApiHealthUrl: string
    vpsHost: string
    cloudflareTunnelHealthUrl: string
  }
}

export const SENTINEL_AGENT_ROLES = [
  'diagnostics',
  'dashboard-ui',
  'cli-build',
  'git-github',
  'claude-session',
  'notion-integration',
  'deployment'
] as const

export type SentinelAgentRole = (typeof SENTINEL_AGENT_ROLES)[number]

/** Agents that never invoke an AI provider — they call DevTools modules directly. */
export const DIRECT_CALL_AGENTS: SentinelAgentRole[] = ['diagnostics', 'claude-session', 'notion-integration']

export const DEFAULT_CONFIG: SentinelConfig = {
  version: '1.0.0',
  mode: 'observe-only',
  subsystems: { guardianEnabled: false, aegisEnabled: false },
  beacon: {
    criticalIntervalSeconds: 15,
    standardIntervalSeconds: 30,
    backgroundIntervalSeconds: 60,
    staleThresholds: {
      criticalSeconds: 120,
      standardSeconds: 180,
      backgroundSeconds: 300,
      claudeSessionSeconds: 600
    }
  },
  healer: {
    enabled: true,
    maxRestartsPerHour: 3,
    cooldownSeconds: 120,
    escalateAfterAttempts: 3
  },
  api: { port: 4001, token: '' },
  logging: { level: 'info', rotationSizeMb: 10, rotationsKept: 5 },
  notifications: {
    alertsWebhookUrl: '',
    activityWebhookUrl: '',
    crossPostCriticalToDevtools: true,
    devtoolsCriticalWebhookUrl: '',
    push: { enabled: true, minSeverity: 'warning' },
    quietHours: { enabled: false, startHour: 22, endHour: 7 }
  },
  providers: {
    globalDefault: 'claude-code',
    perAgentOverrides: {},
    claudeCode: { command: 'claude', maxConcurrent: 1, sessionGuardEnabled: true, sessionGuardThresholdPct: 80 },
    codex: { command: 'codex', model: 'codex-1', maxConcurrent: 1 },
    localModel: { endpoint: 'http://localhost:11434', model: 'llama3', maxConcurrent: 1 },
    autoFallback: { enabled: false, fallbackProvider: 'codex', restoreAfterSessionReset: true }
  },
  tunnel: {
    activeMode: 'none',
    none: { description: 'DevTools and Sentinel are accessible on 127.0.0.1 only. No external access.' },
    ngrok: { appUrl: '' },
    cloudflare: { tunnelId: '', appUrl: '', apiUrl: '', devtoolsUrl: '', accessEnabled: false },
    permanent: { appUrl: '', apiUrl: '', devtoolsUrl: '' }
  },
  targets: {
    devtoolsHealthUrl: 'http://127.0.0.1:4000/api/health',
    docmeeApiHealthUrl: '',
    vpsHost: '',
    cloudflareTunnelHealthUrl: ''
  }
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Deep-merge `override` onto `base`. Arrays and scalars from override replace base. */
export function deepMerge<T>(base: T, override: unknown): T {
  if (!isObject(base) || !isObject(override)) {
    return (override === undefined ? base : (override as T))
  }
  const result: Json = { ...(base as unknown as Json) }
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue
    const current = (base as unknown as Json)[key]
    result[key] = isObject(current) && isObject(value) ? deepMerge(current, value) : value
  }
  return result as unknown as T
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
  config: SentinelConfig
}

/**
 * Merge defaults + overrides, then validate the shape. On failure, returns the
 * defaults-merged config plus a list of errors. Callers decide whether to adopt.
 */
export function validateConfig(defaults: unknown, local: unknown): ValidationResult {
  const errors: string[] = []
  const base = isObject(defaults) ? deepMerge(DEFAULT_CONFIG, defaults) : DEFAULT_CONFIG
  const merged = isObject(local) ? deepMerge(base, local) : base

  const modes: SentinelMode[] = ['observe-only', 'diagnose-and-assign', 'auto-fix-safe', 'full-approval']
  if (!modes.includes(merged.mode)) errors.push(`mode must be one of ${modes.join(', ')}`)

  if (!Number.isFinite(merged.api.port) || merged.api.port <= 0) errors.push('api.port must be a positive number')
  if (merged.api.port === 4000) errors.push('api.port must not collide with DevTools port 4000')

  const providers: ProviderId[] = ['claude-code', 'codex', 'local-model', 'manual']
  if (!providers.includes(merged.providers.globalDefault)) errors.push('providers.globalDefault is invalid')

  const tunnelModes: TunnelMode[] = ['none', 'ngrok', 'cloudflare', 'permanent']
  if (!tunnelModes.includes(merged.tunnel.activeMode)) errors.push('tunnel.activeMode is invalid')

  if (merged.healer.maxRestartsPerHour < 0) errors.push('healer.maxRestartsPerHour must be >= 0')
  if (merged.logging.rotationSizeMb <= 0) errors.push('logging.rotationSizeMb must be > 0')

  return { ok: errors.length === 0, errors, config: merged }
}
