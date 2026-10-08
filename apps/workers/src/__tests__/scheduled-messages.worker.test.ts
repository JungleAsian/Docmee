import { describe, it, expect, vi } from 'vitest'
import { deliverScheduledMessage } from '../scheduled-messages.worker.js'
import type { ScheduledMessage } from '@docmee/db'

const message = { id: 'scheduled', clinicId: 'clinic', conversationId: 'conversation', patientId: 'patient', authorId: 'author', accountId: 'account', providerAccountId: 'provider-account', recipient: 'synthetic-recipient', kind: 'text', content: 'Synthetic notice', templateId: null, scheduledAt: '2026-10-07T12:00:00Z', timezone: 'UTC', status: 'pending', version: 1, reasonCode: null, createdAt: '2026-10-07T11:00:00Z', idempotencyKey: 'key' } as ScheduledMessage
function fixture() {
  const events: string[] = []
  const context = { reason: null as string | null, lastInboundAt: '2026-10-07T11:59:00Z', template: null, content: 'Synthetic notice', account: { accountId: 'provider-account', accessTokenEnc: 'synthetic-noncredential' } }
  const repo = {
    claim: vi.fn(async () => { events.push('attempt-persisted'); return message }),
    outcome: vi.fn(async (_: unknown, status: string) => { events.push(status) }),
    confirmed: vi.fn(async () => { events.push('timeline-and-pause') }),
  }
  const load = vi.fn(async () => context)
  const send = vi.fn(async () => { events.push('provider'); return 'provider.synthetic' as string | null })
  return { events, context, repo, load, send }
}
describe('scheduled delivery', () => {
  it('rechecks the current clock after slow revalidation before calling the provider', async () => {
    const f = fixture()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-07T12:00:00Z'))
    f.context.lastInboundAt = '2026-10-06T12:00:01Z'
    f.load.mockImplementation(async () => {
      clock.mockReturnValue(Date.parse('2026-10-07T12:00:02Z'))
      return f.context
    })
    try {
      await deliverScheduledMessage({ clinicId: 'clinic', messageId: 'scheduled', version: 1 }, f.repo, f.load, f.send)
      expect(f.send).not.toHaveBeenCalled()
      expect(f.repo.outcome).toHaveBeenCalledWith(message, 'blocked', 'window_expired')
    } finally { clock.mockRestore() }
  })
  it('persists the attempt before sending and only then commits confirmed timeline and bot pause', async () => {
    const f = fixture()
    await deliverScheduledMessage({ clinicId: 'clinic', messageId: 'scheduled', version: 1 }, f.repo, f.load, f.send, Date.parse('2026-10-07T12:00:00Z'))
    expect(f.events).toEqual(['attempt-persisted', 'provider', 'timeline-and-pause'])
  })
  it.each(['clinic_disabled', 'author_forbidden', 'opted_out', 'conversation_closed', 'account_changed', 'recipient_changed', 'template_unsafe'])('blocks current %s without provider/timeline/bot pause', async (reason) => {
    const f = fixture(); f.context.reason = reason
    await deliverScheduledMessage({ clinicId: 'clinic', messageId: 'scheduled', version: 1 }, f.repo, f.load, f.send, Date.parse('2026-10-07T12:00:00Z'))
    expect(f.events).toEqual(['attempt-persisted', 'blocked'])
    expect(f.repo.outcome).toHaveBeenCalledWith(message, 'blocked', reason)
  })
  it('blocks expired free text and fifteen-minute overdue schedules', async () => {
    const f = fixture(); f.context.lastInboundAt = '2026-10-06T12:00:00Z'
    await deliverScheduledMessage({ clinicId: 'clinic', messageId: 'scheduled', version: 1 }, f.repo, f.load, f.send, Date.parse('2026-10-07T12:00:00Z'))
    expect(f.repo.outcome).toHaveBeenCalledWith(message, 'blocked', 'window_expired')
    const late = fixture()
    await deliverScheduledMessage({ clinicId: 'clinic', messageId: 'scheduled', version: 1 }, late.repo, late.load, late.send, Date.parse('2026-10-07T12:15:01Z'))
    expect(late.repo.outcome).toHaveBeenCalledWith(message, 'blocked', 'overdue')
  })
  it('does not blindly retry unknown provider acceptance or persist a phantom message', async () => {
    const f = fixture(); f.send.mockRejectedValue(new Error('synthetic timeout'))
    await deliverScheduledMessage({ clinicId: 'clinic', messageId: 'scheduled', version: 1 }, f.repo, f.load, f.send, Date.parse('2026-10-07T12:00:00Z'))
    expect(f.events).toEqual(['attempt-persisted', 'delivery_unknown'])
    expect(f.send).toHaveBeenCalledTimes(1)
    expect(f.repo.outcome).toHaveBeenCalledWith(message, 'delivery_unknown', 'provider_outcome_unknown')
  })
  it('null provider IDs stay unknown; duplicate or stale claims never send', async () => {
    const f = fixture(); f.send.mockImplementation(async () => { f.events.push('provider'); return null })
    await deliverScheduledMessage({ clinicId: 'clinic', messageId: 'scheduled', version: 1 }, f.repo, f.load, f.send, Date.parse('2026-10-07T12:00:00Z'))
    expect(f.events).toEqual(['attempt-persisted', 'provider', 'delivery_unknown'])
    const duplicate = fixture(); duplicate.repo.claim.mockResolvedValue(null as unknown as ScheduledMessage)
    await deliverScheduledMessage({ clinicId: 'clinic', messageId: 'scheduled', version: 1 }, duplicate.repo, duplicate.load, duplicate.send)
    expect(duplicate.events).toEqual([])
  })
})
