# Workflow process tool — Phase D: Durable execution state machine

> **Owner:** Codex | **Status:** approved for implementation by the user on 2026-09-03

## Objective contract

Replace the overloaded `paused` workflow-run state with a durable finite-state execution model for waits, retries, cancellation, expiry, and compensation. No worker thread may stay blocked while the workflow waits for an external event.

## Acceptance evidence

- State-transition tests prove only valid transitions are accepted.
- Delay, reply wait, and approval execution persist a resume cursor and return the worker to the queue.
- Failed retryable effects schedule a bounded retry; non-retryable effects terminate with diagnostics.
- Cancellation never replays a claimed or uncertain provider side effect.

## Tasks

1. Add a pure transition table in `packages/agents/src/workflows/workflow-run-state.ts` for `running`, `waiting`, `retry_scheduled`, `cancelled`, `compensating`, `failed`, and `completed`, plus terminal-state predicates.
2. Extend the `workflow_runs` row through an additive migration with `current_node_id`, `resume_at`, `resume_reason`, `attempt`, `max_attempts`, `cancel_requested_at`, `failure_code`, and `state_version`; backfill current `paused` runs as `waiting` and terminal rows unchanged.
3. Change `WorkflowExecutionsRepository` from unguarded `setRunStatus` to optimistic `transitionRun` and explicit `scheduleResume`/`requestCancellation` methods. Keep a compatibility wrapper only until worker callers migrate.
4. Update `runWorkflow` to return a typed `WorkflowRunOutcome` (`completed`, `waiting`, `retry_scheduled`, or `failed`) with its resume cursor rather than inferring terminal state from the final trace entry.
5. Update `workflow-runner.worker.ts` to persist the outcome before enqueueing future work. Maintain the existing immutable revision pin, effect ledger, and uncertain-effect protection.
6. Add cancellation and retry worker jobs, bounded exponential backoff, timeout expiry handling, and compensation registration only for idempotent, explicitly compensatable actions.
7. Add unit tests for transition legality and engine outcomes, repository tests for guarded SQL, and worker tests for delay, approval, retry, cancellation, and uncertain provider effects.

## Compatibility / rollback

The migration is additive and maps old statuses. Existing delayed/approval jobs still use their current enqueue payloads while the new executor recognizes them. Rollback preserves the trace ledger and can continue reading legacy status values.
