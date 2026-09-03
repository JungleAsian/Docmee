// Durable workflow run/effect ledger.  Queue delivery is at-least-once, so the
// ledger is the source of truth for whether an action may invoke a provider.
import { toJson, type Sql } from '../client.js'

export type WorkflowRunStatus = 'running' | 'paused' | 'completed' | 'failed'
export type WorkflowEffectStatus = 'in_progress' | 'succeeded' | 'failed' | 'uncertain'

export interface WorkflowRunRecord {
  id: string
  clinicId: string
  workflowId: string
  workflowRevisionId: string | null
  sourceEventId: string
  queueJobId: string | null
  status: WorkflowRunStatus
  trace: Record<string, unknown>
}

export interface WorkflowEffectRecord {
  id: string
  workflowRunId: string
  nodeId: string
  nodeType: string
  executionKey: string
  status: WorkflowEffectStatus
  providerId: string | null
  webhookStatus: string | null
  error: string | null
}

export interface WorkflowExecutionsRepository {
  /** Atomically creates the one run for a workflow/source event pair. */
  claimRun(input: { clinicId: string; workflowId: string; workflowRevisionId?: string; sourceEventId: string; queueJobId?: string | null }): Promise<WorkflowRunRecord | null>
  findRun(clinicId: string, workflowId: string, sourceEventId: string): Promise<WorkflowRunRecord | null>
  setRunStatus(id: string, status: WorkflowRunStatus, trace?: Record<string, unknown>): Promise<void>
  /** Returns a row only for the caller that won the durable effect claim. */
  claimEffect(input: { workflowRunId: string; nodeId: string; nodeType: string; executionKey: string }): Promise<WorkflowEffectRecord | null>
  findEffect(executionKey: string): Promise<WorkflowEffectRecord | null>
  succeedEffect(id: string, providerId?: string | null): Promise<void>
  failEffect(id: string, error: string): Promise<void>
  markEffectUncertain(id: string, error: string): Promise<void>
}

export function createWorkflowExecutionsRepository(sql: Sql): WorkflowExecutionsRepository {
  return {
    async claimRun(input) {
      const rows = await sql<WorkflowRunRecord[]>`
        INSERT INTO workflow_runs (clinic_id, workflow_id, workflow_revision_id, source_event_id, queue_job_id, status)
        VALUES (${input.clinicId}, ${input.workflowId}, ${input.workflowRevisionId ?? null}, ${input.sourceEventId}, ${input.queueJobId ?? null}, 'running')
        ON CONFLICT (clinic_id, workflow_id, source_event_id) DO UPDATE
          SET status = 'running', updated_at = NOW()
          WHERE workflow_runs.status = 'failed'
        RETURNING *
      `
      return rows[0] ?? null
    },

    async findRun(clinicId, workflowId, sourceEventId) {
      const rows = await sql<WorkflowRunRecord[]>`
        SELECT * FROM workflow_runs
        WHERE clinic_id = ${clinicId} AND workflow_id = ${workflowId} AND source_event_id = ${sourceEventId}
        LIMIT 1
      `
      return rows[0] ?? null
    },

    async setRunStatus(id, status, trace = {}) {
      await sql`
        UPDATE workflow_runs
        SET status = ${status}, trace = trace || ${sql.json(toJson(trace))}, updated_at = NOW()
        WHERE id = ${id}
      `
    },

    async claimEffect(input) {
      const rows = await sql<WorkflowEffectRecord[]>`
        INSERT INTO workflow_effects (workflow_run_id, node_id, node_type, execution_key, status)
        VALUES (${input.workflowRunId}, ${input.nodeId}, ${input.nodeType}, ${input.executionKey}, 'in_progress')
        ON CONFLICT (execution_key) DO NOTHING
        RETURNING *
      `
      return rows[0] ?? null
    },

    async findEffect(executionKey) {
      const rows = await sql<WorkflowEffectRecord[]>`
        SELECT * FROM workflow_effects WHERE execution_key = ${executionKey} LIMIT 1
      `
      return rows[0] ?? null
    },

    async succeedEffect(id, providerId = null) {
      await sql`
        UPDATE workflow_effects
        SET status = 'succeeded', provider_id = ${providerId}, error = NULL, completed_at = NOW(), updated_at = NOW()
        WHERE id = ${id}
      `
    },

    async failEffect(id, error) {
      await sql`
        UPDATE workflow_effects
        SET status = 'failed', error = ${error.slice(0, 1_000)}, updated_at = NOW()
        WHERE id = ${id}
      `
    },

    async markEffectUncertain(id, error) {
      await sql`
        UPDATE workflow_effects
        SET status = 'uncertain', error = ${error.slice(0, 1_000)}, updated_at = NOW()
        WHERE id = ${id}
      `
    },
  }
}
