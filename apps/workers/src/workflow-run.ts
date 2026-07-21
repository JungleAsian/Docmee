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
  sourceEventId: string
  resumeNodeId: string
  context: Record<string, unknown>
  expiresAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function readPendingWorkflowRuns(metadata: Record<string, unknown>): PendingWorkflowRun[] {
  const value = metadata[PENDING_WORKFLOWS_KEY]
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!isRecord(entry) || !isRecord(entry['context'])) return []
    const workflowId = entry['workflowId']
    const resumeNodeId = entry['resumeNodeId']
    const sourceEventId = entry['sourceEventId']
    const expiresAt = entry['expiresAt']
    if (typeof workflowId !== 'string' || typeof sourceEventId !== 'string' || typeof resumeNodeId !== 'string' || typeof expiresAt !== 'string') return []
    return [{ workflowId, sourceEventId, resumeNodeId, context: entry['context'], expiresAt }]
  })
}

export function writePendingWorkflowRun(
  metadata: Record<string, unknown>,
  pending: PendingWorkflowRun,
): Record<string, unknown> {
  const current = readPendingWorkflowRuns(metadata).filter((item) => item.workflowId !== pending.workflowId)
  return { ...metadata, [PENDING_WORKFLOWS_KEY]: [...current, pending] }
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
    await workflowQueue().add(
      'run',
      {
        clinicId,
        workflowId: pending.workflowId,
        trigger: { type: 'trigger.conversation_reply', sourceEventId: pending.sourceEventId, ...ctx, conversationId },
        startNodeId: pending.resumeNodeId,
        context: pending.context,
      } satisfies WorkflowRunJobData,
      { jobId: workflowResumeJobKey(pending.workflowId, pending.sourceEventId, pending.resumeNodeId) },
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
  const workflows = await createWorkflowsRepository(sql).listActiveByTrigger(clinicId, triggerType)
  let enqueued = 0
  for (const wf of workflows) {
    if (triggerType === 'trigger.message_keyword' && !workflowKeywordMatches(wf, ctx.message ?? '')) continue
    await workflowQueue().add('run', {
      clinicId,
      workflowId: wf.id,
      trigger: { type: triggerType, sourceEventId, ...ctx },
    } satisfies WorkflowRunJobData, { jobId: workflowRunKey(wf.id, sourceEventId) })
    enqueued++
  }
  return enqueued
}

/** Re-enqueue a paused run to resume at `nodeId` after `ms` (delay node). */
export async function scheduleWorkflowResume(data: WorkflowRunJobData, nodeId: string, ms: number): Promise<void> {
  await workflowQueue().add('run', { ...data, startNodeId: nodeId }, {
    jobId: workflowResumeJobKey(data.workflowId, data.trigger.sourceEventId, nodeId),
    delay: Math.max(0, Math.round(ms)),
  })
}
