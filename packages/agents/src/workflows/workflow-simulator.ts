import type { Workflow, WorkflowEdge, WorkflowNode } from '@docmee/db'
import { layaCommittingMenuOptions } from '../laya/observations.js'
import { validCapturedReply } from './capture-validation.js'
import {
  decideLayaMenuReply,
  decideLayaPreselect,
  readPendingReadback,
  LAYA_READBACK_CONTEXT_KEY,
  type LayaMenuDecision,
} from './laya-menu.js'
import {
  runWorkflowWithOutcome,
  MENU_HOLD_OUTCOME,
  type WorkflowMenuOption,
  WORKFLOW_MENU_CONTEXT_KEY,
  WORKFLOW_CAPTURE_CONTEXT_KEY,
  type WorkflowCaptureState,
  SLOT_MENU_MORE_OPTION_ID,
  WORKFLOW_SLOT_MENU_CONTEXT_KEY,
  parseMenuOptions,
  resolveMenuHandle,
  selectWorkflowEdge,
  type AiAgentOutcome,
  type WorkflowContext,
  type WorkflowMenuState,
  type WorkflowSlotMenuState,
} from './workflow-engine.js'

export type SimulationProviderOutcome = 'success' | 'failure' | 'empty'
export const SIMULATION_REPLAY_LIMITS = { steps: 100, effects: 100, summaryCharacters: 500 } as const

export interface WorkflowSimulationInput {
  context?: WorkflowContext
  replay?: WorkflowSimulationReplay
  reply?: { text?: string; optionId?: string }
  approval?: 'approved' | 'rejected' | 'timeout'
  advanceTimeMs?: number
  virtualNowMs?: number
  maxSteps?: number
  scenarios?: {
    providerOutcomes?: Record<string, SimulationProviderOutcome>
    intentOutcome?: 'high' | 'low' | 'error'
    aiAgentOutcome?: AiAgentOutcome
    slots?: string[]
  }
}

export interface WorkflowSimulationReplay {
  startNodeId: string
  context: WorkflowContext
  trace: WorkflowSimulationStep[]
  effects: WorkflowSimulationEffect[]
  virtualNowMs: number
  waitingFor?: WorkflowSimulationWait
}

export interface WorkflowSimulationStep {
  nodeId: string
  type: string
  status: 'ran' | 'paused' | 'ended' | 'failed'
  context: WorkflowContext
  selectedEdgeId?: string
}

export interface WorkflowSimulationEffect {
  nodeId: string
  /** 'laya' = the real LAYA model scored a typed reply (not mocked). Everything else is mocked. */
  kind: 'message' | 'template' | 'notification' | 'tag' | 'draft' | 'approval' | 'provider' | 'handoff' | 'laya'
  mocked: boolean
  summary: string
}

/** What LAYA made of one typed reply, as reported by the server hook. */
export interface LayaSimulationPick {
  /** Option LAYA may route to (clinic live, reviewed qualification, above threshold), else null. */
  choiceId: string | null
  /** What LAYA would pick even when it may not act. */
  observedChoiceId?: string | null
  score?: number | null
  /** Short machine reason: qualified, uncertain, unqualified, disabled, timeout, ... */
  reason?: string
  /** Opaque reference to the saved training example, used to label it later. */
  ref?: string
}

/**
 * Optional server hooks that let a simulation use the real LAYA model and save what the tester
 * confirms or corrects as training examples. Without hooks the simulator stays fully offline.
 */
export interface WorkflowSimulationHooks {
  layaChoose?: (input: { nodeId: string; text: string; options: WorkflowMenuOption[]; source: 'menu_trigger' | 'menu_unmatched' }) => Promise<LayaSimulationPick | null>
  layaLabel?: (input: { ref: string; nodeId: string; optionId: string; how: 'next_tap' | 'readback_yes' }) => Promise<boolean>
}

export interface WorkflowSimulationLayaStats { calls: number; examplesSaved: number; labelsSaved: number }

/** Context key: the latest saved, still unlabelled LAYA example for a menu. */
export const LAYA_SIMULATION_EXAMPLE_KEY = 'layaSimulationExample'

export type WorkflowSimulationWait =
  | { kind: 'reply' | 'menu' | 'approval'; nodeId: string }
  | { kind: 'delay'; nodeId: string; remainingMs: number; resumeAtMs: number }

export interface WorkflowSimulationError {
  nodeId?: string
  code: 'mock_provider_failure' | 'unsupported_node' | 'simulation_error' | 'step_limit'
  title: string
  whatHappened: string
  howToFix: string
  technicalDetails?: string
}

export interface WorkflowSimulationResult {
  status: 'completed' | 'waiting' | 'paused' | 'failed'
  trace: WorkflowSimulationStep[]
  effects: WorkflowSimulationEffect[]
  context: WorkflowContext
  virtualNowMs: number
  waitingFor?: WorkflowSimulationWait
  replay?: WorkflowSimulationReplay
  errors: WorkflowSimulationError[]
  coverage: {
    testedNodeIds: string[]
    untestedNodeIds: string[]
    testedEdgeIds: string[]
    untestedEdgeIds: string[]
  }
  /** externalCalls / persistentWrites stay 0 unless LAYA ran: then they count its model calls and training rows. */
  safety: { isolated: true; externalCalls: number; persistentWrites: number; queuedJobs: 0 }
  /** Present when the server let this simulation use LAYA: model calls and training rows saved. */
  laya?: WorkflowSimulationLayaStats
}

class MockProviderFailure extends Error {
  constructor(readonly nodeId: string) {
    super(`Mocked provider failure at ${nodeId}`)
  }
}

/**
 * Deterministic dry-run: it exercises graph routing but never invokes a
 * provider, persists a record, or queues a future job.  The returned trace is
 * safe to show in the workflow editor as a preview rather than live evidence.
 */
export async function simulateWorkflow(
  workflow: Pick<Workflow, 'nodes' | 'edges'>,
  input: WorkflowSimulationInput = {},
  hooks: WorkflowSimulationHooks = {},
): Promise<WorkflowSimulationResult> {
  const stats: WorkflowSimulationLayaStats = { calls: 0, examplesSaved: 0, labelsSaved: 0 }
  const result = await simulate(workflow, input, hooks, stats)
  if (!hooks.layaChoose) return result
  // LAYA is the one thing that is not mocked: report its model calls and saved training rows honestly.
  return {
    ...result,
    safety: { ...result.safety, externalCalls: stats.calls, persistentWrites: stats.examplesSaved + stats.labelsSaved },
    laya: stats,
  }
}

async function simulate(
  workflow: Pick<Workflow, 'nodes' | 'edges'>,
  input: WorkflowSimulationInput,
  hooks: WorkflowSimulationHooks,
  stats: WorkflowSimulationLayaStats,
): Promise<WorkflowSimulationResult> {
  const prior = input.replay
  const ctx: WorkflowContext = { ...(prior?.context ?? {}), ...(input.context ?? {}) }
  const effects: WorkflowSimulationEffect[] = [...(prior?.effects ?? [])]
  const priorTrace = (prior?.trace ?? []).map((step) => ({ ...step }))
  let virtualNowMs = prior?.virtualNowMs ?? input.virtualNowMs ?? 0
  virtualNowMs += Math.max(0, input.advanceTimeMs ?? 0)
  if (priorTrace.length >= SIMULATION_REPLAY_LIMITS.steps || effects.length >= SIMULATION_REPLAY_LIMITS.effects) {
    return buildResult(workflow, 'failed', priorTrace, effects, ctx, virtualNowMs, undefined, undefined, [budgetError()])
  }

  if (prior?.waitingFor?.kind === 'delay' && virtualNowMs < prior.waitingFor.resumeAtMs) {
    return buildResult(workflow, 'waiting', priorTrace, effects, ctx, virtualNowMs, {
      ...prior.waitingFor,
      remainingMs: prior.waitingFor.resumeAtMs - virtualNowMs,
    }, prior.startNodeId)
  }
  if (prior?.waitingFor?.kind === 'reply' && !input.reply) {
    return buildResult(workflow, 'waiting', priorTrace, effects, ctx, virtualNowMs, prior.waitingFor, prior.startNodeId)
  }
  if (prior?.waitingFor?.kind === 'menu' && !input.reply) {
    return buildResult(workflow, 'waiting', priorTrace, effects, ctx, virtualNowMs, prior.waitingFor, prior.startNodeId)
  }
  if (prior?.waitingFor?.kind === 'approval' && !input.approval) {
    return buildResult(workflow, 'waiting', priorTrace, effects, ctx, virtualNowMs, prior.waitingFor, prior.startNodeId)
  }

  if (input.reply) {
    ctx.message = input.reply.text ?? ''
    ctx.interactiveReplyId = input.reply.optionId
  }
  let startNodeId = prior?.startNodeId
  if (prior?.waitingFor?.kind === 'approval' && input.approval) {
    ctx.approvalOutcome = input.approval
    startNodeId = nextNodeId(workflow.edges, prior.waitingFor.nodeId, input.approval) ?? prior.startNodeId
  }
  if (prior?.waitingFor && prior.waitingFor.kind !== 'menu' && !ctx[WORKFLOW_CAPTURE_CONTEXT_KEY]) {
    const selected = selectWorkflowEdge(workflow.edges, prior.waitingFor.nodeId, input.approval)
    const last = priorTrace.at(-1)
    if (selected && last) last.selectedEdgeId = selected.id
  }

  let scheduled: { nodeId: string; delayMs: number } | undefined
  let pausedAt: { kind: 'reply' | 'menu'; nodeId: string; resumeNodeId: string } | undefined
  let activeNodeId: string | undefined
  const segment: WorkflowSimulationStep[] = []
  const record = (kind: WorkflowSimulationEffect['kind'], summary: string) => {
    if (activeNodeId) effects.push({ nodeId: activeNodeId, kind, mocked: true, summary: summary.slice(0, SIMULATION_REPLAY_LIMITS.summaryCharacters) })
  }
  const provider = (node: WorkflowNode, mutate?: () => void) => {
    activeNodeId = node.id
    if (input.scenarios?.providerOutcomes?.[node.id] === 'failure' || input.scenarios?.providerOutcomes?.[node.type] === 'failure') {
      throw new MockProviderFailure(node.id)
    }
    mutate?.()
    record('provider', `${node.type} completed with mocked data`)
  }
  const empty = (node: WorkflowNode) => (input.scenarios?.providerOutcomes?.[node.id] ?? input.scenarios?.providerOutcomes?.[node.type]) === 'empty'
  const menuItems = (node: WorkflowNode, page = 0, slot = false): { id: string; title: string }[] => {
    const size = boundedInteger(node.config?.pageSize, 8, 1, 9)
    let items: { id: string; title: string }[]
    if (slot) {
      const slots = ctx[String(node.config?.slotsField ?? 'available_slots')]
      const times = node.config?.pickerMode === 'time'
      const date = String(ctx[String(node.config?.dateField ?? 'preferred_date')] ?? '').slice(0, 10)
      const starts = Array.isArray(slots) ? slots.flatMap((entry) => entry && typeof entry.start === 'string' && typeof entry.end === 'string' ? [entry.start as string] : []) : []
      items = unique(starts.filter((start) => !times || start.slice(0, 10) === date).map((start) => times ? start.slice(11, 16) : start.slice(0, 10))).sort().map((id) => ({ id, title: times ? formatTime(id) : new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${id}T00:00:00Z`)) }))
    } else {
      const source = String(node.config?.optionSource ?? 'static')
      // Explicitly synthetic fixtures: never query clinic data in a dry run.
      items = empty(node) ? []
        : source === 'clinic_doctors' ? [{ id: 'mock-doctor-1', title: 'Mock doctor' }]
        : source === 'patient_appointments' ? [{ id: 'mock-appointment-1', title: 'Mock appointment' }]
        : [{ id: 'mock-service-1', title: 'Mock service' }]
    }
    return items.slice(Math.max(0, page) * size, (Math.max(0, page) + 1) * size)
  }
  // ── LAYA (only when the server passed hooks) ─────────────────────────────
  // Same decision as the live WhatsApp worker: packages/agents workflows/laya-menu.ts.
  const committing = layaCommittingMenuOptions(workflow.nodes, workflow.edges)
  let triggerTextUsed = Boolean(prior)
  const note = (nodeId: string, summary: string) => {
    effects.push({ nodeId, kind: 'laya', mocked: false, summary: summary.slice(0, SIMULATION_REPLAY_LIMITS.summaryCharacters) })
  }
  const titleOf = (options: WorkflowMenuOption[], optionId: string | null | undefined) =>
    options.find((option) => option.optionId === optionId)?.title ?? optionId ?? ''
  const askLaya = async (nodeId: string, text: string, options: WorkflowMenuOption[], source: 'menu_trigger' | 'menu_unmatched') => {
    if (!hooks.layaChoose) return null
    stats.calls++
    let pick: LayaSimulationPick | null = null
    try { pick = await hooks.layaChoose({ nodeId, text, options, source }) } catch { pick = null }
    if (pick?.ref) {
      stats.examplesSaved++
      ctx[LAYA_SIMULATION_EXAMPLE_KEY] = { nodeId, ref: pick.ref, layaChoiceId: pick.choiceId ?? pick.observedChoiceId ?? null }
    }
    return pick
  }
  const describePick = (nodeId: string, options: WorkflowMenuOption[], pick: LayaSimulationPick | null, decision?: Pick<LayaMenuDecision, 'laya'> | null) => {
    if (!pick) { note(nodeId, 'LAYA unavailable: the menu’s own default route runs.'); return }
    const score = typeof pick.score === 'number' ? ` (score ${pick.score.toFixed(2)})` : ''
    const saved = pick.ref ? ' Saved as a training example.' : ''
    if (decision?.laya?.check === 'confirm') note(nodeId, `LAYA picked “${decision.laya.title}”${score}. Booking change: asking YES/NO first.${saved}`)
    else if (decision?.laya) note(nodeId, `LAYA picked “${decision.laya.title}”${score} and routed.${saved}`)
    else if (pick.observedChoiceId) note(nodeId, `LAYA would pick “${titleOf(options, pick.observedChoiceId)}”${score} but may not act (${pick.reason ?? 'not allowed'}).${saved}`)
    else note(nodeId, `LAYA had no confident pick (${pick.reason ?? 'uncertain'}).${saved}`)
  }
  const labelExample = async (nodeId: string, options: WorkflowMenuOption[], optionId: string, how: 'next_tap' | 'readback_yes') => {
    const example = ctx[LAYA_SIMULATION_EXAMPLE_KEY] as { nodeId?: unknown; ref?: unknown; layaChoiceId?: unknown } | undefined
    if (!hooks.layaLabel || !example || example.nodeId !== nodeId || typeof example.ref !== 'string') return
    delete ctx[LAYA_SIMULATION_EXAMPLE_KEY]
    let saved = false
    try { saved = await hooks.layaLabel({ ref: example.ref, nodeId, optionId, how }) } catch { saved = false }
    if (!saved) return
    stats.labelsSaved++
    const layaChoice = typeof example.layaChoiceId === 'string' ? example.layaChoiceId : null
    note(nodeId, how === 'readback_yes'
      ? `Confirmed with YES: training example labelled “${titleOf(options, optionId)}”.`
      : layaChoice && layaChoice !== optionId
        ? `Corrected: training example labelled “${titleOf(options, optionId)}” (LAYA picked “${titleOf(options, layaChoice)}”).`
        : `Training example labelled “${titleOf(options, optionId)}”.`)
  }
  const layaMenuReply = async (node: WorkflowNode, page: number): Promise<string> => {
    activeNodeId = node.id
    const options = parseMenuOptions(node.config)
    const pending = readPendingReadback(ctx[LAYA_READBACK_CONTEXT_KEY])
    delete ctx[LAYA_READBACK_CONTEXT_KEY]
    let pick: LayaSimulationPick | null = null
    let asked = false
    const decision = await decideLayaMenuReply({
      nodeId: node.id, options, replyId: input.reply?.optionId, text: input.reply?.text ?? '', pending,
      committing: committing.get(node.id),
      choose: async (typed, menuOptions) => {
        asked = true
        pick = await askLaya(node.id, typed, menuOptions, 'menu_unmatched')
        return pick?.choiceId ?? null
      },
    })
    if (asked) describePick(node.id, options, pick, decision)
    if (decision.pickedOptionId) await labelExample(node.id, options, decision.pickedOptionId, 'next_tap')
    if (decision.confirmedOptionId) await labelExample(node.id, options, decision.confirmedOptionId, 'readback_yes')
    if (decision.handle === MENU_HOLD_OUTCOME && decision.pending && decision.message) {
      ctx[LAYA_READBACK_CONTEXT_KEY] = decision.pending
      record('message', decision.message)
      ctx[WORKFLOW_MENU_CONTEXT_KEY] = { nodeId: node.id, page, status: 'pending' } satisfies WorkflowMenuState
      pausedAt = { kind: 'menu', nodeId: node.id, resumeNodeId: node.id }
      return MENU_HOLD_OUTCOME
    }
    if (decision.message) record('message', decision.message)
    return decision.handle
  }
  const layaPreselect = async (node: WorkflowNode): Promise<string | null> => {
    if (triggerTextUsed) return null
    triggerTextUsed = true
    const text = String(ctx.message ?? '')
    if (!text.trim()) return null
    activeNodeId = node.id
    const options = parseMenuOptions(node.config)
    let pick: LayaSimulationPick | null = null
    let asked = false
    const picked = await decideLayaPreselect({
      options, text, committing: committing.get(node.id),
      choose: async (typed, menuOptions) => {
        asked = true
        pick = await askLaya(node.id, typed, menuOptions, 'menu_trigger')
        return pick?.choiceId ?? null
      },
    })
    if (asked) describePick(node.id, options, pick, picked ? { laya: { optionId: picked.optionId, title: picked.title, check: 'routed' } } : null)
    if (!picked) return null
    record('message', picked.message)
    return picked.optionId
  }

  const matchItems = (items: { id: string; title: string }[], slot: boolean) => {
    const text = (input.reply?.text ?? '').trim()
    if (text === '0') return { outcome: 'restart' }
    if (text === '1') return { outcome: 'livechat' }
    if (input.reply?.optionId === SLOT_MENU_MORE_OPTION_ID || text.toLowerCase() === (slot ? 'see other schedules' : 'see more')) return { outcome: 'more' }
    const index = Number(text)
    const selected = items.find((item) => item.id === input.reply?.optionId) ?? items.find((item) => item.title.toLowerCase() === text.toLowerCase()) ?? (Number.isInteger(index) && index >= (slot ? 1 : 2) ? items[index - 1] : undefined)
    return selected ? { outcome: 'selected', value: selected.id, label: selected.title } : { outcome: 'default' }
  }

  try {
    const outcome = await runWorkflowWithOutcome(workflow, ctx, {
      runSideEffect: async (node, _context, invoke) => {
        activeNodeId = node.id
        return invoke()
      },
      sendMessage: (text) => record('message', text || 'Empty message'),
      sendTemplate: (category) => record('template', category || 'Unspecified template'),
      notifySecretary: () => record('notification', 'Secretary notification mocked'),
      handoffSecretary: () => record('handoff', 'Secretary handoff mocked'),
      addTag: (tag) => record('tag', tag || 'Empty tag'),
      aiDraft: () => record('draft', 'AI draft mocked; no model called'),
      requestApproval: (node) => {
        activeNodeId = node.id
        record('approval', 'Approval request mocked')
      },
      transcribeBookingVoice: (node) => provider(node, () => { ctx.transcription = 'Mock transcription' }),
      checkAvailability: (node) => provider(node, () => {
        const slots = empty(node) ? [] : (input.scenarios?.slots ?? ['2030-01-01T10:00:00Z']).map((start) => ({ start, end: new Date(new Date(start).getTime() + 30 * 60_000).toISOString() }))
        ctx[String(node.config?.slotsField ?? 'available_slots')] = slots
        ctx.availability_count = slots.length
      }),
      offerSlots: (node) => provider(node),
      createOrRescheduleBooking: (node) => provider(node, () => {
        ctx.booking_status = node.type === 'action.reschedule_booking' || node.config?.mode === 'reschedule' ? 'rescheduled' : 'created'
        ctx.calendar_sync_pending = false
        ctx.appointment_id = ctx.appointment_id || 'simulated-appointment'
      }),
      cancelBooking: (node) => provider(node, () => { ctx.booking_status = 'cancelled'; ctx.calendar_sync_pending = false }),
      askAndCapture: (node) => {
        provider(node)
        const existing = ctx[WORKFLOW_CAPTURE_CONTEXT_KEY] as WorkflowCaptureState | undefined
        if (existing?.nodeId === node.id && existing.status === 'pending') {
          const reply = String(ctx.message ?? '').trim()
          if (validCapturedReply(existing.validation, reply)) {
            ctx[existing.field] = existing.validation === 'phone' ? reply.replace(/[\s().-]/g, '') : reply
            ctx.capture_status = 'captured'
            ctx[WORKFLOW_CAPTURE_CONTEXT_KEY] = { ...existing, status: 'captured' }
          } else {
            const attempts = existing.attempts + 1
            const status = attempts >= existing.maxAttempts ? 'error' : 'pending'
            ctx.capture_status = status
            ctx[WORKFLOW_CAPTURE_CONTEXT_KEY] = { ...existing, attempts, status }
            if (status === 'error') ctx.capture_error = `invalid_${existing.validation}`
            record(status === 'error' ? 'notification' : 'message', status === 'error' ? 'Capture attempts exhausted' : existing.retryQuestion)
          }
          return
        }
        const field = String(node.config?.field ?? 'answer').trim()
        const validation = String(node.config?.validation ?? 'required')
        const current = String(ctx[field] ?? '').trim()
        const question = String(node.config?.question ?? `Please provide ${field.replaceAll('_', ' ')}.`).trim()
        const captured = !!current && !ctx.interactiveReplyId && validCapturedReply(validation, current)
        if (!captured) delete ctx[field]
        ctx.capture_status = captured ? 'captured' : 'pending'
        ctx[WORKFLOW_CAPTURE_CONTEXT_KEY] = { nodeId: node.id, field, question, retryQuestion: String(node.config?.retryQuestion ?? `I couldn't validate that. ${question}`), validation, attempts: 0, maxAttempts: boundedInteger(node.config?.maxAttempts, 3, 1, 10), status: captured ? 'captured' : 'pending' } satisfies WorkflowCaptureState
        if (!captured) record('message', question)
      },
      extractBookingDetails: (node) => provider(node, () => { ctx.bookingDetails = { mocked: true } }),
      classifyIntentConfidence: () => input.scenarios?.intentOutcome ?? 'high',
      waitForReply: (node, resumeNodeId) => {
        const capture = ctx[WORKFLOW_CAPTURE_CONTEXT_KEY] as WorkflowCaptureState | undefined
        if (capture && capture.status !== 'pending') {
          delete ctx[WORKFLOW_CAPTURE_CONTEXT_KEY]
          return false
        }
        if (capture) resumeNodeId = capture.nodeId
        pausedAt = { kind: 'reply', nodeId: node.id, resumeNodeId }
        return true
      },
      scheduleResume: (nodeId, delayMs) => { scheduled = { nodeId, delayMs } },
      sendInteractiveMenu: (node, _context, page = 0) => {
        activeNodeId = node.id
        const dynamic = String(node.config?.optionSource ?? 'static') !== 'static'
        const items = dynamic ? menuItems(node, page) : []
        if (dynamic && !items.length) return false
        ctx[WORKFLOW_MENU_CONTEXT_KEY] = { nodeId: node.id, page, status: 'pending' } satisfies WorkflowMenuState
        pausedAt = { kind: 'menu', nodeId: node.id, resumeNodeId: node.id }
        record('message', dynamic ? `Interactive menu mocked: ${items.map((item) => `${item.title} (${item.id})`).join(', ')}` : 'Interactive menu mocked')
        return true
      },
      matchMenuReply: (node, _context, page = 0) => String(node.config?.optionSource ?? 'static') !== 'static'
        ? matchItems(menuItems(node, page), false)
        : hooks.layaChoose ? layaMenuReply(node, page) : resolveMenuHandle(parseMenuOptions(node.config), input.reply?.optionId, input.reply?.text),
      ...(hooks.layaChoose ? { preselectMenuOption: (node: WorkflowNode) => layaPreselect(node) } : {}),
      sendSlotMenu: (node, _context, page) => {
        activeNodeId = node.id
        const items = menuItems(node, page, true)
        if (!items.length) return false
        ctx[WORKFLOW_SLOT_MENU_CONTEXT_KEY] = { nodeId: node.id, page, status: 'pending' } satisfies WorkflowSlotMenuState
        pausedAt = { kind: 'menu', nodeId: node.id, resumeNodeId: node.id }
        record('message', `Slot menu mocked: ${items.map((item) => `${item.title} (${item.id})`).join(', ')}`)
        return true
      },
      matchSlotMenuReply: (node, _context, page = 0) => {
        const result = matchItems(menuItems(node, page, true), true)
        if (result.outcome === 'selected') ctx[String(node.config?.selectField ?? (node.config?.pickerMode === 'time' ? 'preferred_time' : 'preferred_date'))] = result.value
        return result.outcome as 'selected' | 'default' | 'more' | 'restart' | 'livechat'
      },
      aiAgent: () => input.scenarios?.aiAgentOutcome ?? 'no_match',
    }, {
      startNodeId,
      maxSteps: Math.min(input.maxSteps ?? 100, SIMULATION_REPLAY_LIMITS.steps - priorTrace.length, SIMULATION_REPLAY_LIMITS.effects - effects.length),
      onStep: (step, stepContext) => segment.push({ ...step, context: cloneContext(stepContext) }),
      onTransition: (edge) => {
        const last = segment.at(-1)
        if (last) last.selectedEdgeId = edge.id
      },
    })

    const trace = [...priorTrace, ...segment]
    if (outcome.status === 'waiting') {
      const last = outcome.trace.at(-1)
      if (!last) return buildResult(workflow, 'completed', trace, effects, ctx, virtualNowMs)
      if (outcome.resumeReason === 'delay' && scheduled) {
        const waitingFor: WorkflowSimulationWait = { kind: 'delay', nodeId: last.nodeId, remainingMs: scheduled.delayMs, resumeAtMs: virtualNowMs + scheduled.delayMs }
        return buildResult(workflow, 'waiting', trace, effects, ctx, virtualNowMs, waitingFor, scheduled.nodeId)
      }
      if (outcome.resumeReason === 'approval') {
        return buildResult(workflow, 'waiting', trace, effects, ctx, virtualNowMs, { kind: 'approval', nodeId: last.nodeId }, outcome.currentNodeId ?? last.nodeId)
      }
      const wait = pausedAt ?? { kind: outcome.resumeReason === 'reply' ? 'reply' as const : 'menu' as const, nodeId: last.nodeId, resumeNodeId: outcome.currentNodeId ?? last.nodeId }
      return buildResult(workflow, 'waiting', trace, effects, ctx, virtualNowMs, { kind: wait.kind, nodeId: wait.nodeId }, wait.resumeNodeId)
    }

    if (outcome.stopReason === 'step_limit' && outcome.nextNodeId) {
      return buildResult(workflow, 'paused', trace, effects, ctx, virtualNowMs, undefined, outcome.nextNodeId)
    }
    if (outcome.stopReason === 'cycle') {
      return buildResult(workflow, 'failed', trace, effects, ctx, virtualNowMs, undefined, undefined, [{ nodeId: outcome.nextNodeId ?? trace.at(-1)?.nodeId, code: 'simulation_error', title: 'A loop stopped this simulation', whatHappened: 'The engine cycle guard stopped this path before completion.', howToFix: 'Review the loop and add a reply or delay boundary before repeating steps.' }])
    }
    return buildResult(workflow, 'completed', trace, effects, ctx, virtualNowMs)
  } catch (error) {
    const nodeId = error instanceof MockProviderFailure ? error.nodeId : nodeIdFromError(error)
    const unsupported = error instanceof Error && error.message.includes('unsupported type')
    const simulationError: WorkflowSimulationError = error instanceof MockProviderFailure
      ? { nodeId, code: 'mock_provider_failure', title: 'Mock provider failed', whatHappened: 'The selected failure scenario stopped this simulated path.', howToFix: 'Choose a successful scenario or inspect the node’s provider error path.', technicalDetails: error.message }
      : { nodeId, code: unsupported ? 'unsupported_node' : 'simulation_error', title: unsupported ? 'This step cannot be simulated' : 'Simulation stopped', whatHappened: error instanceof Error ? error.message : 'An unknown simulation error occurred.', howToFix: unsupported ? 'Replace this step with a supported workflow node before testing again.' : 'Review this node’s configuration and retry.' }
    const failedNode = nodeId && !segment.some((step) => step.nodeId === nodeId)
      ? workflow.nodes.find((node) => node.id === nodeId)
      : undefined
    const failedStep: WorkflowSimulationStep[] = failedNode
      ? [{ nodeId: failedNode.id, type: failedNode.type, status: 'failed', context: cloneContext(ctx) }]
      : []
    return buildResult(workflow, 'failed', [...priorTrace, ...segment, ...failedStep], effects, ctx, virtualNowMs, undefined, undefined, [simulationError])
  }
}

function buildResult(
  workflow: Pick<Workflow, 'nodes' | 'edges'>,
  status: WorkflowSimulationResult['status'],
  trace: WorkflowSimulationStep[],
  effects: WorkflowSimulationEffect[],
  context: WorkflowContext,
  virtualNowMs: number,
  waitingFor?: WorkflowSimulationWait,
  startNodeId?: string,
  errors: WorkflowSimulationError[] = [],
): WorkflowSimulationResult {
  const testedNodeIds = unique(trace.map((step) => step.nodeId))
  const testedEdgeIds = unique(trace.flatMap((step) => step.selectedEdgeId ? [step.selectedEdgeId] : []))
  if (startNodeId && (trace.length >= SIMULATION_REPLAY_LIMITS.steps || effects.length >= SIMULATION_REPLAY_LIMITS.effects)) {
    status = 'failed'
    startNodeId = undefined
    waitingFor = undefined
    errors = [budgetError()]
  }
  const replay = startNodeId ? { startNodeId, context: cloneContext(context), trace, effects, virtualNowMs, ...(waitingFor ? { waitingFor } : {}) } : undefined
  return {
    status,
    trace,
    effects,
    context: cloneContext(context),
    virtualNowMs,
    ...(waitingFor ? { waitingFor } : {}),
    ...(replay ? { replay } : {}),
    errors,
    coverage: {
      testedNodeIds,
      untestedNodeIds: workflow.nodes.map((node) => node.id).filter((id) => !testedNodeIds.includes(id)),
      testedEdgeIds,
      untestedEdgeIds: workflow.edges.map((edge) => edge.id).filter((id) => !testedEdgeIds.includes(id)),
    },
    safety: { isolated: true, externalCalls: 0, persistentWrites: 0, queuedJobs: 0 },
  }
}

function budgetError(): WorkflowSimulationError {
  return { code: 'step_limit', title: 'Simulation replay budget reached', whatHappened: 'This replay reached its cumulative 100-step or 100-effect safety budget.', howToFix: 'Reset the simulation and test a shorter path or a different scenario.' }
}

function nextNodeId(edges: WorkflowEdge[], from: string, handle?: string): string | undefined {
  const exact = handle ? edges.find((edge) => edge.source === from && edge.sourceHandle === handle) : undefined
  return (exact ?? edges.find((edge) => edge.source === from && !edge.sourceHandle) ?? edges.find((edge) => edge.source === from))?.target
}

function nodeIdFromError(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined
  return error.message.match(/Workflow step ([^ ]+)/)?.[1]
}

function cloneContext(context: WorkflowContext): WorkflowContext {
  return JSON.parse(JSON.stringify(context)) as WorkflowContext
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback
}

function formatTime(value: string): string {
  const [hour, minute] = value.split(':').map(Number)
  return `${hour! % 12 || 12}:${String(minute).padStart(2, '0')} ${hour! >= 12 ? 'PM' : 'AM'}`
}
