// Rev 3 — the workflow execution engine (pure). Walks a Workflow's typed node graph
// from its trigger, executing each node via injected executors. Kept side-effect-free
// (no DB/network) so it's unit-testable; the worker (phase 2b) supplies real executors
// that send WhatsApp, notify, tag, etc. Delay + Approval nodes pause the run (the
// worker re-enqueues to resume at the next node). Cycle-guarded.
import type { Workflow, WorkflowNode, WorkflowEdge } from '@docmee/db'

export interface WorkflowContext {
  patientId?: string
  appointmentId?: string
  conversationId?: string
  message?: string
  [key: string]: unknown
}

export const WORKFLOW_CAPTURE_CONTEXT_KEY = '__workflowCapture'

export interface WorkflowCaptureState {
  nodeId: string
  field: string
  question: string
  retryQuestion: string
  validation: string
  attempts: number
  maxAttempts: number
  status: 'pending' | 'captured' | 'error'
}

// Interactive menu (BotPenguin-parity): a re-entrant node that sends a tappable
// WhatsApp buttons/list message, pauses for the patient's choice, then routes
// out of a per-option handle on resume. Mirrors the ask_capture pause/resume
// precedent above, but with condition-style multi-handle routing.
//
// The context key MUST be camelCase-stable: conversation metadata round-trips
// through postgres.js's `transform: postgres.camel`, which rewrites JSON keys
// (a leading-double-underscore key like `__workflowMenu` comes back as
// `_WorkflowMenu` and the resumed run would lose its pending menu state).
export const WORKFLOW_MENU_CONTEXT_KEY = 'workflowMenu'

export interface WorkflowMenuState {
  nodeId: string
  page?: number
  status: 'pending'
}

/** One tappable option; `optionId` is both the WhatsApp interactive reply id and
 *  the canvas output handle the branch wires from. */
export interface WorkflowMenuOption {
  optionId: string
  title: string
  description?: string
}

/** Reserved output handles every menu exposes in addition to its options:
 *  footer "0" restarts (→ main menu), "1" hands off to live chat, and any
 *  unmatched reply falls through `default` (re-show the menu). */
export const MENU_RESERVED_HANDLES = ['restart', 'livechat', 'default'] as const

export type MenuReplyOutcome = {
  outcome: string
  value?: string
  label?: string
}

// Slot menu (dates-then-times booking picker): a re-entrant node, same family
// as the interactive menu above, but its options are computed at send time
// from the availability data check_availability already put in context —
// there is no admin-authored option list, so it cannot reuse the per-option
// edge routing interactive_menu uses. Instead it exposes a small fixed set of
// outcome handles (`selected`, `empty`, `restart`, `livechat`); pagination
// (the "See other schedules" row) and an unmatched reply are both handled by
// re-sending the same node rather than routing through an edge, so they never
// touch the engine's cycle guard.
export const WORKFLOW_SLOT_MENU_CONTEXT_KEY = 'workflowSlotMenu'

export interface WorkflowSlotMenuState {
  nodeId: string
  page: number
  status: 'pending'
}

/** The reply id used for the "See other schedules" pagination row. Reserved —
 *  no real date (`YYYY-MM-DD`) or time (`HH:MM`) value can collide with it. */
export const SLOT_MENU_MORE_OPTION_ID = '__more__'

/** Outcomes `matchSlotMenuReply` can resolve a reply to. `more` and `default`
 *  are handled inline (re-send the node); the rest route out via edges. */
export type SlotMenuReplyOutcome = 'selected' | 'empty' | 'restart' | 'livechat' | 'more' | 'default'

/** Parse a menu node's `config.options` (stored as a JSON string, since node
 *  config values are strings). Returns [] on absent/malformed input. */
export function parseMenuOptions(config: Record<string, unknown> | undefined): WorkflowMenuOption[] {
  const raw = config?.['options']
  if (Array.isArray(raw)) return raw.filter(isMenuOption)
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isMenuOption) : []
  } catch {
    return []
  }
}

function isMenuOption(value: unknown): value is WorkflowMenuOption {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as WorkflowMenuOption).optionId === 'string' &&
    typeof (value as WorkflowMenuOption).title === 'string'
  )
}

// AI Agent: a single-pass (not re-entrant) node that hands a turn's routing
// decision to an LLM. Each scenario is a free-text trigger description the
// model semantically matches against, paired with exactly one action:
// `reply` (draft + auto-send using the node's personality/instructions/
// style), `route` (hand the conversation to a different workflow entirely —
// ends this run like action.end, no successor edge needed), or `handoff`
// (actually pause the bot, not the cosmetic action.notify_secretary).
export type AiAgentScenarioAction = 'reply' | 'route' | 'handoff'

export interface AiAgentScenario {
  id: string
  description: string
  action: AiAgentScenarioAction
  targetWorkflowId?: string
}

/** Parse an AI Agent node's `config.scenarios` (stored as a JSON string, same
 *  convention as `parseMenuOptions`). Returns [] on absent/malformed input. */
export function parseAiAgentScenarios(config: Record<string, unknown> | undefined): AiAgentScenario[] {
  const raw = config?.['scenarios']
  if (Array.isArray(raw)) return raw.filter(isAiAgentScenario)
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isAiAgentScenario) : []
  } catch {
    return []
  }
}

function isAiAgentScenario(value: unknown): value is AiAgentScenario {
  if (typeof value !== 'object' || value === null) return false
  const v = value as AiAgentScenario
  return (
    typeof v.id === 'string' &&
    typeof v.description === 'string' &&
    (v.action === 'reply' || v.action === 'route' || v.action === 'handoff')
  )
}

/** Outcomes the worker's `aiAgent` executor can resolve to. `routed` is
 *  internal to the engine (§ the switch case below) — it never becomes a
 *  `handle` and therefore never needs a wired successor edge, mirroring how
 *  `action.end` needs none: the target workflow was already enqueued, so
 *  this run simply ends. */
export type AiAgentOutcome = 'replied' | 'handoff' | 'no_match' | 'error' | 'routed'

/**
 * Resolve a menu reply to an output handle. Precedence: reserved footer keys
 * (`0`→restart, `1`→livechat) → exact interactive reply id → 1-based numeric
 * index → case-insensitive title match → `default`. Pure, so the worker and
 * unit tests share it.
 */
export function resolveMenuHandle(
  options: WorkflowMenuOption[],
  replyId: string | undefined,
  text: string | undefined,
): string {
  const trimmed = (text ?? '').trim()
  if (trimmed === '0') return 'restart'
  if (trimmed === '1') return 'livechat'
  if (replyId && options.some((o) => o.optionId === replyId)) return replyId
  const index = Number(trimmed)
  if (Number.isInteger(index) && index >= 1 && index <= options.length) return options[index - 1]!.optionId
  const byTitle = options.find((o) => o.title.trim().toLowerCase() === trimmed.toLowerCase())
  if (byTitle) return byTitle.optionId
  return 'default'
}

export interface WorkflowExecutors {
  sendMessage(text: string, ctx: WorkflowContext): Promise<unknown> | unknown
  sendTemplate(category: string, ctx: WorkflowContext): Promise<unknown> | unknown
  notifySecretary(ctx: WorkflowContext): Promise<unknown> | unknown
  handoffSecretary?: (ctx: WorkflowContext) => Promise<unknown> | unknown
  addTag(tag: string, ctx: WorkflowContext): Promise<unknown> | unknown
  aiDraft(node: WorkflowNode, ctx: WorkflowContext): Promise<unknown> | unknown
  requestApproval(node: WorkflowNode, nextNodeId: string | undefined, ctx: WorkflowContext): Promise<unknown> | unknown
  transcribeBookingVoice?: (node: WorkflowNode, ctx: WorkflowContext) => Promise<unknown> | unknown
  checkAvailability?: (node: WorkflowNode, ctx: WorkflowContext) => Promise<unknown> | unknown
  offerSlots?: (node: WorkflowNode, ctx: WorkflowContext) => Promise<unknown> | unknown
  createOrRescheduleBooking?: (node: WorkflowNode, ctx: WorkflowContext) => Promise<unknown> | unknown
  askAndCapture?: (node: WorkflowNode, ctx: WorkflowContext) => Promise<unknown> | unknown
  extractBookingDetails?: (node: WorkflowNode, ctx: WorkflowContext) => Promise<unknown> | unknown
  classifyIntentConfidence?: (node: WorkflowNode, ctx: WorkflowContext) => Promise<'high' | 'low' | 'error'> | 'high' | 'low' | 'error'
  /** Send the interactive menu and pause for the patient's choice. Returns true
   *  when the run was paused (a pending resume was persisted), false when it
   *  could not pause (e.g. no conversation) and the engine should route `default`. */
  sendInteractiveMenu?: (node: WorkflowNode, ctx: WorkflowContext, page?: number) => Promise<boolean> | boolean
  /** On resume, resolve the patient's reply to one of the menu's output handles
   *  (an optionId, or a reserved `restart`/`livechat`/`default`). */
  matchMenuReply?: (node: WorkflowNode, ctx: WorkflowContext, page?: number) => Promise<string | MenuReplyOutcome> | string | MenuReplyOutcome
  /** Send page `page` (0-based) of the slot menu and pause. Same return
   *  contract as `sendInteractiveMenu`: true when paused, false when it
   *  could not send (including "nothing to show on this page"). */
  sendSlotMenu?: (node: WorkflowNode, ctx: WorkflowContext, page: number) => Promise<boolean> | boolean
  /** On resume, resolve the patient's reply against the options `sendSlotMenu`
   *  showed for `page`. A `selected` outcome must also write the chosen value
   *  into context (the engine has no option data to do this itself). */
  matchSlotMenuReply?: (node: WorkflowNode, ctx: WorkflowContext, page: number) => Promise<SlotMenuReplyOutcome> | SlotMenuReplyOutcome
  /** Run the AI Agent node: match the patient's message against the node's
   *  scenarios and act on the best match (reply / route / handoff). See
   *  `AiAgentOutcome` for what each return value means. */
  aiAgent?: (node: WorkflowNode, ctx: WorkflowContext) => Promise<AiAgentOutcome> | AiAgentOutcome
  /** Persist the context and pause until the conversation receives another reply. */
  waitForReply?: (node: WorkflowNode, nextNodeId: string, ctx: WorkflowContext) => Promise<boolean> | boolean
  /** Pause and resume the run at `nodeId` after `ms` (delay node). */
  scheduleResume(nodeId: string, ms: number, ctx: WorkflowContext): Promise<void> | void
  /**
   * Worker-owned durable boundary for every action node.  The pure engine does
   * not decide persistence semantics; production workers use this hook to
   * claim a deterministic effect key before invoking an external side effect.
   */
  runSideEffect?: <T>(node: WorkflowNode, ctx: WorkflowContext, invoke: () => Promise<T>) => Promise<T>
}

export type StepStatus = 'ran' | 'paused' | 'ended'
export interface WorkflowStep {
  nodeId: string
  type: string
  status: StepStatus
}

export interface RunOptions {
  /** Resume from a specific node (used when a delay node re-enqueues the run). */
  startNodeId?: string
  /** Optional caller-owned bound. Production retains the hard 100-step guard. */
  maxSteps?: number
  /** Observe each completed step with the context as it existed at that step. */
  onStep?: (step: WorkflowStep, context: WorkflowContext) => void
  onTransition?: (edge: WorkflowEdge) => void
  onStop?: (reason: 'step_limit' | 'cycle' | 'completed', nextNodeId?: string) => void
}

export interface WorkflowRunOutcome {
  status: 'completed' | 'waiting'
  trace: WorkflowStep[]
  currentNodeId?: string
  resumeReason?: 'delay' | 'reply' | 'approval' | 'interactive_reply'
  stopReason?: 'step_limit' | 'cycle' | 'completed'
  nextNodeId?: string
}

const MAX_STEPS = 100 // backstop against cycles / runaway graphs

export async function runWorkflow(
  workflow: Pick<Workflow, 'nodes' | 'edges'>,
  ctx: WorkflowContext,
  exec: WorkflowExecutors,
  opts: RunOptions = {},
): Promise<WorkflowStep[]> {
  const { nodes, edges } = workflow
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const trace: WorkflowStep[] = []
  const recordStep = (step: WorkflowStep) => {
    trace.push(step)
    opts.onStep?.(step, ctx)
  }

  let current: WorkflowNode | undefined = opts.startNodeId
    ? byId.get(opts.startNodeId)
    : nodes.find((n) => n.kind === 'trigger')

  const visited = new Set<string>()
  const sideEffect = async <T>(node: WorkflowNode, invoke: () => Promise<T>): Promise<T> =>
    exec.runSideEffect ? exec.runSideEffect(node, ctx, invoke) : invoke()
  const isPendingCaptureResume = (node: WorkflowNode): boolean => {
    const capture = ctx[WORKFLOW_CAPTURE_CONTEXT_KEY] as WorkflowCaptureState | undefined
    return capture?.nodeId === node.id && capture.status === 'pending'
  }

  const stepLimit = Math.min(MAX_STEPS, Math.max(1, Math.floor(opts.maxSteps ?? MAX_STEPS)))
  while (current && trace.length < stepLimit) {
    if (visited.has(current.id)) {
      opts.onStop?.('cycle')
      return trace
    }
    visited.add(current.id)

    const node: WorkflowNode = current
    const cfg = node.config ?? {}
    let handle: string | undefined // conditional routing out of this node

    // Missing integrations must fail visibly, not report an action as completed.
    const requiredExecutor: Partial<Record<string, keyof WorkflowExecutors>> = {
      'action.handoff_to_secretary': 'handoffSecretary',
      'action.transcribe_booking_voice': 'transcribeBookingVoice',
      'action.check_availability': 'checkAvailability',
      'action.offer_slots': 'offerSlots',
      'action.create_or_reschedule_booking': 'createOrRescheduleBooking',
      'action.ask_capture': 'askAndCapture',
      'action.extract_booking_details': 'extractBookingDetails',
      'logic.wait_for_reply': 'waitForReply',
    }
    const executor = requiredExecutor[node.type]
    if (executor && typeof exec[executor] !== 'function') {
      throw new Error(`Workflow step ${node.id} (${node.type}) cannot run: ${executor} is unavailable. Configure this capability before retrying.`)
    }

    switch (node.type) {
      case 'logic.condition':
        handle = evalCondition(cfg, ctx) ? 'true' : 'false'
        break
      case 'logic.ai_classify_intent':
        handle = exec.classifyIntentConfidence
          ? await exec.classifyIntentConfidence(node, ctx)
          : 'error'
        break
      case 'logic.delay':
        await exec.scheduleResume(nextNodeId(edges, node.id) ?? '', delayMs(cfg), ctx)
        recordStep({ nodeId: node.id, type: node.type, status: 'paused' })
        return trace
      case 'logic.wait_for_reply': {
        const paused = exec.waitForReply
          ? await exec.waitForReply(node, nextNodeId(edges, node.id) ?? '', ctx)
          : false
        if (paused) {
          recordStep({ nodeId: node.id, type: node.type, status: 'paused' })
          return trace
        }
        break
      }
      case 'action.interactive_menu': {
        // Re-entrant: first arrival sends the menu and pauses; the resume pass
        // (worker restored the pending menu state and re-entered here) routes
        // out of the per-option handle matched from the patient's reply.
        const menu = ctx[WORKFLOW_MENU_CONTEXT_KEY] as WorkflowMenuState | undefined
        if (menu && menu.nodeId === node.id && menu.status === 'pending') {
          const result = exec.matchMenuReply ? await exec.matchMenuReply(node, ctx, menu.page ?? 0) : 'default'
          const outcome: MenuReplyOutcome = typeof result === 'string' ? { outcome: result } : result
          handle = outcome.outcome
          const dynamic = String(node.config?.['optionSource'] ?? 'static') !== 'static'
          if (dynamic && (handle === 'more' || handle === 'default')) {
            delete ctx[WORKFLOW_MENU_CONTEXT_KEY]
            const nextPage = handle === 'more' ? (menu.page ?? 0) + 1 : (menu.page ?? 0)
            const paused = exec.sendInteractiveMenu
              ? await exec.sendInteractiveMenu(node, ctx, nextPage)
              : false
            if (paused) {
              recordStep({ nodeId: node.id, type: node.type, status: 'paused' })
              return trace
            }
            handle = 'empty'
            break
          }
          const field = String(node.config?.['field'] ?? '')
          if (field) {
            if (dynamic && outcome.value) {
              ctx[field] = outcome.value
              if (outcome.label) ctx[`${field}_label`] = outcome.label
            } else {
              const options = parseMenuOptions(node.config)
              const selected = options.find((o) => o.optionId === handle)
              ctx[field] = selected?.title ?? handle
            }
          }
          delete ctx[WORKFLOW_MENU_CONTEXT_KEY]
          break
        }
        const paused = exec.sendInteractiveMenu ? await exec.sendInteractiveMenu(node, ctx, 0) : false
        if (paused) {
          recordStep({ nodeId: node.id, type: node.type, status: 'paused' })
          return trace
        }
        // Could not pause (e.g. no conversation attached) — fall through the
        // default handle rather than dead-end.
        handle = 'default'
        break
      }
      case 'action.offer_slot_menu': {
        const slotMenu = ctx[WORKFLOW_SLOT_MENU_CONTEXT_KEY] as WorkflowSlotMenuState | undefined
        if (slotMenu && slotMenu.nodeId === node.id && slotMenu.status === 'pending') {
          const outcome: SlotMenuReplyOutcome = exec.matchSlotMenuReply
            ? await exec.matchSlotMenuReply(node, ctx, slotMenu.page)
            : 'default'
          if (outcome === 'more' || outcome === 'default') {
            // Pagination and an unmatched reply both re-send this same node
            // rather than routing through an edge — a literal self-loop edge
            // would hit the cycle guard above and silently end the run.
            delete ctx[WORKFLOW_SLOT_MENU_CONTEXT_KEY]
            const nextPage = outcome === 'more' ? slotMenu.page + 1 : slotMenu.page
            const paused = exec.sendSlotMenu ? await exec.sendSlotMenu(node, ctx, nextPage) : false
            if (paused) {
              recordStep({ nodeId: node.id, type: node.type, status: 'paused' })
              return trace
            }
            handle = 'empty'
            break
          }
          delete ctx[WORKFLOW_SLOT_MENU_CONTEXT_KEY]
          handle = outcome
          break
        }
        const paused = exec.sendSlotMenu ? await exec.sendSlotMenu(node, ctx, 0) : false
        if (paused) {
          recordStep({ nodeId: node.id, type: node.type, status: 'paused' })
          return trace
        }
        // Nothing to show (no slots at all, or could not pause) — route out
        // the empty handle rather than dead-end.
        handle = 'empty'
        break
      }
      case 'action.ai_agent': {
        const outcome: AiAgentOutcome = exec.aiAgent ? await exec.aiAgent(node, ctx) : 'error'
        if (outcome === 'routed') {
          // A `route` scenario already enqueued the target workflow — this
          // run ends here, exactly like action.end, no successor consulted.
          recordStep({ nodeId: node.id, type: node.type, status: 'ended' })
          return trace
        }
        handle = outcome
        break
      }
      case 'action.send_message':
        await sideEffect(node, () => Promise.resolve(exec.sendMessage(String(cfg['text'] ?? ''), ctx)))
        break
      case 'action.send_template':
        await sideEffect(node, () => Promise.resolve(exec.sendTemplate(String(cfg['category'] ?? ''), ctx)))
        break
      case 'action.notify_secretary':
        await sideEffect(node, () => Promise.resolve(exec.notifySecretary(ctx)))
        break
      case 'action.handoff_to_secretary':
        if (exec.handoffSecretary) {
          await sideEffect(node, () => Promise.resolve(exec.handoffSecretary!(ctx)))
        }
        break
      case 'action.add_tag':
        await sideEffect(node, () => Promise.resolve(exec.addTag(String(cfg['tag'] ?? ''), ctx)))
        break
      case 'action.ai_draft':
        await sideEffect(node, () => Promise.resolve(exec.aiDraft(node, ctx)))
        break
      case 'action.approval':
        await sideEffect(node, () => Promise.resolve(exec.requestApproval(node, nextNodeId(edges, node.id), ctx)))
        recordStep({ nodeId: node.id, type: node.type, status: 'paused' })
        return trace
      case 'action.transcribe_booking_voice':
        if (exec.transcribeBookingVoice) await sideEffect(node, () => Promise.resolve(exec.transcribeBookingVoice!(node, ctx)))
        break
      case 'action.check_availability':
        // Deliberately NOT wrapped in sideEffect(): unlike every other action
        // node, this one only reads Google Calendar and sets a context field —
        // it creates/sends/charges nothing, so there is no double-execution
        // risk the durable effect ledger needs to guard against. Wrapping it
        // anyway meant one interrupted attempt (a slow calendar call, a
        // mid-flight worker restart) permanently poisoned that execution key:
        // every later retry hit "uncertain prior provider outcome" and never
        // even reached the real availability check again.
        if (exec.checkAvailability) await exec.checkAvailability(node, ctx)
        break
      case 'action.offer_slots':
        if (exec.offerSlots) await sideEffect(node, () => Promise.resolve(exec.offerSlots!(node, ctx)))
        break
      case 'action.create_or_reschedule_booking':
        if (exec.createOrRescheduleBooking) await sideEffect(node, () => Promise.resolve(exec.createOrRescheduleBooking!(node, ctx)))
        break
      case 'action.ask_capture':
        if (exec.askAndCapture) {
          if (isPendingCaptureResume(node)) await exec.askAndCapture(node, ctx)
          else await sideEffect(node, () => Promise.resolve(exec.askAndCapture!(node, ctx)))
        }
        break
      case 'action.extract_booking_details':
        if (exec.extractBookingDetails) await sideEffect(node, () => Promise.resolve(exec.extractBookingDetails!(node, ctx)))
        break
      case 'action.end':
        recordStep({ nodeId: node.id, type: node.type, status: 'ended' })
        return trace
      default:
        if (node.kind !== 'trigger' || !node.type.startsWith('trigger.')) {
          throw new Error(`Workflow step ${node.id} has unsupported type ${node.type}. Replace it with a supported node.`)
        }
        break
    }

    recordStep({ nodeId: node.id, type: node.type, status: 'ran' })
    const selectedEdge = selectWorkflowEdge(edges, node.id, handle)
    if (selectedEdge) opts.onTransition?.(selectedEdge)
    const nextId = selectedEdge?.target
    current = nextId ? byId.get(nextId) : undefined
  }

  opts.onStop?.(current ? 'step_limit' : 'completed', current?.id)
  return trace
}

/**
 * Runtime-facing result for durable workers.  The original trace-only API is
 * retained for existing callers; workers use this to persist a cursor without
 * inferring execution state from UI-oriented trace strings.
 */
export async function runWorkflowWithOutcome(
  workflow: Pick<Workflow, 'nodes' | 'edges'>,
  ctx: WorkflowContext,
  exec: WorkflowExecutors,
  opts: RunOptions = {},
): Promise<WorkflowRunOutcome> {
  let stopReason: WorkflowRunOutcome['stopReason'] = 'completed'
  let boundedCursor: string | undefined
  const trace = await runWorkflow(workflow, ctx, exec, {
    ...opts,
    onStop: (reason, cursor) => {
      stopReason = reason
      boundedCursor = cursor
      opts.onStop?.(reason, cursor)
    },
  })
  const last = trace.at(-1)
  if (last?.status !== 'paused') return { status: 'completed', trace, stopReason, ...(boundedCursor ? { nextNodeId: boundedCursor } : {}) }

  const node = workflow.nodes.find((candidate) => candidate.id === last.nodeId)
  const nextNodeIdForPause = nextNodeId(workflow.edges, last.nodeId)
  const resumeReason: WorkflowRunOutcome['resumeReason'] = node?.type === 'logic.delay'
    ? 'delay'
    : node?.type === 'logic.wait_for_reply'
      ? 'reply'
      : node?.type === 'action.approval'
        ? 'approval'
        : 'interactive_reply'
  return { status: 'waiting', trace, currentNodeId: nextNodeIdForPause ?? last.nodeId, resumeReason }
}

/** Next node from `from`. Prefers the edge matching `handle` (condition branch),
 *  then an unlabeled edge, then any edge. */
function nextNodeId(edges: WorkflowEdge[], from: string, handle?: string): string | undefined {
  return selectWorkflowEdge(edges, from, handle)?.target
}

export function selectWorkflowEdge(edges: WorkflowEdge[], from: string, handle?: string): WorkflowEdge | undefined {
  if (handle) {
    const branch = edges.find((e) => e.source === from && (e.sourceHandle ?? undefined) === handle)
    if (branch) return branch
  }
  const plain = edges.find((e) => e.source === from && !e.sourceHandle)
  return plain ?? edges.find((e) => e.source === from)
}

function evalCondition(cfg: Record<string, unknown>, ctx: WorkflowContext): boolean {
  const field = String(cfg['field'] ?? '')
  const op = String(cfg['op'] ?? 'equals')
  const value = String(cfg['value'] ?? '')
  const actual = field ? String(ctx[field] ?? '') : ''
  switch (op) {
    case 'contains':
      return actual.toLowerCase().includes(value.toLowerCase())
    case 'not_equals':
      return actual !== value
    case 'equals':
    default:
      return actual === value
  }
}

function delayMs(cfg: Record<string, unknown>): number {
  const amount = Number(cfg['amount'] ?? 0)
  const unit = String(cfg['unit'] ?? 'hour')
  const mult = unit === 'day' ? 86_400_000 : unit === 'minute' ? 60_000 : 3_600_000
  return Math.max(0, Number.isFinite(amount) ? amount : 0) * mult
}
