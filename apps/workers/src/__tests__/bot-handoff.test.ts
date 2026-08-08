import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  update: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@docmee/db', () => ({
  createConversationsRepository: () => ({ update: h.update }),
}))

import { pauseBotForHandoff } from '../bot-handoff.js'

const sql = {} as never

describe('pauseBotForHandoff', () => {
  it('no-ops when there is no conversation to pause', async () => {
    h.update.mockClear()
    await pauseBotForHandoff(sql, 'clinic-1', undefined, undefined, 'emergency')
    expect(h.update).not.toHaveBeenCalled()
  })

  it('flips the conversation to handoff and stamps the reason + timestamp', async () => {
    h.update.mockClear()
    await pauseBotForHandoff(sql, 'clinic-1', 'convo-1', { existingKey: 'kept' }, 'ai_agent_handoff')
    expect(h.update).toHaveBeenCalledTimes(1)
    const [clinicId, conversationId, patch] = h.update.mock.calls[0] as [string, string, { status: string; metadata: Record<string, unknown> }]
    expect(clinicId).toBe('clinic-1')
    expect(conversationId).toBe('convo-1')
    expect(patch.status).toBe('handoff')
    expect(patch.metadata['existingKey']).toBe('kept')
    expect(patch.metadata['handoffReason']).toBe('ai_agent_handoff')
    expect(typeof patch.metadata['botPausedAt']).toBe('string')
  })

  it('preserves existing metadata rather than replacing it', async () => {
    h.update.mockClear()
    await pauseBotForHandoff(sql, 'clinic-1', 'convo-1', { tags: ['vip'], other: 42 }, 'medical_safety')
    const [, , patch] = h.update.mock.calls[0] as [string, string, { metadata: Record<string, unknown> }]
    expect(patch.metadata['tags']).toEqual(['vip'])
    expect(patch.metadata['other']).toBe(42)
  })

  it('works with undefined current metadata (first-ever pause)', async () => {
    h.update.mockClear()
    await pauseBotForHandoff(sql, 'clinic-1', 'convo-1', undefined, 'patient_request')
    const [, , patch] = h.update.mock.calls[0] as [string, string, { metadata: Record<string, unknown> }]
    expect(patch.metadata['handoffReason']).toBe('patient_request')
  })
})
