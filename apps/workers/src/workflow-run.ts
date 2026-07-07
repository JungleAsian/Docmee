// Rev 3 (phase 2b) — the workflow-run queue + producers. A trigger event looks up
// active workflows matching that trigger and enqueues one run per workflow; the
// workflow-runner worker executes each via the engine. Delay nodes re-enqueue with
// a startNodeId to resume.
import { z } from 'zod'
import { createQueue } from '@docmee/queue'
import { createWorkflowsRepository, type Workflow } from '@docmee/db'
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
})
export type WorkflowRunJobData = z.infer<typeof WorkflowRunJobSchema>

type Sql = ReturnType<typeof createServiceDbClient>
export interface TriggerContext {
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
  const workflows = await createWorkflowsRepository(sql).listActiveByTrigger(clinicId, triggerType)
  let enqueued = 0
  for (const wf of workflows) {
    if (triggerType === 'trigger.message_keyword' && !workflowKeywordMatches(wf, ctx.message ?? '')) continue
    await workflowQueue().add('run', {
      clinicId,
      workflowId: wf.id,
      trigger: { type: triggerType, ...ctx },
    } satisfies WorkflowRunJobData)
    enqueued++
  }
  return enqueued
}

/** Re-enqueue a paused run to resume at `nodeId` after `ms` (delay node). */
export async function scheduleWorkflowResume(data: WorkflowRunJobData, nodeId: string, ms: number): Promise<void> {
  await workflowQueue().add('run', { ...data, startNodeId: nodeId }, { delay: Math.max(0, Math.round(ms)) })
}
