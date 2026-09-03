// Rev 3 (phase 2b) — the workflow-run queue + producers. A trigger event looks up
// active workflows matching that trigger and enqueues one run per workflow; the
// workflow-runner worker executes each via the engine. Delay nodes re-enqueue with
// a startNodeId to resume.
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { createQueue } from '@docmee/queue'
import { createConversationsRepository, createWorkflowsRepository, type Workflow } from '@docmee/db'
import type { createServiceDbClient } from '@docmee/db'

// Lazily created so merely importing this module (e.g. into the agent worker, which
// wires the message_keyword trigger) never opens a Redis connection — the queue is
// built only when a run is actually enqueued.
let queue: ReturnType<typeof createQueue> | null = null
function workflowQueue(): ReturnType<typeof createQueue> {
  if (!queue) queue = createQueue('workflow-run')
  return queue
}

export const WorkflowTriggerSchema = z
  .object({
    type: z.string(),
    /** Stable, producer-owned identifier of the source event. Never synthesize this in a consumer. */
    sourceEventId: z.string().min(1),
    patientId: z.string().optional(),
    appointmentId: z.string().optional(),
    conversationId: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough()

export const WorkflowRunJobSchema = z.object({
  clinicId: z.string().uuid(),
  workflowId: z.string().uuid(),
  /** Immutable active graph selected when this run was enqueued. */
  workflowRevisionId: z.string().uuid().optional(),
  trigger: WorkflowTriggerSchema,
  /** set when a delay node re-enqueues the run to resume mid-graph. */
  startNodeId: z.string().optional(),
  /** Mutable workflow context restored after a conversational wait. */
  context: z.record(z.string(), z.unknown()).optional(),
  approvalId: z.string().uuid().optional(),
})
export type WorkflowRunJobData = z.infer<typeof WorkflowRunJobSchema>

type Sql = ReturnType<typeof createServiceDbClient>
export interface TriggerContext {
  sourceEventId?: string
  message?: string
  patientId?: string
  appointmentId?: string
  conversationId?: string
  channel?: string
  transcript?: string
  waMessageId?: string
  isVoiceNote?: boolean
  voiceMessageId?: string
  audioObjectKey?: string
  interactiveReplyId?: string
}

/** Safe BullMQ ID and durable trace key derived from the producer's source event. */
export function workflowRunKey(workflowId: string, sourceEventId: string): string {
  const digest = createHash('sha256').update(sourceEventId).digest('hex').slice(0, 32)
  return `workflow-run-${workflowId}-${digest}`
}

export function workflowResumeJobKey(workflowId: string, sourceEventId: string, nodeId: string): string {
  const digest = createHash('sha256').update(`${sourceEventId}:${nodeId}`).digest('hex').slice(0, 24)
  return `workflow-resume-${workflowId}-${digest}`
}

const PENDING_WORKFLOWS_KEY = 'pendingWorkflowRuns'

export interface PendingWorkflowRun {
  workflowId: string
  workflowRevisionId?: string
  sourceEventId: string
  resumeNodeId: string
  context: Record<string, unknown>
  expiresAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

/** Raw stored entries, `context` still a JSON string — i.e. before the parse
 *  step in `readPendingWorkflowRuns`. Lets `writePendingWorkflowRun` filter
 *  out another workflow's entry without needing to parse (and rebuild) a
 *  context it isn't touching. */
function readRawPendingEntries(metadata: Record<string, unknown>): Record<string, unknown>[] {
  const value = metadata[PENDING_WORKFLOWS_KEY]
  return Array.isArray(value) ? value.filter(isRecord) : []
}

export function readPendingWorkflowRuns(metadata: Record<string, unknown>): PendingWorkflowRun[] {
  return readRawPendingEntries(metadata).flatMap((entry) => {
    const workflowId = entry['workflowId']
    const resumeNodeId = entry['resumeNodeId']
    const sourceEventId = entry['sourceEventId']
    const workflowRevisionId = entry['workflowRevisionId']
    const expiresAt = entry['expiresAt']
    const rawContext = entry['context']
    if (
      typeof workflowId !== 'string' ||
      typeof sourceEventId !== 'string' ||
      typeof resumeNodeId !== 'string' ||
      typeof expiresAt !== 'string' ||
      typeof rawContext !== 'string'
    ) {
      return []
    }
    // `context` is stored JSON-stringified (see writePendingWorkflowRun) rather
    // than as a nested jsonb object: postgres.js's `transform: postgres.camel`
    // recursively camelCases keys it finds INSIDE jsonb content, not just SQL
    // column names — a persisted `available_slots` comes back as
    // `availableSlots`, silently breaking every snake_case workflow context
    // field (available_slots, doctor_preference, preferred_date, …) the
    // moment it has to survive an actual pause/resume round trip. A JSON
    // string has no keys for that transform to see, so it round-trips intact.
    let context: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(rawContext)
      if (!isRecord(parsed)) return []
      context = parsed
    } catch {
      return []
    }
    return [{
      workflowId,
      ...(typeof workflowRevisionId === 'string' ? { workflowRevisionId } : {}),
      sourceEventId,
      resumeNodeId,
      context,
      expiresAt,
    }]
  })
}

export function writePendingWorkflowRun(
  metadata: Record<string, unknown>,
  pending: PendingWorkflowRun,
): Record<string, unknown> {
  const current = readRawPendingEntries(metadata).filter((item) => item['workflowId'] !== pending.workflowId)
  const stored = { ...pending, context: JSON.stringify(pending.context) }
  return { ...metadata, [PENDING_WORKFLOWS_KEY]: [...current, stored] }
}

/** Resume every non-expired workflow waiting on this conversation. The queue job id
 * makes webhook redelivery idempotent; claimed cursors are then removed so the
 * regular agent does not race the conversational workflow for the same reply. */
export async function resumePendingWorkflowRuns(
  sql: Sql,
  clinicId: string,
  conversationId: string,
  ctx: TriggerContext,
): Promise<number> {
  const conversations = createConversationsRepository(sql)
  const conversation = await conversations.findById(clinicId, conversationId)
  if (!conversation) return 0
  const now = Date.now()
  const all = readPendingWorkflowRuns(conversation.metadata)
  const active = all.filter((item) => Date.parse(item.expiresAt) > now)
  if (active.length === 0) {
    if (all.length > 0) {
      const metadata = { ...conversation.metadata }
      delete metadata[PENDING_WORKFLOWS_KEY]
      await conversations.update(clinicId, conversationId, { metadata })
    }
    return 0
  }

  for (const pending of active) {
    const resumeJobSourceEventId = ctx.sourceEventId ?? ctx.waMessageId ?? pending.sourceEventId
    await workflowQueue().add(
      'run',
      {
        clinicId,
        workflowId: pending.workflowId,
        workflowRevisionId: pending.workflowRevisionId,
        trigger: { ...ctx, type: 'trigger.conversation_reply', sourceEventId: pending.sourceEventId, conversationId },
        startNodeId: pending.resumeNodeId,
        context: pending.context,
      } satisfies WorkflowRunJobData,
      { jobId: workflowResumeJobKey(pending.workflowId, resumeJobSourceEventId, pending.resumeNodeId) },
    )
  }
  const metadata = { ...conversation.metadata }
  delete metadata[PENDING_WORKFLOWS_KEY]
  await conversations.update(clinicId, conversationId, { metadata })
  return active.length
}

/** Pure: does this message_keyword workflow's trigger match the message? An empty
 *  keyword list matches everything (the clinic wants every inbound to run it). */
export function workflowKeywordMatches(workflow: Pick<Workflow, 'nodes'>, message: string): boolean {
  const trigger = workflow.nodes.find((n) => n.kind === 'trigger' && n.type === 'trigger.message_keyword')
  const raw = String((trigger?.config as { keywords?: unknown } | undefined)?.keywords ?? '').trim()
  if (!raw) return true
  const keywords = raw
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
  if (keywords.length === 0) return true
  const lower = message.toLowerCase()
  return keywords.some((k) => lower.includes(k))
}

/** Node types that speak to the patient. A keyword-matched workflow containing at
 *  least one of these is conversational: it produces the reply for this turn, so
 *  the producer must let it own the turn (skip custom flows + LLM fallback) rather
 *  than fire it as a best-effort side effect. Pure side-effect workflows (tag,
 *  notify, approval, …) never own a turn. */
const CONVERSATIONAL_NODE_TYPES = new Set([
  'action.send_message',
  'action.send_template',
  'action.interactive_menu',
  'action.ask_capture',
  'action.offer_slots',
  'action.ai_draft',
  'action.ai_agent',
])

/** Pure: does this workflow talk to the patient? */
export function workflowIsConversational(workflow: Pick<Workflow, 'nodes'>): boolean {
  return workflow.nodes.some((n) => CONVERSATIONAL_NODE_TYPES.has(n.type))
}

/** Active workflows for this trigger, filtered by keyword match for inbound messages. */
async function matchWorkflows(
  sql: Sql,
  clinicId: string,
  triggerType: string,
  message: string,
): Promise<Workflow[]> {
  const workflows = await createWorkflowsRepository(sql).listActiveByTrigger(clinicId, triggerType)
  if (triggerType !== 'trigger.message_keyword') return workflows
  return workflows.filter((wf) => workflowKeywordMatches(wf, message))
}

/** Enqueue a run for every active workflow whose trigger matches. Returns the count
 *  enqueued. A no-op (returns 0) when the clinic has no matching active workflow —
 *  so wiring this into a producer is behaviour-neutral until a workflow is activated. */
export async function enqueueWorkflowRuns(
  sql: Sql,
  clinicId: string,
  triggerType: string,
  ctx: TriggerContext = {},
): Promise<number> {
  const sourceEventId = ctx.sourceEventId ?? ctx.waMessageId
  if (!sourceEventId) {
    console.error(`[workflow] refusing ${triggerType} without a stable source event ID`)
    return 0
  }
  const workflows = await matchWorkflows(sql, clinicId, triggerType, ctx.message ?? '')
  let enqueued = 0
  for (const wf of workflows) {
    await workflowQueue().add('run', {
      clinicId,
      workflowId: wf.id,
      workflowRevisionId: wf.activeRevisionId ?? undefined,
      trigger: { type: triggerType, sourceEventId, ...ctx },
    } satisfies WorkflowRunJobData, { jobId: workflowRunKey(wf.id, sourceEventId) })
    enqueued++
  }
  return enqueued
}

/** Enqueue a run for one exact workflow — used by action.ai_agent's `route`
 *  outcome, which already knows precisely which workflow the admin picked
 *  (unlike `enqueueWorkflowRuns`, this does NOT match by trigger type). Same
 *  jobId-keyed idempotency as every other enqueue here: `workflowRunKey`
 *  hashes workflowId+sourceEventId, so a crash-retry of the same triggering
 *  event naturally dedupes without any extra bookkeeping. Returns false
 *  (no-op) when there's no stable source event id or the target workflow
 *  doesn't exist / isn't active. */
export async function enqueueWorkflowRunByTarget(
  sql: Sql,
  clinicId: string,
  targetWorkflowId: string,
  triggerType: string,
  ctx: TriggerContext,
): Promise<boolean> {
  const sourceEventId = ctx.sourceEventId ?? ctx.waMessageId
  if (!sourceEventId) {
    console.error(`[workflow] refusing to route to ${targetWorkflowId} without a stable source event ID`)
    return false
  }
  const target = await createWorkflowsRepository(sql).findById(clinicId, targetWorkflowId)
  if (!target || target.status !== 'active') return false
  await workflowQueue().add('run', {
    clinicId,
    workflowId: targetWorkflowId,
    workflowRevisionId: target.activeRevisionId ?? undefined,
    trigger: { type: triggerType, sourceEventId, ...ctx },
  } satisfies WorkflowRunJobData, { jobId: workflowRunKey(targetWorkflowId, sourceEventId) })
  return true
}

export interface InboundWorkflowClaim {
  enqueued: number
  /** True when at least one matched workflow talks to the patient — the caller
   *  must end its turn (no custom flow / LLM reply on top). */
  ownsTurn: boolean
}

/** Inbound-message variant: same enqueue semantics as enqueueWorkflowRuns, plus
 *  turn-ownership signalling so the agent worker lets conversational workflows
 *  answer the patient themselves (BotPenguin-style bot builder behaviour). */
export async function enqueueInboundWorkflowRuns(
  sql: Sql,
  clinicId: string,
  ctx: TriggerContext = {},
): Promise<InboundWorkflowClaim> {
  const sourceEventId = ctx.sourceEventId ?? ctx.waMessageId
  if (!sourceEventId) {
    console.error('[workflow] refusing trigger.message_keyword without a stable source event ID')
    return { enqueued: 0, ownsTurn: false }
  }
  const workflows = await matchWorkflows(sql, clinicId, 'trigger.message_keyword', ctx.message ?? '')
  let enqueued = 0
  let ownsTurn = false
  for (const wf of workflows) {
    await workflowQueue().add('run', {
      clinicId,
      workflowId: wf.id,
      workflowRevisionId: wf.activeRevisionId ?? undefined,
      trigger: { type: 'trigger.message_keyword', sourceEventId, ...ctx },
    } satisfies WorkflowRunJobData, { jobId: workflowRunKey(wf.id, sourceEventId) })
    enqueued++
    if (workflowIsConversational(wf)) ownsTurn = true
  }
  return { enqueued, ownsTurn }
}

/** Re-enqueue a paused run to resume at `nodeId` after `ms` (delay node). */
export async function scheduleWorkflowResume(data: WorkflowRunJobData, nodeId: string, ms: number): Promise<void> {
  await workflowQueue().add('run', { ...data, startNodeId: nodeId }, {
    jobId: workflowResumeJobKey(data.workflowId, data.trigger.sourceEventId, nodeId),
    delay: Math.max(0, Math.round(ms)),
  })
}
