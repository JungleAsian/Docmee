import { readJsonFile, writeJsonFile, fileMtimeMs } from './json-store.js'

export interface SubsystemHeartbeat {
  timestamp: string
  status: 'running' | 'paused' | 'observe-only' | 'not-configured' | 'offline'
  version: string
  uptimeSeconds: number
  activeIssues?: number
  resolvedToday?: number
  checksPassingCount?: number
  checksFailingCount?: number
  lastCheckRun?: Record<string, string>
}

export function writeHeartbeat(file: string, hb: SubsystemHeartbeat) {
  writeJsonFile(file, hb)
}

export function readHeartbeat(file: string): SubsystemHeartbeat | null {
  return readJsonFile<SubsystemHeartbeat | null>(file, null)
}

/** Age of a heartbeat file's content (prefers embedded timestamp, falls back to mtime). */
export function heartbeatAgeMs(file: string): number | null {
  const hb = readHeartbeat(file)
  if (hb?.timestamp) {
    const t = Date.parse(hb.timestamp)
    if (!Number.isNaN(t)) return Date.now() - t
  }
  const mtime = fileMtimeMs(file)
  return mtime === null ? null : Date.now() - mtime
}
