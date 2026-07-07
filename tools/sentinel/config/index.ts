import fs from 'node:fs'
import crypto from 'node:crypto'
import { configDefaultsFile, configLocalFile } from '../lib/paths.js'
import { readJsonFile, writeJsonFile } from '../lib/json-store.js'
import { DEFAULT_CONFIG, validateConfig, type SentinelConfig, type ValidationResult } from './schema.js'

/** Load + merge + validate config. Never throws — falls back to defaults. */
export function loadConfig(): ValidationResult {
  const defaults = readJsonFile<unknown>(configDefaultsFile, DEFAULT_CONFIG)
  ensureLocalConfigExists()
  const local = readJsonFile<unknown>(configLocalFile, {})
  return validateConfig(defaults, local)
}

/** Create an empty local-overrides file on first run with a generated API token. */
export function ensureLocalConfigExists() {
  if (fs.existsSync(configLocalFile)) return
  writeJsonFile(configLocalFile, {
    api: { token: generateToken() },
    notifications: { alertsWebhookUrl: '', activityWebhookUrl: '', devtoolsCriticalWebhookUrl: '' }
  })
}

export function generateToken() {
  return crypto.randomBytes(24).toString('hex')
}

/**
 * Persist a patch to the LOCAL overrides file only. Defaults are never mutated
 * at runtime. Returns the re-merged, validated config.
 */
export function updateLocalConfig(patch: Record<string, unknown>): ValidationResult {
  ensureLocalConfigExists()
  const local = readJsonFile<Record<string, unknown>>(configLocalFile, {})
  const next = deepAssign(local, patch)
  writeJsonFile(configLocalFile, next)
  return loadConfig()
}

function deepAssign(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key]
    if (isPlainObject(current) && isPlainObject(value)) {
      out[key] = deepAssign(current, value)
    } else {
      out[key] = value
    }
  }
  return out
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Strip secret fields so the config can be returned over the API safely. */
export function redactConfig(config: SentinelConfig): SentinelConfig {
  return {
    ...config,
    api: { ...config.api, token: config.api.token ? '***' : '' },
    notifications: {
      ...config.notifications,
      alertsWebhookUrl: mask(config.notifications.alertsWebhookUrl),
      activityWebhookUrl: mask(config.notifications.activityWebhookUrl),
      devtoolsCriticalWebhookUrl: mask(config.notifications.devtoolsCriticalWebhookUrl)
    },
    tunnel: {
      ...config.tunnel,
      ngrok: { ...config.tunnel.ngrok, apiKey: config.tunnel.ngrok.apiKey ? '***' : undefined }
    }
  }
}

function mask(value: string) {
  return value ? '***configured***' : ''
}

export { DEFAULT_CONFIG }
export type { SentinelConfig }
