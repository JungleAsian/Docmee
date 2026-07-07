import fs from 'node:fs'
import path from 'node:path'
import { logsDir } from './paths.js'

// Durable, append-only activity feed shared across DevTools — the single
// chronological "what happened" timeline (resolve/verify/stop/etc.). Capped so
// the file stays small; newest events win when trimming.
export type Severity = 'info' | 'success' | 'warn' | 'error'

export type ActivityEvent = {
  id: string
  ts: string
  actor: string
  event: string
  severity: Severity
  message: string
  taskId?: number
  source?: string
  link?: string
}

const file = path.join(logsDir, 'activity.json')
const MAX = 1000

export function readActivity(): ActivityEvent[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as ActivityEvent[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function logActivity(event: {
  actor: string
  event: string
  message: string
  severity?: Severity
  taskId?: number
  source?: string
  link?: string
}): void {
  let list = readActivity()
  const entry: ActivityEvent = {
    id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    ts: new Date().toISOString(),
    severity: event.severity ?? 'info',
    actor: event.actor,
    event: event.event,
    message: event.message,
    ...(typeof event.taskId === 'number' ? { taskId: event.taskId } : {}),
    ...(event.source ? { source: event.source } : {}),
    ...(event.link ? { link: event.link } : {})
  }
  list.push(entry)
  if (list.length > MAX) list = list.slice(list.length - MAX)
  try {
    fs.mkdirSync(logsDir, { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`)
  } catch {
    // best-effort: the feed is non-critical telemetry
  }
}

export function clearActivity(): void {
  try {
    fs.mkdirSync(logsDir, { recursive: true })
    fs.writeFileSync(file, '[]\n')
  } catch {
    // ignore
  }
}
