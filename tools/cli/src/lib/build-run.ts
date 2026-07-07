import process from 'node:process'
import { readJson, writeJson } from './json-store.js'

export type BuildRunState = {
  pid?: number
  phase?: string
  workflow?: string
  status: 'idle' | 'starting' | 'running' | 'paused' | 'stopped' | 'failed' | 'complete'
  startedAt?: string
  heartbeatAt?: string
  resumeAt?: string
  message?: string
}

export function readBuildRun() {
  return readJson<BuildRunState>('build-run.json', { status: 'idle' })
}

export function writeBuildRun(state: BuildRunState) {
  writeJson('build-run.json', state)
}

export function touchBuildRun(partial: Partial<BuildRunState>) {
  const current = readBuildRun()
  writeBuildRun({
    ...current,
    ...partial,
    pid: partial.pid ?? process.pid,
    heartbeatAt: new Date().toISOString()
  })
}

export function isProcessAlive(pid?: number) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
