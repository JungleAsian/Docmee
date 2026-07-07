import fs from 'node:fs'
import { daemonLogFile, logsDir } from './paths.js'
import { fileSize } from './json-store.js'

export type DaemonLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical'
export type DaemonSubsystem =
  | 'beacon'
  | 'forge'
  | 'guardian'
  | 'aegis'
  | 'cortex'
  | 'daemon'
  | 'executor'
  | 'healer'
  | 'api'
  | 'tunnel'
  | 'tray'

export interface DaemonLogEntry {
  ts: string
  level: DaemonLogLevel
  subsystem: DaemonSubsystem
  event: string
  message: string
  data?: Record<string, unknown>
}

const LEVEL_RANK: Record<DaemonLogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, critical: 4 }

let minLevel: DaemonLogLevel = 'info'
let rotationBytes = 10 * 1024 * 1024
let rotationsKept = 5
let mirrorToConsole = true

export function configureLogger(opts: { level?: DaemonLogLevel; rotationSizeMb?: number; rotationsKept?: number; console?: boolean }) {
  if (opts.level) minLevel = opts.level
  if (opts.rotationSizeMb) rotationBytes = Math.max(1, opts.rotationSizeMb) * 1024 * 1024
  if (typeof opts.rotationsKept === 'number') rotationsKept = Math.max(1, opts.rotationsKept)
  if (typeof opts.console === 'boolean') mirrorToConsole = opts.console
}

/** Append one structured JSON object per line. Rotates at the configured size. */
export function logEvent(
  subsystem: DaemonSubsystem,
  level: DaemonLogLevel,
  event: string,
  message: string,
  data?: Record<string, unknown>
) {
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel] && level !== 'critical') return
  const entry: DaemonLogEntry = { ts: new Date().toISOString(), level, subsystem, event, message }
  if (data) entry.data = data
  fs.mkdirSync(logsDir, { recursive: true })
  rotateIfNeeded()
  fs.appendFileSync(daemonLogFile, `${JSON.stringify(entry)}\n`)
  if (mirrorToConsole) {
    const tag = level === 'critical' || level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'
    // eslint-disable-next-line no-console
    ;(console[tag as 'log'] ?? console.log)(`[${subsystem}] ${event} — ${message}`)
  }
}

function rotateIfNeeded() {
  if (fileSize(daemonLogFile) < rotationBytes) return
  // Shift .4 -> .5, .3 -> .4 ... then current -> .1
  for (let i = rotationsKept - 1; i >= 1; i -= 1) {
    const from = `${daemonLogFile}.${i}`
    const to = `${daemonLogFile}.${i + 1}`
    if (fs.existsSync(from)) fs.renameSync(from, to)
  }
  if (fs.existsSync(daemonLogFile)) fs.renameSync(daemonLogFile, `${daemonLogFile}.1`)
}

export interface DailySummaryData {
  resolved: number
  warnings: number
  approvalPending: number
  uptimeSeconds: number
  providerUsed: string
  agentInvocations: number
  healerActivations: number
}

export function writeDailySummary(data: DailySummaryData) {
  logEvent(
    'daemon',
    'info',
    'heartbeat.daily',
    `Daily summary — ${data.resolved} critical resolved, ${data.warnings} warnings active, ${data.approvalPending} approval pending`,
    { ...data }
  )
}
