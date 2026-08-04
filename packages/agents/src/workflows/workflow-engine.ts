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

export interface WorkflowExecutors {
  sendMessage(text: string, ctx: WorkflowContext): Promise<unknown> | unknown
  sendTemplate(category: string, ctx: WorkflowContext): Promise<unknown> | unknown
  notifySecretary(ctx: WorkflowContext): Promise<unknown> | unknown
  addTag(tag: string, ctx: WorkflowContext): Promise<unknown> | unknown
  aiDraft(prompt: string, ctx: WorkflowContext): Promise<unknown> | unknown
  requestApproval(node: WorkflowNode, nextNodeId: string | undefined, ctx: WorkflowContext): Promise<unknown> | unknown
  transcribeBookingVoice?: (node: WorkflowNode, ctx: WorkflowContext) => Promise<unknown> | unknown
  checkAvailability?: (node: WorkflowNode, ctx: WorkflowContext) => Promise<unknown> | unknown
  availableSlots?: (node: WorkflowNode, ctx: WorkflowContext) => Promise<unknown> | unknown
  offerSlots?: (node: WorkflowNode, ctx: WorkflowContext) => Promise<unknown> | unknown
  interactiveMenu?: (node: WorkflowNode, ctx: WorkflowContext) => Promise<unknown> | unknown
  revalidateSlot?: (node: WorkflowNode, ctx: WorkflowContext) => Promise<unknown> | unknown
  createOrRescheduleBooking?: (node: WorkflowNode, ctx: WorkflowContext) => Promise<unknown> | unknown
  askAndCapture?: (node: WorkflowNode, ctx: WorkflowContext) => Promise<unknown> | unknown
  extractBookingDetails?: (node: WorkflowNode, ctx: WorkflowContext) => Promise<unknown> | unknown
  classifyIntentConfidence?: (node: WorkflowNode, ctx: WorkflowContext) => Promise<'high' | 'low' | 'error'> | 'high' | 'low' | 'error'
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

  let current: WorkflowNode | undefined = opts.startNodeId
    ? byId.get(opts.startNodeId)
    : nodes.find((n) => n.kind === 'trigger')

  const visited = new Set<string>()
  const sideEffect = async <T>(node: WorkflowNode, invoke: () => Promise<T>): Promise<T> =>
    exec.runSideEffect ? exec.runSideEffect(node, ctx, invoke) : invoke()

  while (current && trace.length < MAX_STEPS) {
    if (visited.has(current.id)) break // cycle guard
    visited.add(current.id)

    const node: WorkflowNode = current
    const cfg = node.config ?? {}
    let handle: string | undefined // conditional routing out of this node

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
        trace.push({ nodeId: node.id, type: node.type, status: 'paused' })
        return trace
      case 'logic.wait_for_reply': {
        const paused = exec.waitForReply
          ? await exec.waitForReply(node, nextNodeId(edges, node.id) ?? '', ctx)
          : false
        if (paused) {
          trace.push({ nodeId: node.id, type: node.type, status: 'paused' })
          return trace
        }
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
      case 'action.add_tag':
        await sideEffect(node, () => Promise.resolve(exec.addTag(String(cfg['tag'] ?? ''), ctx)))
        break
      case 'action.ai_draft':
        await sideEffect(node, () => Promise.resolve(exec.aiDraft(String(cfg['prompt'] ?? ''), ctx)))
        break
      case 'action.approval':
        await sideEffect(node, () => Promise.resolve(exec.requestApproval(node, nextNodeId(edges, node.id), ctx)))
        trace.push({ nodeId: node.id, type: node.type, status: 'paused' })
        return trace
      case 'action.transcribe_booking_voice':
        if (exec.transcribeBookingVoice) await sideEffect(node, () => Promise.resolve(exec.transcribeBookingVoice!(node, ctx)))
        break
      case 'action.check_availability':
        if (exec.checkAvailability) await sideEffect(node, () => Promise.resolve(exec.checkAvailability!(node, ctx)))
        break
      case 'action.available_slots':
        if (exec.availableSlots) await sideEffect(node, () => Promise.resolve(exec.availableSlots!(node, ctx)))
        break
      case 'action.offer_slots':
        if (exec.offerSlots) await sideEffect(node, () => Promise.resolve(exec.offerSlots!(node, ctx)))
        break
      case 'action.interactive_menu':
        if (exec.interactiveMenu) await sideEffect(node, () => Promise.resolve(exec.interactiveMenu!(node, ctx)))
        break
      case 'action.revalidate_slot':
        if (exec.revalidateSlot) await sideEffect(node, () => Promise.resolve(exec.revalidateSlot!(node, ctx)))
        break
      case 'action.create_or_reschedule_booking':
        if (exec.createOrRescheduleBooking) await sideEffect(node, () => Promise.resolve(exec.createOrRescheduleBooking!(node, ctx)))
        break
      case 'action.ask_capture':
        if (exec.askAndCapture) await sideEffect(node, () => Promise.resolve(exec.askAndCapture!(node, ctx)))
        break
      case 'action.extract_booking_details':
        if (exec.extractBookingDetails) await sideEffect(node, () => Promise.resolve(exec.extractBookingDetails!(node, ctx)))
        break
      case 'action.end':
        trace.push({ nodeId: node.id, type: node.type, status: 'ended' })
        return trace
      default:
        break // trigger.* and unknown nodes are pass-through
    }

    trace.push({ nodeId: node.id, type: node.type, status: 'ran' })
    const nextId = nextNodeId(edges, node.id, handle)
    current = nextId ? byId.get(nextId) : undefined
  }

  return trace
}

/** Next node from `from`. Prefers the edge matching `handle` (condition branch),
 *  then an unlabeled edge, then any edge. */
function nextNodeId(edges: WorkflowEdge[], from: string, handle?: string): string | undefined {
  if (handle) {
    const branch = edges.find((e) => e.source === from && (e.sourceHandle ?? undefined) === handle)
    if (branch) return branch.target
  }
  const plain = edges.find((e) => e.source === from && !e.sourceHandle)
  return (plain ?? edges.find((e) => e.source === from))?.target
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
