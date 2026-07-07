import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextResponse } from 'next/server'

const toolsRoot = path.resolve(process.cwd(), '..')
const logsRoot = path.join(toolsRoot, 'logs')
const claudeRoot = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const sessionWindowMs = 5 * 60 * 60 * 1000
const heartbeatSamples: Array<{ at: string; status: string; ageMs: number | null; value: number }> = []
const featureHeartbeatSamples: Array<{ at: string; status: string; ageMs: number | null; value: number }> = []
const uiHeartbeatSamples: Array<{ at: string; status: string; ageMs: number | null; value: number }> = []
const frontendHeartbeatSamples: Array<{ at: string; status: string; ageMs: number | null; value: number }> = []

const phases = [
  ['P01', 'Repository Foundation'],
  ['P02', 'Database'],
  ['P03', 'Core Infrastructure + AI'],
  ['P04', 'WhatsApp Channel'],
  ['P05', 'Clinic Bot'],
  ['P06', 'Appointment Scheduler'],
  ['P07', 'Secretary Alerts'],
  ['P08', 'Auth & API'],
  ['P09', 'Clinic Inbox + Admin Studio'],
  ['P10', 'License Manager'],
  ['P11', 'Admin Studio Admin Panel'],
  ['P12', 'Voice Transcription Service'],
  ['P13', 'Installer (DeployKit)'],
  ['P14', 'Facebook Messenger'],
  ['P15', 'Instagram Direct'],
  ['P16', 'Phase 2 Features'],
  ['P17', 'Testing & CI/CD'],
  ['P18', 'Phase 3 Features'],
  ['P19', 'Compliance & Launch']
] as const

function readJson<T>(file: string, fallback: T): T {
  const target = path.join(logsRoot, file)
  if (!fs.existsSync(target)) return fallback
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8')) as T
  } catch {
    return fallback
  }
}

function fileStamp(file: string) {
  try {
    return fs.statSync(path.join(logsRoot, file)).mtime.toISOString()
  } catch {
    return null
  }
}

function isAlive(pid?: number) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function latestPhaseLog() {
  try {
    return fs.readdirSync(logsRoot)
      .filter((name) => /^phase-\d{4}-\d{2}-\d{2}\.log$/.test(name))
      .map((name) => ({ name, mtime: fs.statSync(path.join(logsRoot, name)).mtimeMs }))
      .sort((left, right) => right.mtime - left.mtime)[0]?.name ?? null
  } catch {
    return null
  }
}

function tail(file: string | null, lines = 70) {
  if (!file) return []
  try {
    return fs.readFileSync(path.join(logsRoot, file), 'utf8').split(/\r?\n/).filter(Boolean).slice(-lines)
  } catch {
    return []
  }
}

function heartbeatStatus(run: { status?: string; phase?: string; message?: string }, live: boolean, heartbeatAgeMs: number | null, active?: { buildStatus?: string }) {
  const message = `${run.phase ?? ''} ${run.message ?? ''}`.toLowerCase()
  const buildLooksActive = ['starting', 'running', 'paused'].includes(run.status ?? '') || ['in-progress', 'paused', 'gates-running', 'pushing'].includes(active?.buildStatus ?? '')
  if (message.includes('sentinel')) return 'sentinel'
  if (!live && buildLooksActive) return 'dead'
  if (run.status === 'paused') return 'paused'
  if (!live) return 'stopped'
  if (typeof heartbeatAgeMs !== 'number') return 'unknown'
  if (heartbeatAgeMs > 120000) return 'lost'
  if (heartbeatAgeMs > 60000) return 'delayed'
  return 'normal'
}

function sampleValue(status: string) {
  if (status === 'normal') return 1
  if (status === 'paused') return 0.72
  if (status === 'sentinel') return 0.82
  if (status === 'delayed') return 0.55
  if (status === 'unknown') return 0.35
  if (status === 'lost') return 0.18
  return 0.05
}

function updateHeartbeatSamples(status: string, heartbeatAgeMs: number | null) {
  heartbeatSamples.push({ at: new Date().toISOString(), status, ageMs: heartbeatAgeMs, value: sampleValue(status) })
  while (heartbeatSamples.length > 80) heartbeatSamples.shift()
  return heartbeatSamples
}

function updateFeatureHeartbeatSamples(status: string, heartbeatAgeMs: number | null) {
  featureHeartbeatSamples.push({ at: new Date().toISOString(), status, ageMs: heartbeatAgeMs, value: sampleValue(status) })
  while (featureHeartbeatSamples.length > 80) featureHeartbeatSamples.shift()
  return featureHeartbeatSamples
}

function updateUiHeartbeatSamples(status: string, heartbeatAgeMs: number | null) {
  uiHeartbeatSamples.push({ at: new Date().toISOString(), status, ageMs: heartbeatAgeMs, value: sampleValue(status) })
  while (uiHeartbeatSamples.length > 80) uiHeartbeatSamples.shift()
  return uiHeartbeatSamples
}

function updateFrontendHeartbeatSamples(status: string, heartbeatAgeMs: number | null) {
  frontendHeartbeatSamples.push({ at: new Date().toISOString(), status, ageMs: heartbeatAgeMs, value: sampleValue(status) })
  while (frontendHeartbeatSamples.length > 80) frontendHeartbeatSamples.shift()
  return frontendHeartbeatSamples
}

function tokenTotal(usage?: Record<string, number>) {
  if (!usage) return 0
  return Number(usage.input_tokens ?? 0) + Number(usage.output_tokens ?? 0) + Number(usage.cache_creation_input_tokens ?? 0) + Number(usage.cache_read_input_tokens ?? 0)
}

type UsageEvent = { timestamp: number; tokens: number }
let usageEventsCache: { at: number; events: UsageEvent[] } | null = null
const usageCacheTtlMs = 60 * 1000

function claudeUsageEvents() {
  const projectsRoot = path.join(claudeRoot, 'projects')
  // Only the current rolling session block matters, so transcripts untouched
  // for longer than the session window cannot contribute and are skipped. This
  // bounds the scan to recently-active sessions instead of the whole corpus.
  const freshAfter = Date.now() - sessionWindowMs
  const byRequest = new Map<string, UsageEvent>()
  try {
    for (const project of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
      if (!project.isDirectory()) continue
      const projectRoot = path.join(projectsRoot, project.name)
      for (const entry of fs.readdirSync(projectRoot, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
        const entryPath = path.join(projectRoot, entry.name)
        try {
          if (fs.statSync(entryPath).mtimeMs < freshAfter) continue
        } catch {
          continue
        }
        for (const line of fs.readFileSync(entryPath, 'utf8').split(/\r?\n/)) {
          if (!line.trim()) continue
          try {
            const item = JSON.parse(line) as { timestamp?: string; requestId?: string; uuid?: string; message?: { usage?: Record<string, number> } }
            const timestamp = Date.parse(item.timestamp ?? '')
            const tokens = tokenTotal(item.message?.usage)
            if (!timestamp || !tokens) continue
            byRequest.set(item.requestId || item.uuid || String(timestamp), { timestamp, tokens })
          } catch {
            // Ignore incomplete Claude log lines.
          }
        }
      }
    }
  } catch {
    // Claude logs are optional.
  }
  return Array.from(byRequest.values()).sort((left, right) => left.timestamp - right.timestamp)
}

// The scan above walks every recently-active transcript on disk; cache it so a
// burst of dashboard polls reuses one result instead of re-parsing each time.
function cachedClaudeUsageEvents() {
  const now = Date.now()
  if (usageEventsCache && now - usageEventsCache.at < usageCacheTtlMs) return usageEventsCache.events
  const events = claudeUsageEvents()
  usageEventsCache = { at: now, events }
  return events
}

function activeUsageBlock(events: Array<{ timestamp: number }>, durationMs: number, now = Date.now()) {
  let blockStart: number | null = null
  for (const event of events) {
    if (event.timestamp > now) continue
    if (!blockStart || event.timestamp >= blockStart + durationMs) blockStart = event.timestamp
  }
  return blockStart ? { startedAt: blockStart, resetAt: blockStart + durationMs } : null
}

function usageTotals(events: Array<{ timestamp: number; tokens: number }>, startMs: number, endMs: number) {
  return events.filter((event) => event.timestamp >= startMs && event.timestamp < endMs).reduce((acc, event) => {
    acc.tokens += event.tokens
    acc.messages += 1
    return acc
  }, { tokens: 0, messages: 0 })
}

function phaseRows() {
  type PhaseState = { id: string; status?: string; startedAt?: string; completedAt?: string; commitHash?: string }
  type ControlState = { phaseId: string; status?: string; updatedAt?: string; notes?: string; commitHash?: string }
  const phaseState = readJson<PhaseState[]>('phases.json', [])
  const controlState = readJson<ControlState[]>('build-control.json', [])
  const phaseById = new Map(phaseState.map((item) => [item.id, item]))
  const controlById = new Map(controlState.map((item) => [item.phaseId, item]))
  return phases.map(([id, name]) => {
    const phase = phaseById.get(id) ?? ({} as Partial<PhaseState>)
    const control = controlById.get(id) ?? ({} as Partial<ControlState>)
    const stoppedAt = phase.completedAt || (['complete', 'failed'].includes(control.status ?? '') ? control.updatedAt : null)
    return {
      id,
      name,
      phaseStatus: phase.status || 'not-started',
      buildStatus: control.status || 'pending',
      notes: control.notes || '',
      startedAt: phase.startedAt || null,
      stoppedAt,
      updatedAt: control.updatedAt || null,
      commitHash: phase.commitHash || control.commitHash || ''
    }
  })
}

export function GET() {
  type RunState = { pid?: number; phase?: string; workflow?: string; status?: string; startedAt?: string; heartbeatAt?: string; resumeAt?: string; message?: string }
  const run = readJson<RunState>('build-run.json', { status: 'idle' })
  const featureRun = readJson<RunState>('feature-run.json', { status: 'idle', workflow: 'features-development' })
  const frontendRun = readJson<RunState>('frontend-run.json', { status: 'idle', workflow: 'frontend-development' })
  const uiRun = readJson<RunState>('ui-run.json', { status: 'idle', workflow: 'ui-development', phase: 'UI-DEVELOPMENT' })
  const ready = readJson<{ ready?: boolean; summary?: { pass?: number; warning?: number; critical?: number }; createdAt?: string }>('ready.json', { ready: false, summary: { pass: 0, warning: 0, critical: 1 } })
  const start = readJson<{ ready?: boolean; phase?: string; createdAt?: string; steps?: unknown[] }>('start-readiness.json', { ready: false, steps: [] })
  const rows = phaseRows()
  const active = rows.find((row) => ['in-progress', 'paused', 'gates-running', 'pushing'].includes(row.buildStatus))
    || rows.find((row) => row.phaseStatus === 'in-progress')
    || rows.find((row) => row.phaseStatus !== 'done')
    || rows.at(-1)
    || rows[0]
  const live = isAlive(run.pid) && ['starting', 'running', 'paused'].includes(run.status ?? '')
  const featureLive = isAlive(featureRun.pid) && ['starting', 'running', 'paused'].includes(featureRun.status ?? '')
  const frontendLive = isAlive(frontendRun.pid) && ['starting', 'running', 'paused'].includes(frontendRun.status ?? '')
  const uiLive = isAlive(uiRun.pid) && ['starting', 'running', 'paused'].includes(uiRun.status ?? '')
  const heartbeatAgeMs = run.heartbeatAt ? Date.now() - new Date(run.heartbeatAt).getTime() : null
  const featureHeartbeatAgeMs = featureRun.heartbeatAt ? Date.now() - new Date(featureRun.heartbeatAt).getTime() : null
  const frontendHeartbeatAgeMs = frontendRun.heartbeatAt ? Date.now() - new Date(frontendRun.heartbeatAt).getTime() : null
  const uiHeartbeatAgeMs = uiRun.heartbeatAt ? Date.now() - new Date(uiRun.heartbeatAt).getTime() : null
  const heartbeat = heartbeatStatus(run, live, heartbeatAgeMs, active)
  const featureHeartbeat = heartbeatStatus(featureRun, featureLive, featureHeartbeatAgeMs)
  const frontendHeartbeat = heartbeatStatus(frontendRun, frontendLive, frontendHeartbeatAgeMs)
  const uiHeartbeat = heartbeatStatus(uiRun, uiLive, uiHeartbeatAgeMs)
  const done = rows.filter((row) => row.phaseStatus === 'done' || row.buildStatus === 'complete').length
  const total = rows.length
  const safeDone = Math.min(done, total)
  const logName = latestPhaseLog()
  const events = cachedClaudeUsageEvents()
  const sessionBlock = activeUsageBlock(events, sessionWindowMs)
  const sessionUsage = sessionBlock ? usageTotals(events, sessionBlock.startedAt, sessionBlock.resetAt) : { tokens: 0, messages: 0 }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    live,
    run: { ...run, heartbeatAgeMs },
    heartbeat: { status: heartbeat, samples: updateHeartbeatSamples(heartbeat, heartbeatAgeMs) },
    featureLive,
    featureRun: { ...featureRun, heartbeatAgeMs: featureHeartbeatAgeMs },
    featureHeartbeat: { status: featureHeartbeat, samples: updateFeatureHeartbeatSamples(featureHeartbeat, featureHeartbeatAgeMs) },
    frontendLive,
    frontendRun: { ...frontendRun, heartbeatAgeMs: frontendHeartbeatAgeMs },
    frontendHeartbeat: { status: frontendHeartbeat, samples: updateFrontendHeartbeatSamples(frontendHeartbeat, frontendHeartbeatAgeMs) },
    uiLive,
    uiRun: { ...uiRun, heartbeatAgeMs: uiHeartbeatAgeMs },
    uiHeartbeat: { status: uiHeartbeat, samples: updateUiHeartbeatSamples(uiHeartbeat, uiHeartbeatAgeMs) },
    ready: {
      ok: Boolean(ready.ready),
      pass: ready.summary?.pass || 0,
      warning: ready.summary?.warning || 0,
      critical: ready.summary?.critical || 0,
      updatedAt: ready.createdAt || fileStamp('ready.json')
    },
    startReadiness: {
      ok: Boolean(start.ready),
      phase: start.phase || null,
      updatedAt: start.createdAt || fileStamp('start-readiness.json')
    },
    active,
    progress: {
      done: safeDone,
      total,
      percent: total ? Math.round((safeDone / total) * 100) : 0,
      failed: rows.filter((row) => row.buildStatus === 'failed').length
    },
    claudeUsage: {
      session: {
        available: Boolean(sessionBlock),
        windowStartedAt: sessionBlock ? new Date(sessionBlock.startedAt).toISOString() : null,
        resetAt: sessionBlock ? new Date(sessionBlock.resetAt).toISOString() : null,
        percent: sessionBlock ? Math.min(100, Math.round(((Date.now() - sessionBlock.startedAt) / sessionWindowMs) * 100)) : 0,
        ...sessionUsage
      }
    },
    phases: rows,
    recentEvents: tail(logName, 100),
    files: { latestPhaseLog: logName }
  }, { headers: { 'cache-control': 'no-store' } })
}
