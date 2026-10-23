import { randomUUID } from 'node:crypto'

export type LayaMode = 'disabled' | 'shadow' | 'advisory' | 'live'
export type LayaTask = 'administrative_intent' | 'workflow_branch' | 'kb_relevance'
export type LayaLanguage = 'en' | 'es' | 'mixed' | 'unknown'
export type LayaPriority = 'explicit_button' | 'explicit_keyword' | 'active_state' | 'consent'
  | 'business_hours' | 'secretary_override' | 'emergency'

export interface LayaControls {
  enabled: boolean
  maximumMode: LayaMode
  clinicMode: LayaMode
  tasks: LayaTask[]
  /** Server-owned, independently reviewed held-out calibration; never model output. */
  qualification: {
    reviewed: boolean
    modelVersion: string
    calibrationVersion: string
    thresholds: Partial<Record<`${LayaTask}:${LayaLanguage}`, number>>
  }
}

export interface LayaCandidate { id: string; label: string }
export interface LayaInput {
  clinicId: string
  task: LayaTask
  language: LayaLanguage
  text: string
  candidates: LayaCandidate[]
  priority?: LayaPriority
  workflow?: { selectedId: string; publishedRevision: string; candidatesWorkflowId: string }
}
export interface LayaRequest {
  schemaVersion: 1
  requestId: string
  task: LayaTask
  language: LayaLanguage
  text: string
  candidates: LayaCandidate[]
}
export interface LayaResponse {
  schemaVersion: 1
  requestId: string
  modelVersion: string
  calibrationVersion: string
  choiceId: string | null
  /** Uncalibrated model score, not a probability of correctness. */
  rawScore: number
  abstain: boolean
}
export type LayaReason = 'disabled' | 'controls_unavailable' | 'deterministic_route' | 'invalid_input'
  | 'invalid_scope' | 'busy' | 'timeout' | 'transport_error' | 'invalid_response'
  | 'controls_changed' | 'uncertain' | 'unqualified' | 'qualified' | 'observe_only'
export interface LayaAssessment {
  outcome: 'fallback' | 'suggestion'
  reason: LayaReason
  mode: LayaMode
  apply: boolean
  choiceId?: string
  rawScore?: number
  /** Watch-only record of what the model picked when it was not allowed to act
   * (unqualified or below threshold). Never routes anything: `apply` stays false. */
  observedChoiceId?: string
}
export interface LayaDiagnostic {
  task: LayaTask
  language: LayaLanguage
  mode: LayaMode
  reason: LayaReason
  latencyMs: number
  modelVersion?: string
  calibrationVersion?: string
}
export interface LayaAdapterDependencies {
  /** Must resolve using authenticated server scope; never take controls from a request body. */
  readControls: (clinicId: string) => Promise<LayaControls>
  transport: (request: LayaRequest, signal: AbortSignal) => Promise<unknown>
  /** Minimal diagnostic only: no clinic, query, choices, patient/history or exception text. */
  record?: (diagnostic: LayaDiagnostic) => void
  timeoutMs?: number
  maxConcurrent?: number
}

const modes: LayaMode[] = ['disabled', 'shadow', 'advisory', 'live']
const tasks: LayaTask[] = ['administrative_intent', 'workflow_branch', 'kb_relevance']
const languages: LayaLanguage[] = ['en', 'es', 'mixed', 'unknown']
const responseKeys = ['schemaVersion', 'requestId', 'modelVersion', 'calibrationVersion', 'choiceId', 'rawScore', 'abstain']
const boundedText = (value: unknown, max: number): value is string => typeof value === 'string'
  && value.trim().length > 0 && value.length <= max
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

function validControls(value: LayaControls): boolean {
  return isObject(value) && typeof value.enabled === 'boolean' && modes.includes(value.maximumMode)
    && modes.includes(value.clinicMode) && Array.isArray(value.tasks) && value.tasks.every(task => tasks.includes(task))
    && isObject(value.qualification) && typeof value.qualification.reviewed === 'boolean'
    && boundedText(value.qualification.modelVersion, 128) && boundedText(value.qualification.calibrationVersion, 128)
    && isObject(value.qualification.thresholds)
    && Object.entries(value.qualification.thresholds).every(([key, threshold]) =>
      tasks.some(task => languages.some(language => key === `${task}:${language}`))
      && typeof threshold === 'number' && Number.isFinite(threshold) && threshold >= 0 && threshold <= 1)
}

function modeFor(controls: LayaControls, task: LayaTask): LayaMode {
  if (!controls.enabled || !controls.tasks.includes(task)) return 'disabled'
  return modes[Math.min(modes.indexOf(controls.maximumMode), modes.indexOf(controls.clinicMode))]!
}

function validResponse(value: unknown, request: LayaRequest, controls: LayaControls): value is LayaResponse {
  if (!isObject(value) || Object.keys(value).length !== responseKeys.length || Object.keys(value).some(key => !responseKeys.includes(key))) return false
  return value.schemaVersion === 1 && value.requestId === request.requestId
    && value.modelVersion === controls.qualification.modelVersion
    && value.calibrationVersion === controls.qualification.calibrationVersion
    && typeof value.rawScore === 'number' && Number.isFinite(value.rawScore) && value.rawScore >= 0 && value.rawScore <= 1
    && typeof value.abstain === 'boolean'
    && (value.choiceId === null ? value.abstain : request.candidates.some(candidate => candidate.id === value.choiceId))
}

/** No action tools, DB clients, credentials, provider settings or message history enter this adapter. */
export function createLayaAdapter(dependencies: LayaAdapterDependencies) {
  if (!Number.isFinite(dependencies.timeoutMs ?? 750) || !Number.isFinite(dependencies.maxConcurrent ?? 1)) {
    throw new Error('invalid LAYA resource bounds')
  }
  const timeoutMs = Math.max(10, Math.min(dependencies.timeoutMs ?? 750, 5_000))
  const maxConcurrent = Math.max(1, Math.min(Math.floor(dependencies.maxConcurrent ?? 1), 8))
  let active = 0
  let pendingDependencies = 0

  /** A timeout bounds caller latency, not dependency lifetime. Retain capacity until actual settlement. */
  async function runDependency<T>(operation: () => Promise<T>, requestedTimeout = timeoutMs): Promise<T> {
    if (pendingDependencies >= maxConcurrent) throw new Error('dependency busy')
    if (!Number.isFinite(requestedTimeout)) throw new Error('invalid dependency timeout')
    pendingDependencies++
    const work = Promise.resolve().then(operation).finally(() => { pendingDependencies-- })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([work, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('dependency timeout')), Math.max(10, Math.min(requestedTimeout, 5000)))
      })])
    } finally { clearTimeout(timer) }
  }

  async function readControls(clinicId: string): Promise<LayaControls> {
      const controls = await runDependency(() => dependencies.readControls(clinicId))
      if (!validControls(controls)) throw new Error('invalid controls')
      // Snapshot mutable store objects so post-inference comparison cannot be bypassed by in-place mutation.
      return structuredClone(controls)
  }

  return {
    activeRequests: () => active,
    runDependency,
    /** Passage-free preflight. Null means unavailable; no inference is performed. */
    async taskMode(clinicId: string, task: LayaTask): Promise<LayaMode | null> {
      if (!boundedText(clinicId, 128) || !tasks.includes(task)) return null
      try { return modeFor(await readControls(clinicId), task) } catch { return null }
    },
    async assess(input: LayaInput): Promise<LayaAssessment> {
      const start = performance.now()
      let mode: LayaMode = 'disabled'
      let controls: LayaControls | undefined
      const finish = (reason: LayaReason, extra: Partial<LayaAssessment> = {}): LayaAssessment => {
        const result: LayaAssessment = { outcome: 'fallback', reason, mode, apply: false, ...extra }
        // Diagnostic failure must not break existing routing. Sinks must be synchronous/nonblocking.
        try { if (isObject(input) && tasks.includes(input.task) && languages.includes(input.language)) dependencies.record?.({ task: input.task, language: input.language, mode, reason,
          latencyMs: Math.max(0, Math.round(performance.now() - start)),
          ...(controls ? { modelVersion: controls.qualification.modelVersion, calibrationVersion: controls.qualification.calibrationVersion } : {}),
        }) } catch { /* deliberately no exception text */ }
        return result
      }
      if (!isObject(input) || !boundedText(input.clinicId, 128) || !tasks.includes(input.task) || !languages.includes(input.language)
        || !boundedText(input.text, 1600) || !Array.isArray(input.candidates) || input.candidates.length < 1
        || input.candidates.length > 7 || input.candidates.some(candidate => !isObject(candidate)
          || !boundedText(candidate.id, 128) || !boundedText(candidate.label, 1200))
        || new Set(input.candidates.map(candidate => candidate.id)).size !== input.candidates.length
        || input.text.length + input.candidates.reduce((size, candidate) => size + candidate.label.length + candidate.id.length, 0) > 6000) {
        return finish('invalid_input')
      }
      // Capture only validated fields before yielding: callers must not change the tenant or request mid-flight.
      input = { clinicId: input.clinicId, task: input.task, language: input.language, text: input.text,
        candidates: input.candidates.map(({ id, label }) => ({ id, label })), priority: input.priority,
        ...(input.workflow ? { workflow: { ...input.workflow } } : {}) }
      if (input.priority !== undefined) return finish('deterministic_route')
      if (input.task === 'workflow_branch' && (!input.workflow
        || !boundedText(input.workflow.selectedId, 128) || !boundedText(input.workflow.publishedRevision, 128)
        || input.workflow.selectedId !== input.workflow.candidatesWorkflowId)) return finish('invalid_scope')
      try { controls = await readControls(input.clinicId) } catch { return finish('controls_unavailable') }
      mode = modeFor(controls, input.task)
      if (mode === 'disabled') return finish('disabled')
      if (active >= maxConcurrent) return finish('busy')

      // Explicit projection prevents unknown request properties reaching the model.
      const request: LayaRequest = { schemaVersion: 1, requestId: randomUUID(), task: input.task,
        language: input.language, text: input.text, candidates: input.candidates.map(({ id, label }) => ({ id, label })) }
      const controller = new AbortController()
      const timeout = Symbol('timeout')
      let timer: ReturnType<typeof setTimeout> | undefined
      active++
      const work = Promise.resolve().then(() => dependencies.transport(request, controller.signal))
        .then(value => ({ value }), () => ({ failed: true as const }))
        .finally(() => { active-- })
      try {
        const response = await Promise.race([work, new Promise<typeof timeout>(resolve => {
          timer = setTimeout(() => { controller.abort(); resolve(timeout) }, timeoutMs)
        })])
        if (response === timeout) return finish('timeout')
        if ('failed' in response) return finish('transport_error')
        if (!validResponse(response.value, request, controls)) return finish('invalid_response')
        let current: LayaControls
        try { current = await readControls(input.clinicId) } catch { return finish('controls_unavailable') }
        if (JSON.stringify(current) !== JSON.stringify(controls)) return finish('controls_changed')
        const value = response.value
        if (value.abstain || value.choiceId === null) return finish('uncertain', { rawScore: value.rawScore })
        const threshold = controls.qualification.thresholds[`${input.task}:${input.language}`]
        if (!controls.qualification.reviewed || threshold === undefined) {
          return finish('unqualified', { rawScore: value.rawScore, observedChoiceId: value.choiceId })
        }
        if (value.rawScore < threshold) return finish('uncertain', { rawScore: value.rawScore, observedChoiceId: value.choiceId })
        return finish(mode === 'live' ? 'qualified' : 'observe_only', {
          outcome: 'suggestion', choiceId: value.choiceId, rawScore: value.rawScore, apply: mode === 'live',
        })
      } finally { clearTimeout(timer) }
    },
  }
}
