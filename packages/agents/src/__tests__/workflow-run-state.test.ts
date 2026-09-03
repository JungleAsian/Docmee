import { describe, expect, it } from 'vitest'
import { isTerminalWorkflowRunState, workflowRetryDelayMs, workflowRunTransition } from '../workflows/workflow-run-state.js'

describe('workflow run state machine', () => {
  it('allows waits and resumes, but never resumes a terminal execution', () => {
    expect(workflowRunTransition('running', 'wait')).toBe('waiting')
    expect(workflowRunTransition('waiting', 'resume')).toBe('running')
    expect(workflowRunTransition('completed', 'resume')).toBeNull()
    expect(isTerminalWorkflowRunState('cancelled')).toBe(true)
  })

  it('uses a bounded exponential retry cadence', () => {
    expect(workflowRetryDelayMs(1)).toBe(1_000)
    expect(workflowRetryDelayMs(3)).toBe(4_000)
    expect(workflowRetryDelayMs(99)).toBe(15 * 60_000)
  })
})
