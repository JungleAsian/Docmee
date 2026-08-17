import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  listMidFlowCandidates: vi.fn(),
  convUpdate: vi.fn(),
  findLast: vi.fn(),
  msgCreate: vi.fn(),
  findClinic: vi.fn(),
  listByClinic: vi.fn(),
  findPatient: vi.fn(),
  activeWhatsAppAccount: vi.fn(),
  resolveWhatsAppSender: vi.fn(),
}))

vi.mock('@docmee/db', () => ({
  createConversationsRepository: () => ({ listMidFlowCandidates: h.listMidFlowCandidates, update: h.convUpdate }),
  createMessagesRepository: () => ({ findLast: h.findLast, create: h.msgCreate }),
  createClinicsRepository: () => ({ findById: h.findClinic }),
  createChannelAccountsRepository: () => ({ listByClinic: h.listByClinic }),
  createPatientsRepository: () => ({ findById: h.findPatient }),
}))

vi.mock('../meta-token.js', () => ({
  activeWhatsAppAccount: h.activeWhatsAppAccount,
  resolveWhatsAppSender: h.resolveWhatsAppSender,
}))

import {
  decideStalledConversationAction,
  resolveStalledConversationConfig,
  readStalledConversationState,
  writeStalledConversationState,
  resolveMidFlowCursor,
  reannouncementMessage,
  finalNoticeMessage,
  runStalledConversationCheck,
  DEFAULT_STALLED_CONVERSATION_CONFIG,
  type StalledConversationState,
} from '../stalled-conversation.js'
import { writePendingWorkflowRun } from '../workflow-run.js'

const CONFIG = { stallMinutes: 10, reannounceIntervalMinutes: 10, maxReannouncements: 3, closeGraceMinutes: 5 }
const NOW = Date.parse('2026-08-09T12:00:00.000Z')

describe('decideStalledConversationAction', () => {
  it('not mid-flow → none, regardless of other inputs', () => {
    const result = decideStalledConversationAction({
      cursor: null,
      lastMessageAt: '2026-08-09T00:00:00.000Z',
      priorState: { cursorId: 'workflow:a:b', reannounceCount: 5, finalNoticeAt: null, lastReannounceAt: null },
      config: CONFIG,
      nowMs: NOW,
    })
    expect(result).toEqual({ kind: 'none' })
  })

  it('silent for less than stallMinutes → none', () => {
    const result = decideStalledConversationAction({
      cursor: { cursorId: 'workflow:a:b' },
      lastMessageAt: new Date(NOW - 5 * 60_000).toISOString(),
      priorState: null,
      config: CONFIG,
      nowMs: NOW,
    })
    expect(result).toEqual({ kind: 'none' })
  })

  it('silent at/above stallMinutes with no prior state → reannounce, count 1', () => {
    const result = decideStalledConversationAction({
      cursor: { cursorId: 'workflow:a:b' },
      lastMessageAt: new Date(NOW - 10 * 60_000).toISOString(),
      priorState: null,
      config: CONFIG,
      nowMs: NOW,
    })
    expect(result).toEqual({
      kind: 'reannounce',
      nextState: { cursorId: 'workflow:a:b', reannounceCount: 1, finalNoticeAt: null, lastReannounceAt: new Date(NOW).toISOString() },
    })
  })

  it('increments the reannounce count for the same cursor on each subsequent stall (legacy state, no lastReannounceAt yet — measured off lastMessageAt like before)', () => {
    const priorState: StalledConversationState = { cursorId: 'workflow:a:b', reannounceCount: 1, finalNoticeAt: null, lastReannounceAt: null }
    const result = decideStalledConversationAction({
      cursor: { cursorId: 'workflow:a:b' },
      lastMessageAt: new Date(NOW - 10 * 60_000).toISOString(),
      priorState,
      config: CONFIG,
      nowMs: NOW,
    })
    expect(result).toEqual({
      kind: 'reannounce',
      nextState: { cursorId: 'workflow:a:b', reannounceCount: 2, finalNoticeAt: null, lastReannounceAt: new Date(NOW).toISOString() },
    })
  })

  it('after a re-announcement, the NEXT one is gated by reannounceIntervalMinutes measured from lastReannounceAt, not stallMinutes/lastMessageAt', () => {
    const priorState: StalledConversationState = {
      cursorId: 'workflow:a:b',
      reannounceCount: 1,
      finalNoticeAt: null,
      lastReannounceAt: new Date(NOW - 7 * 60_000).toISOString(),
    }
    // lastMessageAt is old enough to clear stallMinutes (10 min), but lastReannounceAt
    // is only 7 min ago — under the 10-min reannounceIntervalMinutes — so still none.
    const tooSoon = decideStalledConversationAction({
      cursor: { cursorId: 'workflow:a:b' },
      lastMessageAt: new Date(NOW - 30 * 60_000).toISOString(),
      priorState,
      config: CONFIG,
      nowMs: NOW,
    })
    expect(tooSoon).toEqual({ kind: 'none' })

    const readyState: StalledConversationState = { ...priorState, lastReannounceAt: new Date(NOW - 10 * 60_000).toISOString() }
    const ready = decideStalledConversationAction({
      cursor: { cursorId: 'workflow:a:b' },
      lastMessageAt: new Date(NOW - 30 * 60_000).toISOString(),
      priorState: readyState,
      config: CONFIG,
      nowMs: NOW,
    })
    expect(ready).toEqual({
      kind: 'reannounce',
      nextState: { cursorId: 'workflow:a:b', reannounceCount: 2, finalNoticeAt: null, lastReannounceAt: new Date(NOW).toISOString() },
    })
  })

  it('reaching maxReannouncements sends the final notice instead of another reannounce', () => {
    const priorState: StalledConversationState = { cursorId: 'workflow:a:b', reannounceCount: 3, finalNoticeAt: null, lastReannounceAt: new Date(NOW - 10 * 60_000).toISOString() }
    const result = decideStalledConversationAction({
      cursor: { cursorId: 'workflow:a:b' },
      lastMessageAt: new Date(NOW - 10 * 60_000).toISOString(),
      priorState,
      config: CONFIG,
      nowMs: NOW,
    })
    expect(result.kind).toBe('final_notice')
    if (result.kind === 'final_notice') {
      expect(result.nextState.reannounceCount).toBe(3)
      expect(result.nextState.finalNoticeAt).toBe(new Date(NOW).toISOString())
    }
  })

  it('final notice sent, grace period not yet elapsed → none', () => {
    const priorState: StalledConversationState = {
      cursorId: 'workflow:a:b',
      reannounceCount: 3,
      finalNoticeAt: new Date(NOW - 2 * 60_000).toISOString(),
      lastReannounceAt: new Date(NOW - 12 * 60_000).toISOString(),
    }
    const result = decideStalledConversationAction({
      cursor: { cursorId: 'workflow:a:b' },
      lastMessageAt: new Date(NOW - 2 * 60_000).toISOString(),
      priorState,
      config: CONFIG,
      nowMs: NOW,
    })
    expect(result).toEqual({ kind: 'none' })
  })

  it('final notice sent, grace period elapsed → close', () => {
    const priorState: StalledConversationState = {
      cursorId: 'workflow:a:b',
      reannounceCount: 3,
      finalNoticeAt: new Date(NOW - 5 * 60_000).toISOString(),
      lastReannounceAt: new Date(NOW - 15 * 60_000).toISOString(),
    }
    const result = decideStalledConversationAction({
      cursor: { cursorId: 'workflow:a:b' },
      lastMessageAt: new Date(NOW - 5 * 60_000).toISOString(),
      priorState,
      config: CONFIG,
      nowMs: NOW,
    })
    expect(result).toEqual({ kind: 'close' })
  })

  it('a changed cursorId resets the counter (a new question started)', () => {
    const priorState: StalledConversationState = { cursorId: 'workflow:a:b', reannounceCount: 3, finalNoticeAt: null, lastReannounceAt: new Date(NOW - 10 * 60_000).toISOString() }
    const belowThreshold = decideStalledConversationAction({
      cursor: { cursorId: 'workflow:a:c' },
      lastMessageAt: new Date(NOW - 1 * 60_000).toISOString(),
      priorState,
      config: CONFIG,
      nowMs: NOW,
    })
    expect(belowThreshold).toEqual({ kind: 'none' })

    const atThreshold = decideStalledConversationAction({
      cursor: { cursorId: 'workflow:a:c' },
      lastMessageAt: new Date(NOW - 10 * 60_000).toISOString(),
      priorState,
      config: CONFIG,
      nowMs: NOW,
    })
    expect(atThreshold).toEqual({
      kind: 'reannounce',
      nextState: { cursorId: 'workflow:a:c', reannounceCount: 1, finalNoticeAt: null, lastReannounceAt: new Date(NOW).toISOString() },
    })
  })

  it('maxReannouncements: 0 goes straight to the final notice on first stall', () => {
    const result = decideStalledConversationAction({
      cursor: { cursorId: 'workflow:a:b' },
      lastMessageAt: new Date(NOW - 10 * 60_000).toISOString(),
      priorState: null,
      config: { ...CONFIG, maxReannouncements: 0 },
      nowMs: NOW,
    })
    expect(result.kind).toBe('final_notice')
  })

  it('a very large elapsed time still only advances one step, never skips straight to close', () => {
    const result = decideStalledConversationAction({
      cursor: { cursorId: 'workflow:a:b' },
      lastMessageAt: new Date(NOW - 1000 * 60 * 60 * 24 * 3).toISOString(), // 3 days silent
      priorState: null,
      config: CONFIG,
      nowMs: NOW,
    })
    expect(result.kind).toBe('reannounce')
  })
})

describe('resolveStalledConversationConfig', () => {
  it('null/undefined settings → all defaults', () => {
    expect(resolveStalledConversationConfig(null)).toEqual(DEFAULT_STALLED_CONVERSATION_CONFIG)
    expect(resolveStalledConversationConfig(undefined)).toEqual(DEFAULT_STALLED_CONVERSATION_CONFIG)
  })

  it('fully-valid settings are passed through', () => {
    const settings = { stalledConversation: { stallMinutes: 15, reannounceIntervalMinutes: 20, maxReannouncements: 2, closeGraceMinutes: 8 } }
    expect(resolveStalledConversationConfig(settings)).toEqual({
      stallMinutes: 15,
      reannounceIntervalMinutes: 20,
      maxReannouncements: 2,
      closeGraceMinutes: 8,
    })
  })

  it('an invalid field falls back to default while siblings are honored', () => {
    const settings = { stalledConversation: { stallMinutes: -5, reannounceIntervalMinutes: 'nope', maxReannouncements: 7, closeGraceMinutes: 'nope' } }
    expect(resolveStalledConversationConfig(settings)).toEqual({
      stallMinutes: DEFAULT_STALLED_CONVERSATION_CONFIG.stallMinutes,
      reannounceIntervalMinutes: DEFAULT_STALLED_CONVERSATION_CONFIG.reannounceIntervalMinutes,
      maxReannouncements: 7,
      closeGraceMinutes: DEFAULT_STALLED_CONVERSATION_CONFIG.closeGraceMinutes,
    })
  })
})

describe('read/writeStalledConversationState', () => {
  it('reads null off empty metadata', () => {
    expect(readStalledConversationState({})).toBeNull()
  })

  it('rejects a malformed shape', () => {
    expect(readStalledConversationState({ stalledConversation: { cursorId: 'x' } })).toBeNull()
    expect(readStalledConversationState({ stalledConversation: 'nope' })).toBeNull()
  })

  it('round-trips a valid state', () => {
    const state: StalledConversationState = { cursorId: 'workflow:a:b', reannounceCount: 2, finalNoticeAt: null, lastReannounceAt: new Date().toISOString() }
    const metadata = writeStalledConversationState({}, state)
    expect(readStalledConversationState(metadata)).toEqual(state)
  })

  it('reads a legacy state persisted before lastReannounceAt existed as lastReannounceAt: null', () => {
    const legacy = { cursorId: 'workflow:a:b', reannounceCount: 2, finalNoticeAt: null }
    expect(readStalledConversationState({ stalledConversation: legacy })).toEqual({ ...legacy, lastReannounceAt: null })
  })

  it('write(..., null) deletes the key without touching sibling metadata', () => {
    const metadata = writeStalledConversationState(
      { pendingWorkflowRuns: [{ workflowId: 'wf-1' }], stalledConversation: { cursorId: 'x', reannounceCount: 1, finalNoticeAt: null } },
      null,
    )
    expect(metadata['stalledConversation']).toBeUndefined()
    expect(metadata['pendingWorkflowRuns']).toEqual([{ workflowId: 'wf-1' }])
  })
})

describe('resolveMidFlowCursor', () => {
  it('an active pendingWorkflowRuns entry → workflow cursor', () => {
    const metadata = writePendingWorkflowRun(
      {},
      {
        workflowId: 'wf-1',
        sourceEventId: 'wamid.1',
        resumeNodeId: 'node-a',
        context: {},
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    )
    expect(resolveMidFlowCursor(metadata)).toEqual({ cursorId: 'workflow:wf-1:node-a' })
  })

  it('only an expired pendingWorkflowRuns entry, no customFlowState → null', () => {
    const metadata = writePendingWorkflowRun(
      {},
      {
        workflowId: 'wf-1',
        sourceEventId: 'wamid.1',
        resumeNodeId: 'node-a',
        context: {},
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      },
    )
    expect(resolveMidFlowCursor(metadata)).toBeNull()
  })

  it('customFlowState only → customflow cursor', () => {
    const metadata = { customFlowState: { flowId: 'flow-1', stepId: 'step-a' } }
    expect(resolveMidFlowCursor(metadata)).toEqual({ cursorId: 'customflow:flow-1:step-a' })
  })

  it('both an active workflow cursor and customFlowState → workflow wins', () => {
    const metadata = {
      ...writePendingWorkflowRun(
        {},
        {
          workflowId: 'wf-1',
          sourceEventId: 'wamid.1',
          resumeNodeId: 'node-a',
          context: {},
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      ),
      customFlowState: { flowId: 'flow-1', stepId: 'step-a' },
    }
    expect(resolveMidFlowCursor(metadata)).toEqual({ cursorId: 'workflow:wf-1:node-a' })
  })

  it('empty metadata → null', () => {
    expect(resolveMidFlowCursor({})).toBeNull()
  })
})

describe('message builders', () => {
  it('reannouncementMessage contains the original text verbatim in both languages', () => {
    expect(reannouncementMessage('¿A qué hora abren?', 'es')).toContain('¿A qué hora abren?')
    expect(reannouncementMessage('What time do you open?', 'en')).toContain('What time do you open?')
  })

  it('finalNoticeMessage returns a language-appropriate string in both languages', () => {
    expect(finalNoticeMessage('es')).toContain('cerraremos')
    expect(finalNoticeMessage('en')).toContain('close')
  })
})

describe('runStalledConversationCheck', () => {
  const CLINIC = 'clinic-1'
  const CONVO = 'convo-1'

  const activeMetadata = writePendingWorkflowRun(
    {},
    {
      workflowId: 'wf-1',
      sourceEventId: 'wamid.1',
      resumeNodeId: 'node-a',
      context: {},
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  )

  beforeEach(() => {
    vi.clearAllMocks()
    h.findClinic.mockResolvedValue({ id: CLINIC, settings: {} })
    h.listByClinic.mockResolvedValue([{ channel: 'whatsapp', status: 'active' }])
    h.activeWhatsAppAccount.mockReturnValue({ channel: 'whatsapp', status: 'active' })
    h.resolveWhatsAppSender.mockReturnValue(vi.fn().mockResolvedValue('wamid.reply'))
    h.findPatient.mockResolvedValue({ id: 'patient-1', metadata: {} })
    h.convUpdate.mockResolvedValue(undefined)
    h.msgCreate.mockResolvedValue({ id: 'msg-1' })
  })

  it('sends a reannouncement for a stalled candidate and bumps the counter', async () => {
    h.listMidFlowCandidates.mockResolvedValue([
      {
        id: CONVO,
        clinicId: CLINIC,
        patientId: 'patient-1',
        channelContactHandle: '50299998889',
        metadata: activeMetadata,
      },
    ])
    h.findLast.mockResolvedValue({
      content: '¿Prefieres mañana o tarde?',
      createdAt: new Date(Date.now() - 15 * 60_000).toISOString(),
    })

    await runStalledConversationCheck({} as never)

    expect(h.msgCreate).toHaveBeenCalledTimes(1)
    const sentRow = h.msgCreate.mock.calls[0]![0]
    expect(sentRow.content).toContain('¿Prefieres mañana o tarde?')
    expect(h.convUpdate).toHaveBeenCalledWith(
      CLINIC,
      CONVO,
      expect.objectContaining({
        metadata: expect.objectContaining({
          stalledConversation: expect.objectContaining({ reannounceCount: 1 }),
        }),
      }),
    )
  })

  it('closes the conversation on a close decision, without sending a WhatsApp message', async () => {
    h.listMidFlowCandidates.mockResolvedValue([
      {
        id: CONVO,
        clinicId: CLINIC,
        patientId: 'patient-1',
        channelContactHandle: '50299998889',
        metadata: {
          ...activeMetadata,
          stalledConversation: { cursorId: 'workflow:wf-1:node-a', reannounceCount: 3, finalNoticeAt: new Date(Date.now() - 10 * 60_000).toISOString() },
        },
      },
    ])
    h.findLast.mockResolvedValue({
      content: 'final notice text',
      createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    })

    await runStalledConversationCheck({} as never)

    expect(h.msgCreate).not.toHaveBeenCalled()
    expect(h.convUpdate).toHaveBeenCalledWith(CLINIC, CONVO, expect.objectContaining({ status: 'resolved' }))
  })

  it('skips a candidate with no active WhatsApp account without throwing, and still processes the next one', async () => {
    h.listMidFlowCandidates.mockResolvedValue([
      { id: 'convo-a', clinicId: CLINIC, patientId: 'patient-1', channelContactHandle: '50299990001', metadata: activeMetadata },
      { id: 'convo-b', clinicId: CLINIC, patientId: 'patient-1', channelContactHandle: '50299990002', metadata: activeMetadata },
    ])
    h.findLast.mockResolvedValue({ content: 'question', createdAt: new Date(Date.now() - 15 * 60_000).toISOString() })
    h.activeWhatsAppAccount.mockReturnValue(undefined)
    h.resolveWhatsAppSender.mockReturnValue(null)

    await expect(runStalledConversationCheck({} as never)).resolves.toBeUndefined()
    expect(h.msgCreate).not.toHaveBeenCalled()
    // Both candidates were reached (listByClinic queried per clinic, cached — called once for the shared clinic).
    expect(h.findLast).toHaveBeenCalledTimes(2)
  })

  it('clears lingering stall state when the cursor has resolved (patient replied)', async () => {
    h.listMidFlowCandidates.mockResolvedValue([
      {
        id: CONVO,
        clinicId: CLINIC,
        patientId: 'patient-1',
        channelContactHandle: '50299998889',
        metadata: { stalledConversation: { cursorId: 'workflow:wf-1:node-a', reannounceCount: 2, finalNoticeAt: null } },
      },
    ])

    await runStalledConversationCheck({} as never)

    expect(h.msgCreate).not.toHaveBeenCalled()
    expect(h.convUpdate).toHaveBeenCalledWith(
      CLINIC,
      CONVO,
      expect.objectContaining({ metadata: expect.not.objectContaining({ stalledConversation: expect.anything() }) }),
    )
  })

  it('skips a conversation with no messages at all, without throwing', async () => {
    h.listMidFlowCandidates.mockResolvedValue([
      { id: CONVO, clinicId: CLINIC, patientId: 'patient-1', channelContactHandle: '50299998889', metadata: activeMetadata },
    ])
    h.findLast.mockResolvedValue(null)

    await expect(runStalledConversationCheck({} as never)).resolves.toBeUndefined()
    expect(h.msgCreate).not.toHaveBeenCalled()
  })

  it('one candidate throwing does not abort the rest of the tick', async () => {
    h.listMidFlowCandidates.mockResolvedValue([
      { id: 'convo-a', clinicId: CLINIC, patientId: 'patient-1', channelContactHandle: '50299990001', metadata: activeMetadata },
      { id: 'convo-b', clinicId: CLINIC, patientId: 'patient-1', channelContactHandle: '50299990002', metadata: activeMetadata },
    ])
    h.findLast
      .mockRejectedValueOnce(new Error('db blip'))
      .mockResolvedValueOnce({ content: 'question', createdAt: new Date(Date.now() - 15 * 60_000).toISOString() })

    await expect(runStalledConversationCheck({} as never)).resolves.toBeUndefined()
    expect(h.msgCreate).toHaveBeenCalledTimes(1)
  })
})
