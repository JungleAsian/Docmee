import { describe, it, expect, vi } from 'vitest'

vi.mock('@docmee/queue', () => ({
  createQueue: () => ({ add: vi.fn() }),
}))

import { WorkflowRunJobSchema, readPendingWorkflowRuns, workflowKeywordMatches, workflowRunKey, workflowResumeJobKey, writePendingWorkflowRun } from '../workflow-run.js'

const wf = (keywords: string) => ({
  nodes: [{ id: 't', kind: 'trigger' as const, type: 'trigger.message_keyword', config: { keywords }, x: 0, y: 0 }],
})

describe('pending conversational workflow state', () => {
  it('round-trips a cursor without discarding unrelated conversation metadata', () => {
    const metadata = writePendingWorkflowRun(
      { zernioConversationId: 'z-1' },
      {
        workflowId: 'workflow-1',
        sourceEventId: 'wamid.test-1',
        resumeNodeId: 'ask-date',
        context: { patientId: 'patient-1', preferred_time: '09:00' },
        expiresAt: '2026-07-19T00:00:00.000Z',
      },
    )
    expect(metadata['zernioConversationId']).toBe('z-1')
    expect(readPendingWorkflowRuns(metadata)).toEqual([
      expect.objectContaining({ workflowId: 'workflow-1', resumeNodeId: 'ask-date' }),
    ])
  })

  it('rejects malformed persisted cursors', () => {
    expect(readPendingWorkflowRuns({ pendingWorkflowRuns: [{ workflowId: 4 }] })).toEqual([])
  })
})

describe('workflowKeywordMatches', () => {
  it('matches when a keyword is contained (case-insensitive)', () => {
    expect(workflowKeywordMatches(wf('urgent, emergency'), 'This is URGENT please')).toBe(true)
  })

  it('does not match when no configured keyword is present', () => {
    expect(workflowKeywordMatches(wf('urgent'), 'just a routine question')).toBe(false)
  })

  it('matches every message when the keyword list is empty', () => {
    expect(workflowKeywordMatches(wf(''), 'anything at all')).toBe(true)
  })
})

describe('workflow idempotency keys', () => {
  it('uses stable, BullMQ-safe IDs for duplicate source events and distinct resume steps', () => {
    expect(workflowRunKey('workflow-1', 'wamid.123')).toBe(workflowRunKey('workflow-1', 'wamid.123'))
    expect(workflowRunKey('workflow-1', 'wamid.123')).not.toContain(':')
    expect(workflowResumeJobKey('workflow-1', 'wamid.123', 'node-a')).not.toBe(
      workflowResumeJobKey('workflow-1', 'wamid.123', 'node-b'),
    )
  })

  it('rejects jobs whose producer did not supply a stable source event ID', () => {
    expect(() => WorkflowRunJobSchema.parse({
      clinicId: '11111111-1111-4111-8111-111111111111',
      workflowId: '22222222-2222-4222-8222-222222222222',
      trigger: { type: 'trigger.message_keyword' },
    })).toThrow()
  })
})
