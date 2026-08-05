import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  queueAdd: vi.fn().mockResolvedValue(undefined),
  listActiveByTrigger: vi.fn().mockResolvedValue([]),
}))

vi.mock('@docmee/queue', () => ({
  createQueue: () => ({ add: h.queueAdd }),
}))

vi.mock('@docmee/db', () => ({
  createConversationsRepository: () => ({ findById: vi.fn(), update: vi.fn() }),
  createWorkflowsRepository: () => ({ listActiveByTrigger: h.listActiveByTrigger }),
}))

import {
  WorkflowRunJobSchema,
  enqueueInboundWorkflowRuns,
  readPendingWorkflowRuns,
  workflowIsConversational,
  workflowKeywordMatches,
  workflowRunKey,
  workflowResumeJobKey,
  writePendingWorkflowRun,
} from '../workflow-run.js'

const triggerNode = { id: 't', kind: 'trigger' as const, type: 'trigger.message_keyword', config: {}, x: 0, y: 0 }

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

describe('workflowIsConversational', () => {
  it('is true when the graph can speak to the patient', () => {
    for (const type of ['action.send_message', 'action.interactive_menu', 'action.ask_capture', 'action.send_template', 'action.offer_slots', 'action.ai_draft']) {
      expect(workflowIsConversational({ nodes: [{ ...triggerNode }, { id: 'a', kind: 'action' as const, type, config: {}, x: 0, y: 0 }] })).toBe(true)
    }
  })

  it('is false for pure side-effect graphs', () => {
    expect(workflowIsConversational({ nodes: [
      { ...triggerNode },
      { id: 'a', kind: 'action' as const, type: 'action.add_tag', config: {}, x: 0, y: 0 },
      { id: 'b', kind: 'action' as const, type: 'action.notify_secretary', config: {}, x: 0, y: 0 },
    ] })).toBe(false)
  })
})

describe('enqueueInboundWorkflowRuns', () => {
  beforeEach(() => {
    h.queueAdd.mockClear()
    h.listActiveByTrigger.mockReset().mockResolvedValue([])
  })

  const sql = {} as never

  it('claims the turn when a matched workflow is conversational', async () => {
    h.listActiveByTrigger.mockResolvedValue([
      { id: 'wf-menu', nodes: [triggerNode, { id: 'm', kind: 'action', type: 'action.interactive_menu', config: {}, x: 0, y: 0 }] },
    ])
    const claim = await enqueueInboundWorkflowRuns(sql, 'clinic-1', { sourceEventId: 'wamid.1', message: 'hi' })
    expect(claim).toEqual({ enqueued: 1, ownsTurn: true })
    expect(h.queueAdd).toHaveBeenCalledWith('run', expect.objectContaining({ workflowId: 'wf-menu' }), expect.objectContaining({ jobId: workflowRunKey('wf-menu', 'wamid.1') }))
  })

  it('does not claim the turn for side-effect-only workflows (still enqueues)', async () => {
    h.listActiveByTrigger.mockResolvedValue([
      { id: 'wf-tag', nodes: [triggerNode, { id: 'a', kind: 'action', type: 'action.add_tag', config: {}, x: 0, y: 0 }] },
    ])
    const claim = await enqueueInboundWorkflowRuns(sql, 'clinic-1', { sourceEventId: 'wamid.2', message: 'hi' })
    expect(claim).toEqual({ enqueued: 1, ownsTurn: false })
  })

  it('skips workflows whose keywords do not match', async () => {
    h.listActiveByTrigger.mockResolvedValue([
      { id: 'wf-nomatch', nodes: [{ ...triggerNode, config: { keywords: 'urgent' } }, { id: 'm', kind: 'action', type: 'action.send_message', config: {}, x: 0, y: 0 }] },
    ])
    const claim = await enqueueInboundWorkflowRuns(sql, 'clinic-1', { sourceEventId: 'wamid.3', message: 'hello there' })
    expect(claim).toEqual({ enqueued: 0, ownsTurn: false })
    expect(h.queueAdd).not.toHaveBeenCalled()
  })

  it('refuses to run without a stable source event ID', async () => {
    const claim = await enqueueInboundWorkflowRuns(sql, 'clinic-1', { message: 'hi' })
    expect(claim).toEqual({ enqueued: 0, ownsTurn: false })
  })
})
