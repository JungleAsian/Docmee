/** Durable states for a single, revision-pinned workflow execution. Waiting
 * never occupies a worker: it is a persisted cursor plus a future event/job. */
export type WorkflowRunState =
  | 'running'
  | 'waiting'
  | 'retry_scheduled'
  | 'cancelled'
  | 'compensating'
  | 'failed'
  | 'completed'

export type WorkflowRunTransition = 'wait' | 'schedule_retry' | 'resume' | 'complete' | 'fail' | 'cancel' | 'begin_compensation' | 'compensation_complete' | 'compensation_failed'

const transitions: Record<WorkflowRunState, Partial<Record<WorkflowRunTransition, WorkflowRunState>>> = {
  running: { wait: 'waiting', schedule_retry: 'retry_scheduled', complete: 'completed', fail: 'failed', cancel: 'cancelled', begin_compensation: 'compensating' },
  waiting: { resume: 'running', cancel: 'cancelled', fail: 'failed' },
  retry_scheduled: { resume: 'running', cancel: 'cancelled', fail: 'failed' },
  compensating: { compensation_complete: 'cancelled', compensation_failed: 'failed' },
  cancelled: {},
  failed: {},
  completed: {},
}

export function workflowRunTransition(state: WorkflowRunState, action: WorkflowRunTransition): WorkflowRunState | null {
  return transitions[state][action] ?? null
}

export function isTerminalWorkflowRunState(state: WorkflowRunState): boolean {
  return state === 'cancelled' || state === 'failed' || state === 'completed'
}

/** Bounded exponential retry delay. The caller owns the max-attempt policy. */
export function workflowRetryDelayMs(attempt: number, baseMs = 1_000, maxMs = 15 * 60_000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1))
}
